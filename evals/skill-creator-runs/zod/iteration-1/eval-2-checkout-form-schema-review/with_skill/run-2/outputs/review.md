# Code Review — `checkout-form-schema.ts`

Reviewed with the `zod` skill's rule set (43 rules / 8 categories). File under
review: `.claude/skills/zod-workspace/fixtures/checkout-form-schema.ts`
(not modified). Context: this schema is about to be **reused in a new flow**,
so composability and the shape of errors it produces matter as much as the
validation rules themselves.

## Headline finding: the schema can't be composed for the new flow as written

**Location:** lines 11–24 (`CheckoutFormSchema` definition, `.refine()` at the end).

```ts
export const CheckoutFormSchema = z.object({
  ...
}).refine((data) => { ... }, { message: '...' });
```

**Why it matters:** `.refine()` (and `.superRefine()`) turn a `ZodObject`
into a `ZodEffects` wrapper. `ZodEffects` does **not** expose `.pick()`,
`.omit()`, `.extend()`, `.merge()`, or `.shape` — the exact tools you'd reach
for to build a variant of this schema for a new flow (e.g. a "billing-only"
step, a partial update, or a schema that adds/drops a field). Today,
`CheckoutFormSchema.pick({ email: true })` or
`CheckoutFormSchema.extend({ giftMessage: z.string() })` will fail to
typecheck/compile. This is exactly the kind of gotcha the task description
asked to sanity-check before reuse — it will surface the moment the new flow
tries to derive a variant, not before.

Related rules: `object-pick-omit`, `object-extend-for-composition`,
`compose-shared-schemas`.

**Suggested fix:** split the plain object schema from the refined
(validation-ready) one, and export both:

```ts
export const CheckoutFormObjectSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(120),
  shippingAddress: AddressSchema,
  billingAddress: AddressSchema.optional(),
  sameAsShipping: z.boolean().default(true),
  promoCode: z.string().min(1).max(24).optional(),
  cardLastFour: z.string().regex(/^\d{4}$/),
});

export const CheckoutFormSchema = CheckoutFormObjectSchema.superRefine((data, ctx) => {
  if (!data.sameAsShipping && !data.billingAddress) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Billing address is required when it differs from shipping',
      path: ['billingAddress'],
    });
  }
});
```

The new flow (and anything else that needs a variant) composes off
`CheckoutFormObjectSchema`; direct form submission validates against the
refined `CheckoutFormSchema`.

---

## Critical issues

### 1. `.refine()` throws instead of returning `false` — breaks `ZodError` handling

**Location:** lines 19–24.

```ts
}).refine((data) => {
  if (!data.sameAsShipping && !data.billingAddress) {
    throw new Error('Billing address is required when it differs from shipping');
  }
  return true;
}, { message: 'Billing address is required when it differs from shipping' });
```

**Why it matters:** Zod does not catch exceptions thrown from inside a
`.refine()` predicate — they propagate straight out of `.parse()` /
`.safeParse()` as a plain `Error`, not a `ZodError`. Any caller that does
`error instanceof z.ZodError` (a very common pattern for turning validation
failures into a 400 response) will fall through to its generic
error handler and likely return a 500 instead of a structured validation
error. It also means the two `message` strings (the thrown one and the one
in the options object) are redundant — only one is ever reached, but it's
non-obvious which one from reading the code. This is worse in a *new* flow
that hasn't been manually tested against this exact edge case yet.

Related rule: `error-avoid-throwing-in-refine`.

**Suggested fix:** return a boolean (see the `superRefine` rewrite above, or
minimally):

```ts
}).refine(
  (data) => data.sameAsShipping || !!data.billingAddress,
  { message: 'Billing address is required when it differs from shipping' }
);
```

### 2. `validateCheckoutForm` uses `.parse()` on `unknown` input

**Location:** lines 48–50.

```ts
export function validateCheckoutForm(payload: unknown): CheckoutForm {
  return CheckoutFormSchema.parse(payload);
}
```

**Why it matters:** the parameter is explicitly typed `unknown`, i.e. this
is meant as a boundary function for untrusted input. `.parse()` throws on
failure, which (combined with issue #1) means callers get an inconsistent
mix of raw `Error` and `ZodError` thrown out of the same function. Wrapping
a form validator in `.parse()` pushes error handling onto every call site
(try/catch) instead of giving them a typed result they can branch on. This
is the single riskiest thing to carry into a new flow blind, since the new
call site may not replicate whatever try/catch discipline the current one
has around this call.

Related rule: `parse-use-safeparse`.

**Suggested fix:**

```ts
export function validateCheckoutForm(payload: unknown) {
  return CheckoutFormSchema.safeParse(payload); // { success, data } | { success: false, error }
}
```

If callers genuinely want throw-on-invalid semantics, keep `parse()` but fix
issue #1 first so it reliably throws `ZodError`, and document that contract.

### 3. `email` has no format validation

**Location:** line 12.

```ts
email: z.string(),
```

**Why it matters:** any non-empty *or empty* string passes — `""`,
`"not-an-email"`, whitespace. For a checkout flow this email is almost
certainly used for order confirmation / receipt delivery, so a malformed
value fails silently downstream (bounced email, no confirmation sent) rather
than being rejected at the boundary where the user can fix it immediately.

Related rule: `schema-string-validations`.

**Suggested fix:**

```ts
email: z.string().min(1).email(),
```

### 4. `cardLastFour` accepts non-digit characters

**Location:** line 18.

```ts
cardLastFour: z.string().length(4),
```

**Why it matters:** `.length(4)` only constrains character count —
`"abcd"`, `"12-4"`, `"    "` all pass. This field almost certainly feeds a
display string ("•••• 1234") or a lookup against a payment processor token;
accepting non-digits either corrupts that display or causes a downstream
type/parsing failure that's harder to trace back to input validation than a
Zod rejection at the boundary.

Related rule: `schema-string-validations` (regex for custom patterns).

**Suggested fix:**

```ts
cardLastFour: z.string().regex(/^\d{4}$/, 'Must be exactly 4 digits'),
```

---

## Medium-priority issues

### 5. `country` accepts any 2-character string

**Location:** line 8.

```ts
country: z.string().length(2),
```

**Why it matters:** `.length(2)` passes `"zz"`, `"12"`, `"!!"` — nothing
ties it to actual ISO-3166-1 alpha-2 codes. If the new flow uses `country`
to branch logic (tax rules, shipping carriers, currency), an unvalidated
2-char string is a silent-failure source that's easy to miss in review
because the field *looks* constrained.

Related rule: `schema-use-enums`.

**Suggested fix:** at minimum, restrict the character class; ideally back it
with a shared enum of supported countries so invalid/unsupported codes are
rejected at the boundary instead of failing deeper in business logic:

```ts
// minimum
country: z.string().regex(/^[A-Z]{2}$/, 'Use ISO-3166 alpha-2, uppercase'),

// better, if the set of supported countries is known
const SupportedCountry = z.enum(['US', 'CA', 'GB', /* ... */]);
```

### 6. No `path` on the cross-field `.refine()`

**Location:** lines 19–24 (same block as issue #1).

**Why it matters:** without `path`, the resulting issue attaches to the
object root, not to `billingAddress`. `result.error.flatten().fieldErrors`
will have nothing for `billingAddress`, and any form UI driven by
`fieldErrors` (React Hook Form, plain field-level error display, etc.) won't
be able to highlight the right field — it'll only show up in `formErrors`,
which most UIs render as a generic banner. This directly affects how usable
the error is in whatever new UI consumes this schema.

Related rule: `refine-add-path`.

**Suggested fix:** included in the `superRefine` rewrite above
(`path: ['billingAddress']`); if staying with `.refine()`, add
`path: ['billingAddress']` to the options object.

### 7. No explicit unknown-key policy on the top-level object

**Location:** lines 11–18.

**Why it matters:** Zod objects default to `.strip()` — unknown keys are
silently dropped. That's invisible right now, but it's exactly the kind of
thing that bites during reuse: if the new flow's payload has a slightly
different shape (extra field, renamed field, stale field from a shared
form component), this schema will happily strip it and return "valid" data
missing what the new flow expected, instead of failing loudly. Since this
schema is being deliberately reused rather than left in its original
single-flow context, it's worth being explicit here rather than relying on
the default.

Related rule: `object-strict-vs-strip`.

**Suggested fix:** decide deliberately and make it explicit:

```ts
export const CheckoutFormObjectSchema = z.object({ ... }).strict();
// or, if the intent really is "ignore extra fields":
export const CheckoutFormObjectSchema = z.object({ ... }).strip();
```

`.strict()` is the safer default for a schema that's about to gain a second
call site.

### 8. Manual `CheckoutForm` interface duplicates the schema instead of using `z.infer`

**Location:** lines 26–46.

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

**Why it matters:** this is a second, hand-maintained source of truth for
the same shape `CheckoutFormSchema` already describes. It happens to match
today, but the moment either is edited independently (which is likely once
a second flow starts touching this file) they drift — e.g. someone
tightens `promoCode` to `.min(1)` in the schema and forgets the interface
still says `string | undefined` with no length info, or adds a field to one
and not the other. TypeScript won't catch the drift because the interface
isn't derived from the schema.

Related rule: `type-use-z-infer`.

**Suggested fix:**

```ts
export type CheckoutForm = z.infer<typeof CheckoutFormObjectSchema>;
```

Drop the manual interface entirely once the schema is the single source of
truth.

---

## Minor / worth a second look before reuse

- **`promoCode` allows an empty string** (line 17: `z.string().max(24).optional()`,
  no `.min(1)`). `""` and "field omitted" become two different representations
  of "no promo code" reaching downstream code. Add `.min(1)` so an empty
  string is rejected rather than silently accepted.

- **`sameAsShipping` defaults to `true`** (line 16). That default encodes a
  business assumption ("most checkouts ship and bill to the same address")
  that held for the original flow. Before reusing this schema, confirm the
  new flow wants the same default — e.g. a B2B or gift-shipping flow might
  want no default (force the caller to be explicit) rather than silently
  assuming same-address.

- **`postalCode: z.string().min(3).max(12)`** (line 7) is a reasonable loose
  bound across locales, but it's worth double-checking against whatever
  countries the new flow needs to support — it's not wrong, just worth
  confirming it wasn't tuned for the original flow's specific country list.

---

## What's already good (worth keeping in the new flow)

- `AddressSchema` is extracted once and reused for both `shippingAddress`
  and `billingAddress` (lines 3–9, 14–15) — exactly the pattern
  `compose-shared-schemas` recommends. Keep this when restructuring per the
  headline finding above.
- `optional()` vs. required is used correctly for fields that are genuinely
  absent-or-present (`billingAddress`, `promoCode`, `line2`) rather than
  reaching for `nullable()` — no `object-optional-vs-nullable` confusion here.
- The schema and its type are both exported (`type-export-schemas-and-types`
  in spirit), even though the type should be derived via `z.infer` rather
  than hand-written (see issue #8).

---

## Priority summary

| # | Issue | Line(s) | Priority |
|---|---|---|---|
| — | `.refine()` blocks future `.pick()/.omit()/.extend()` composition | 11–24 | **Blocks the stated reuse** |
| 1 | `throw` inside `.refine()` produces a non-`ZodError` | 19–24 | Critical |
| 2 | `.parse()` on `unknown` input instead of `.safeParse()` | 48–50 | Critical |
| 3 | `email` has no `.email()` validation | 12 | Critical |
| 4 | `cardLastFour` accepts non-digits | 18 | Critical |
| 5 | `country` accepts any 2-char string | 8 | Medium |
| 6 | Cross-field `.refine()` has no `path` | 19–24 | Medium |
| 7 | No explicit `.strict()`/`.strip()` policy | 11–18 | Medium |
| 8 | Hand-written interface instead of `z.infer` | 26–46 | Medium |
| — | `promoCode` allows empty string | 17 | Minor |
| — | `sameAsShipping` default may not fit the new flow | 16 | Minor (confirm intent) |
| — | `postalCode` bounds worth re-checking against new flow's countries | 7 | Minor (confirm intent) |
