# Code Review — `PUT /me/profile` (profile-update route)

File reviewed: `.claude/skills/zod-workspace/fixtures/user-profile-schema.ts`

Overall: the Zod schema itself is reasonably close (string bounds, `.url()`, a
`.default()`), but the way it's *used* at the boundary undoes most of that
value — `parse()` will crash the handler on bad input, `z.any()` lets
unvalidated JSON reach the database untouched, and a hand-written type sits
next to the schema waiting to drift. There's also one correctness bug in the
`GET` handler serious enough that it should block the PR on its own. Findings
below are ordered by severity, each with the "why" and a concrete fix.

---

## Critical

### 1. `UserProfileSchema.parse(req.body)` will crash the handler on invalid input — line 24

```ts
const input = UserProfileSchema.parse(req.body) as UserProfileInput;
```

`parse()` throws a `ZodError` on any validation failure. Fastify request
bodies are exactly the kind of external, untrusted input `safeParse()` exists
for — a client sending `{ displayName: '' }` or omitting `displayName`
entirely throws here, and unless a global `setErrorHandler` is registered to
special-case `ZodError` (none is visible in this file, and none is imported),
that exception surfaces as an unhandled rejection / generic 500 with no
indication to the caller of *what* was wrong. That's a worse experience for
API consumers than a structured 400, and a landmine for whoever writes the
next route without remembering the error handler exists.

**Fix:**

```ts
const parsed = UserProfileSchema.safeParse(req.body);
if (!parsed.success) {
  reply.status(400);
  return { error: 'Invalid profile payload', issues: parsed.error.issues };
}
const input = parsed.data; // already typed as z.infer<typeof UserProfileSchema>
```

### 2. `metadata: z.any()` lets arbitrary, unvalidated JSON reach the database — line 10

```ts
metadata: z.any(),
```

`z.any()` both disables TypeScript checking for `input.metadata` downstream
*and* means literally any JSON value — including a multi-megabyte nested
object, an array, `null`, a string, whatever — is accepted and written
straight into `userProfiles.metadata` (lines 33/42) with no shape or size
constraint. There's no validation happening for this field at all; it's not
"loosely typed," it's unvalidated. At minimum this should be `z.unknown()` so
any code that touches `input.metadata` later is forced to narrow it first
instead of silently trusting an arbitrary shape. Better: constrain it to what
the product actually expects to store (an object, with a size cap).

**Fix (minimal):**

```ts
metadata: z.unknown(),
```

**Fix (better — bound the blast radius):**

```ts
metadata: z.record(z.string(), z.unknown())
  .refine((m) => JSON.stringify(m).length <= 10_000, 'metadata payload too large'),
```

---

## High

### 3. Hand-written `UserProfileInput` type duplicates the schema and is forced on with `as` — lines 14–20, 24

```ts
type UserProfileInput = {
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  metadata: unknown;
  timezone: string;
};
...
const input = UserProfileSchema.parse(req.body) as UserProfileInput;
```

Two problems compounding each other:

- `UserProfileInput` is a manually maintained duplicate of what
  `z.infer<typeof UserProfileSchema>` already produces. It's already
  slightly wrong — the schema's `metadata` is `z.any()` but the manual type
  claims `unknown` — and the next time someone adds a field to the schema
  (e.g. `pronouns: z.string().optional()`) they have to remember to update
  this interface too, or the type quietly stops reflecting reality.
- The `as UserProfileInput` cast doesn't check anything — it's an assertion,
  not a validation. If the manual type and the schema ever disagree (as they
  already do for `metadata`), TypeScript will not catch it, because `as`
  tells the compiler to trust you.

**Fix:** delete the manual interface, derive the type from the schema, drop
the cast:

```ts
type UserProfileInput = z.infer<typeof UserProfileSchema>;
...
const input = parsed.data; // no cast needed — already UserProfileInput
```

### 4. No custom error messages — the eventual 400 body will be Zod's raw technical text — line 6–12

Once `parse()` is swapped for `safeParse()` (finding #1), whatever gets
returned in `issues` will carry Zod's default messages: `"String must
contain at most 80 character(s)"`, `"Invalid url"`, etc. That's fine for a
developer console but not something a UI should show a user in-line without
translation work happening somewhere. Since this route has no
response/error-mapping layer visible, the default messages are what ships.

**Fix:**

```ts
const UserProfileSchema = z.object({
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(80, 'Display name must be 80 characters or fewer'),
  bio: z.string().max(500, 'Bio must be 500 characters or fewer').optional(),
  avatarUrl: z.string().url('Avatar URL must be a valid URL').optional(),
  metadata: z.unknown(),
  timezone: z.string().default('UTC'),
});
```

---

## Medium

### 5. No `.strict()` — unrecognized keys are silently stripped, not rejected — line 6–12

`z.object()` defaults to `.strip()`, so a client that sends
`{ displayName: 'X', isAdmin: true }` has `isAdmin` silently dropped rather
than the request being rejected. For a write endpoint that upserts a DB row,
silent stripping hides both attacker probing (does this endpoint accept an
`isAdmin`-style privilege field?) and honest client bugs (a stale field name
after a rename). Given this is a PUT contract boundary, `.strict()` is the
safer default — it turns "silently ignored" into "visible 400."

**Fix:**

```ts
const UserProfileSchema = z.object({
  /* ... */
}).strict();
```

If stripping unknown keys is actually intentional here, keep `.strip()` but
make it explicit in code so the next reader doesn't have to know it's the
Zod default.

### 6. `timezone` accepts any string, not just valid IANA timezone names — line 11

```ts
timezone: z.string().default('UTC'),
```

Any string satisfies this — `"blah"`, `"   "`, `"UTC; DROP TABLE"` (as a
string, not executable, but still garbage data) all pass and get written to
the row. If anything downstream does `new Intl.DateTimeFormat('en-US', {
timeZone: input.timezone })` or similar, an invalid value throws at *that*
call site instead of at the boundary where it's actually easy to reject.

**Fix:**

```ts
timezone: z.string()
  .default('UTC')
  .refine(
    (tz) => Intl.supportedValuesOf('timeZone').includes(tz),
    'Must be a valid IANA timezone (e.g. "America/New_York")',
  ),
```

### 7. `bio`/`avatarUrl` being `.optional()` collapses "omitted" and "explicit null" into the same DB write — lines 8–9, 31–32, 40–41

```ts
bio: z.string().max(500).optional(),
...
bio: input.bio ?? null,
```

Because the schema uses `.optional()` (allows the key to be *missing*) and
the handler then does `input.bio ?? null`, an omitted `bio` and an explicitly
sent `bio: null`... actually can't both happen here since the schema doesn't
allow `null` through at all (`z.string().optional()` rejects `null`, it only
allows `string | undefined`) — so any client that tries to explicitly clear
`bio` by sending `null` gets a 400 today, and the *only* way to clear it is
to omit the field entirely from a full `PUT` payload. That's a workable
convention for a full-replacement PUT, but it's implicit — nothing here
documents that "omit the field to clear it" is the intended contract, and if
this route is ever reused for a partial-update (`PATCH`) semantics, omitting
a field currently means "clear it," not "leave it alone," which is the
opposite of what most PATCH clients expect.

**Fix:** make the intent explicit in the schema/comment, and — if a future
partial-update endpoint reuses this schema via `.partial()` — separate
"omit = don't touch" from "null = clear" by allowing both and branching on
`in` / `hasOwnProperty` rather than defaulting through `??`:

```ts
// Full-replacement PUT contract: omitting bio/avatarUrl clears them.
bio: z.string().max(500).optional(),
avatarUrl: z.string().url().optional(),
```

---

## Low / Notes (outside Zod, but worth flagging before this PR opens)

### 8. `GET /me/profile` — the `.where()` predicate looks broken — line 53

```ts
const [row] = await db.select().from(userProfiles).where((t) => t.userId === req.userId);
```

This isn't a Zod issue, but it's severe enough to call out: Drizzle's
`.where()` expects a SQL condition built with a helper like
`eq(userProfiles.userId, req.userId)`, not a plain JS predicate. As written,
`t.userId === req.userId` compares a Drizzle column object to a string using
strict equality — that's always `false` at the JS level, so (depending on
what your Drizzle version actually does with a callback like this — some
versions error at build time, others silently no-op the filter) this route
likely either throws or always falls through to the `404` branch on line
54–57, i.e. the read side of this profile feature may not work at all.
Worth a real repro/test before merge.

**Fix:**

```ts
import { eq } from 'drizzle-orm';
...
const [row] = await db.select().from(userProfiles).where(eq(userProfiles.userId, req.userId));
```

### 9. Raw DB row returned directly from both handlers — lines 49, 58

```ts
return row;
```

Per this repo's `CLAUDE.md` convention, wire contracts are `snake_case`
while the Drizzle schema/TS layer is `camelCase`, with the mapping done
*explicitly* at the route boundary (`server/src/vendor/shared/contracts/`).
Returning the raw Drizzle row here skips that mapping — the client gets
whatever casing/shape the DB row happens to have, including any internal
columns (e.g. a future `internal_notes` or audit column added to
`userProfiles`) that were never meant to be exposed. Map through an explicit
response contract instead of returning `row` as-is.

### 10. `req.userId` is used unchecked — lines 29, 53

Neither handler verifies `req.userId` is actually populated before using it
(as the insert's `userId` value, or as the `WHERE` filter). If this route can
be reached without the auth/session middleware having run — or if that
middleware fails open — `userId` being `undefined` would either violate a
NOT-NULL constraint (surfacing a raw DB error to the client) or, worse, if
the column allows nulls, upsert into a row not tied to any real user. Assert
`req.userId` is present (`app.addHook('preHandler', ...)` guard, or a check
at the top of the handler) rather than trusting it implicitly.

---

## Suggested consolidated fix

```ts
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { userProfiles } from '../db/schema.js';

const UserProfileSchema = z.object({
  displayName: z.string()
    .min(1, 'Display name is required')
    .max(80, 'Display name must be 80 characters or fewer'),
  bio: z.string().max(500, 'Bio must be 500 characters or fewer').optional(),
  avatarUrl: z.string().url('Avatar URL must be a valid URL').optional(),
  metadata: z.record(z.string(), z.unknown())
    .refine((m) => JSON.stringify(m).length <= 10_000, 'metadata payload too large'),
  timezone: z.string()
    .default('UTC')
    .refine(
      (tz) => Intl.supportedValuesOf('timeZone').includes(tz),
      'Must be a valid IANA timezone',
    ),
}).strict();

type UserProfileInput = z.infer<typeof UserProfileSchema>;

export default async function profileRoutes(app: FastifyInstance) {
  app.put('/me/profile', async (req, reply) => {
    if (!req.userId) {
      reply.status(401);
      return { error: 'Unauthorized' };
    }

    const parsed = UserProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid profile payload', issues: parsed.error.issues };
    }
    const input: UserProfileInput = parsed.data;

    const [row] = await db
      .insert(userProfiles)
      .values({
        userId: req.userId,
        displayName: input.displayName,
        bio: input.bio ?? null,
        avatarUrl: input.avatarUrl ?? null,
        metadata: input.metadata,
        timezone: input.timezone,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          displayName: input.displayName,
          bio: input.bio ?? null,
          avatarUrl: input.avatarUrl ?? null,
          metadata: input.metadata,
          timezone: input.timezone,
        },
      })
      .returning();

    reply.status(200);
    return toProfileContract(row); // explicit snake_case mapping — see finding #9
  });

  app.get('/me/profile', async (req, reply) => {
    if (!req.userId) {
      reply.status(401);
      return { error: 'Unauthorized' };
    }

    const [row] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, req.userId));

    if (!row) {
      reply.status(404);
      return { error: 'Profile not found' };
    }
    return toProfileContract(row);
  });
}
```

## Summary table

| # | Severity | Location | Issue | Zod rule |
|---|----------|----------|-------|----------|
| 1 | Critical | line 24 | `.parse()` throws, unhandled | `parse-use-safeparse` |
| 2 | Critical | line 10 | `z.any()` on `metadata` | `schema-use-unknown-not-any` |
| 3 | High | lines 14–20, 24 | manual type + unsafe `as` cast | `type-use-z-infer` |
| 4 | High | lines 6–12 | no custom error messages | `error-custom-messages` |
| 5 | Medium | lines 6–12 | no `.strict()` | `object-strict-vs-strip` |
| 6 | Medium | line 11 | `timezone` not validated against real zones | `schema-string-validations` |
| 7 | Medium | lines 8–9, 31–32, 40–41 | optional vs nullable semantics undocumented | `object-optional-vs-nullable` |
| 8 | Low (bug) | line 53 | broken `.where()` predicate, likely non-functional GET | — (Drizzle, not Zod) |
| 9 | Low | lines 49, 58 | raw row returned, bypasses repo's snake_case contract convention | — (project convention) |
| 10 | Low | lines 29, 53 | `req.userId` used without a presence check | — (auth boundary) |
