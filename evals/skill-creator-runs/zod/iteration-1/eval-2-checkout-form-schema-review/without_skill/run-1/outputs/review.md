# Code Review: `checkout-form-schema.ts`

Reviewed file: `.claude/skills/zod-workspace/fixtures/checkout-form-schema.ts`

Scope: sanity-check ahead of reuse in a new flow. Issues below are ordered
roughly by severity (correctness/security bugs first, then maintainability,
then polish).

---

## Critical

### 1. `refine()` throws instead of returning `false` — breaks `safeParse()` and swallows the custom message (lines 19–24)

```ts
}).refine((data) => {
  if (!data.sameAsShipping && !data.billingAddress) {
    throw new Error('Billing address is required when it differs from shipping');
  }
  return true;
}, { message: 'Billing address is required when it differs from shipping' });
```

**Why it matters:** a `refine` predicate is expected to return (or resolve to)
a boolean. This one never returns `false` — on the failing branch it
`throw`s a plain `Error` instead. Two consequences:

- **`safeParse()` no longer "safely" parses.** Callers that rely on Zod's
  contract of "`safeParse` never throws, check `result.success`" will get an
  uncaught exception instead of `{ success: false, error }`. Any new flow
  that swaps `.parse()` for `.safeParse()` (a very likely thing to do when
  reusing this schema in, say, a form-handling hook) will crash instead of
  surfacing a validation error.
- **The `message: '...'` option passed to `refine` is dead code.** Since the
  predicate never returns `false`, Zod's own issue-generation path (the one
  that would actually use that message) is never exercised — the thrown
  `Error` short-circuits it and produces a different, non-`ZodError` object
  entirely. `error instanceof z.ZodError` checks downstream will fail to
  catch it.

**Suggested fix:**

```ts
}).refine(
  (data) => data.sameAsShipping || Boolean(data.billingAddress),
  {
    message: 'Billing address is required when it differs from shipping',
    path: ['billingAddress'],
  },
);
```

Also add `path: ['billingAddress']` (see next item) so the resulting
`ZodError` can be mapped to the right form field instead of the schema root.

---

### 2. `cardLastFour` only checks length, not digits (line 18)

```ts
cardLastFour: z.string().length(4),
```

**Why it matters:** this validates *string length*, not that the string is
numeric. `"abcd"`, `"12a4"`, or `"----"` all satisfy `.length(4)`. Whatever
consumes `cardLastFour` downstream (display formatting like `•••• 1234`,
matching against a payment-processor token, receipts) almost certainly
assumes digits. Letting non-digit garbage through the schema pushes that bug
into runtime code that has no reason to re-validate it.

**Suggested fix:**

```ts
cardLastFour: z.string().regex(/^\d{4}$/, 'Must be 4 digits'),
```

**Separate flag, not a fix but worth raising before reuse:** if this field is
ever populated from a raw card number entered directly into this form (as
opposed to being handed back by a PCI-compliant payment element/tokenizer,
e.g. Stripe Elements), that's a data-handling/compliance question worth
resolving before wiring up the new flow — full card numbers should never
transit your own server or schema layer unless you're SAQ-D-scoped for PCI
DSS. Confirm where `cardLastFour` is actually sourced from before reusing
this shape.

---

## High

### 3. `email` has no email-format validation (line 12)

```ts
email: z.string(),
```

**Why it matters:** any non-empty-or-even-empty string passes — `""`, `"x"`,
`"not-an-email"`. For a checkout flow this typically feeds an order
confirmation / receipt email; a malformed value fails silently downstream
(bounced email, no error surfaced to the user at the point they could still
fix it).

**Suggested fix:**

```ts
email: z.string().trim().min(1).email(),
```

### 4. `country` accepts any 2-character string, not a real country code (line 8)

```ts
country: z.string().length(2),
```

**Why it matters:** `.length(2)` passes `"zz"`, `"12"`, `"xx"` — anything
that isn't a valid ISO-3166-1 alpha-2 code. If `postalCode` format or
shipping-rate logic in the new flow branches on `country`, an invalid code
either silently falls through to a default/unhandled case or throws
somewhere far from where the bad data was accepted.

**Suggested fix:** at minimum enforce uppercase letters:

```ts
country: z.string().regex(/^[A-Z]{2}$/),
```

Better, if the set of supported countries is known and bounded, use
`z.enum([...])` so unsupported countries are rejected at the schema
boundary rather than a business-logic layer.

---

## Medium

### 5. Hand-duplicated `CheckoutForm` interface will drift from the schema (lines 26–46)

```ts
export interface CheckoutForm {
  email: string;
  fullName: string;
  shippingAddress: { line1: string; line2?: string; city: string; postalCode: string; country: string; };
  billingAddress?: { ... };
  sameAsShipping: boolean;
  promoCode?: string;
  cardLastFour: string;
}
```

**Why it matters:** this is the same shape `CheckoutFormSchema` already
produces, written out by hand a second time. The moment someone adds,
renames, or removes a field on the schema (very likely, given this is being
reused for a new flow) without remembering to mirror the change here, the
type and the runtime validator silently disagree — `validateCheckoutForm`'s
return type no longer reflects what `.parse()` actually returns/rejects, and
TypeScript won't catch the mismatch because both sides typecheck
independently.

**Suggested fix:** derive the type instead of duplicating it:

```ts
export type CheckoutForm = z.infer<typeof CheckoutFormSchema>;
```

(`sameAsShipping`'s `.default(true)` already makes the *output* type
non-optional `boolean`, matching the current hand-written interface, so this
swap is behavior-preserving.)

### 6. String fields aren't trimmed — whitespace-only values pass (lines 4, 6, 13)

```ts
line1: z.string().min(1),
city: z.string().min(1),
fullName: z.string().min(1).max(120),
```

**Why it matters:** `.min(1)` counts characters, not meaningful content.
`" "` (a single space) satisfies `min(1)` for `fullName`, `line1`, and
`city`, producing a "valid" checkout form with a blank name/address line.

**Suggested fix:**

```ts
fullName: z.string().trim().min(1).max(120),
```

(same pattern for `line1`, `city`).

### 7. No upper bound on `line1`/`city` (lines 4, 6)

**Why it matters:** unbounded string length accepted by the schema means the
first real limit these values hit is whatever the database column / storage
layer enforces (or none). If reused in a new flow that persists this data,
that's a schema-imposed contract worth having explicitly rather than
discovering it via a DB error.

**Suggested fix:** add a reasonable `.max(...)`, e.g. `.max(200)`, matching
whatever the storage layer actually allows.

---

## Minor / worth confirming before reuse

- **`postalCode: z.string().min(3).max(12)` (line 7)** — a generic
  length range across all countries is loose (real postal codes vary widely
  in format, e.g. `"12345"` vs `"SW1A 1AA"`). Fine as a first pass, but if
  the new flow needs stricter validation per country, this will need to
  become country-aware (e.g. `superRefine` keyed off `country`).
- **`promoCode: z.string().max(24).optional()` (line 17)** — allows an
  empty string `""` as a "present" promo code (`optional()` only allows
  `undefined`, not blank). If empty-string promo codes shouldn't reach
  downstream code, add `.min(1)` or transform `""` to `undefined`.
- **No `.strict()`/`.passthrough()` decision documented** — `z.object` here
  uses Zod's default "strip unknown keys" behavior. That's usually the right
  default, but worth a conscious note if the new flow's client can send
  extra fields you'd rather reject loudly (`.strict()`) than silently drop.
- **`billingAddress` and `refine` interaction is a little implicit** —
  worth a one-line comment on the schema explaining the
  `sameAsShipping`/`billingAddress` invariant, since it's now enforced only
  inside the `refine` callback and not obvious from the field declarations
  alone.

---

## Summary

Before reusing this schema as-is, the two **Critical** items should be fixed
first — the `refine`/`throw` bug is a functional correctness issue that will
misbehave the moment `safeParse()` is used anywhere (very likely in a new
flow), and the `cardLastFour` length-only check lets non-digit values
through a field that's almost certainly assumed numeric downstream. The
**High** items (`email`, `country`) are cheap, standard Zod validators that
close real gaps. The duplicated `CheckoutForm` interface (Medium #5) is the
one most likely to bite silently over time as the schema evolves under the
new flow — recommend switching to `z.infer` before extending this schema
further.
