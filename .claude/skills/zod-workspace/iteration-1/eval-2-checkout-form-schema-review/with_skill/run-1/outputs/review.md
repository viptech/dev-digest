# Код-рев'ю: `checkout-form-schema.ts`

**Файл:** `.claude/skills/zod-workspace/fixtures/checkout-form-schema.ts`
**Контекст:** схему планується перевикористати в новому флоу — тобто вона стає спільним контрактом, а не одноразовим кодом однієї форми. Це піднімає планку: усе, що зараз "працює й так" через специфіку одного use-case, під час перевикористання перетвориться на прихований баг у новому місці.

Рев'ю зроблено за чек-листом skill `zod` (43 правила, 8 категорій). Нижче — тільки ті пункти, де фактичний код відхиляється від правила, з посиланням на рядок, поясненням "чому це важливо" і конкретним фіксом.

## Підсумкова таблиця

| # | Рядок(и) | Проблема | Impact | Правило skill |
|---|---|---|---|---|
| 1 | 19–24 | `throw` всередині `.refine()` — **емпірично ламає навіть `safeParse()`** | CRITICAL | `error-avoid-throwing-in-refine` |
| 2 | 48–50 | `validateCheckoutForm` використовує `.parse()` для user input | CRITICAL | `parse-use-safeparse` |
| 3 | 12 | `email: z.string()` без `.email()` | CRITICAL | `schema-string-validations` |
| 4 | 18 | `cardLastFour: z.string().length(4)` пропускає нецифрові символи | HIGH | `schema-string-validations` |
| 5 | 26–46 | Ручний `interface CheckoutForm`, що дублює схему | HIGH | `type-use-z-infer` |
| 6 | 19–24 | `.refine()` без `path` — помилка "втрачається" на рівні об'єкта | MEDIUM | `refine-add-path` |
| 7 | 4, 6, 13, 30-та ін. | Немає `.trim()` — рядки з пробілів проходять `min(1)` | MEDIUM-HIGH | `schema-string-validations` |
| 8 | 11–24 | Об'єкт без `.strict()` — зайві поля тихо відкидаються | MEDIUM-HIGH | `object-strict-vs-strip` |
| 9 | 3, 15 | `AddressSchema` не експортується — блокує заявлене перевикористання | MEDIUM | `compose-shared-schemas`, `type-export-schemas-and-types` |
| 10 | 12–24 | Немає кастомних повідомлень про помилки | HIGH | `error-custom-messages` |
| 11 | 15, 19–24 | `billingAddress?` + `refine` замість дискримінованого union/`superRefine` | MEDIUM-HIGH | `object-discriminated-unions`, `refine-vs-superrefine` |

---

## 1. `throw` у `.refine()` ламає `safeParse()` — не тільки "погана практика" (рядки 19–24)

```ts
.refine((data) => {
  if (!data.sameAsShipping && !data.billingAddress) {
    throw new Error('Billing address is required when it differs from shipping');
  }
  return true;
}, { message: 'Billing address is required when it differs from shipping' });
```

**Чому це важливо, і чому це серйозніше, ніж здається:** правило `error-avoid-throwing-in-refine` каже, що throw усередині `refine` зупиняє збір інших помилок. Але тут проблема глибша — я перевірив це на реальному `zod@3.24.1`, який стоїть у цьому репозиторії (`reviewer-core/node_modules/zod`):

```
$ node -e "
const { z } = require('zod');
const s = z.object({ a: z.string() }).refine((d) => { throw new Error('boom'); }, { message: 'x' });
s.safeParse({ a: 'hi' });
"
Error: boom
    at ... ZodEffects._parse ...
    at ZodEffects.safeParse ...
```

`safeParse()` **не ловить** цей кинутий `Error` і не перетворює його на `{ success: false }` — виняток вилітає з `safeParse()` як звичайний uncaught exception. Тобто якщо новий флоу (розумно) перепише `validateCheckoutForm` на `safeParse`, щоб акуратно повернути 400 користувачу (правило #2 нижче), ця гілка коду все одно впаде некерованим винятком і, найімовірніше, обвалить обробник запиту. Це вже не стилістичне зауваження — це прихована бомба, що спрацює саме тоді, коли хтось «правильно» виправить виклик `.parse()`.

**Фікс:**

```ts
.refine(
  (data) => data.sameAsShipping || !!data.billingAddress,
  {
    message: 'Billing address is required when it differs from shipping',
    path: ['billingAddress'], // див. пункт 6
  }
);
```

## 2. `validateCheckoutForm` кидає виняток на user input замість `safeParse()` (рядки 48–50)

```ts
export function validateCheckoutForm(payload: unknown): CheckoutForm {
  return CheckoutFormSchema.parse(payload);
}
```

**Чому це важливо:** `payload: unknown` явно сигналізує "дані ззовні, не довіряємо". `.parse()` кидає `ZodError` на будь-яку невалідність — виклик API повинен або обгортати кожен виклик у `try/catch`, або впаде некеровано. У новому флоу викликач може не знати про цей контракт (особливо якщо ця функція стає спільною утилітою), і "500 з стек-трейсом користувачу" — типовий наслідок, який правило `parse-use-safeparse` прямо описує.

**Фікс:** повернути `SafeParseReturnType`-подібний результат, а не кидати:

```ts
export function validateCheckoutForm(
  payload: unknown
): { success: true; data: CheckoutForm } | { success: false; error: z.ZodError } {
  const result = CheckoutFormSchema.safeParse(payload);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}
```

Якщо є конкретний boundary-код (наприклад, роут у server/), де перехоплення `ZodError` уже стандартизоване — тоді `.parse()` прийнятний, але тоді контракт варто задокументувати явно в JSDoc, бо назва `validateCheckoutForm` цього не підказує.

## 3. `email: z.string()` без формату (рядок 12)

```ts
email: z.string(),
```

**Чому це важливо:** пропускає будь-який рядок — `"not-an-email"`, порожній рядок теж пройде (бо немає навіть `.min(1)`). Для checkout-форми, де email використовується для чеків/сповіщень, це не крайовий випадок, а гарантований баг при переносі в новий флоу, де хтось покладеться на те, що "якщо пройшло валідацію — це email".

**Фікс:**

```ts
email: z.string().min(1, 'Email is required').email('Invalid email address').trim().toLowerCase(),
```

## 4. `cardLastFour: z.string().length(4)` не перевіряє, що це цифри (рядок 18)

```ts
cardLastFour: z.string().length(4),
```

**Чому це важливо:** `"abcd"`, `"!@#$"`, `" 12"` (з пробілом) — усе довжиною 4 і все пройде. "Останні 4 цифри картки" мають бути саме цифрами; будь-яке відображення в UI (`•••• {cardLastFour}`) чи звірка з платіжним провайдером зламається на нечислових значеннях.

**Фікс:**

```ts
cardLastFour: z.string().regex(/^\d{4}$/, 'Must be exactly 4 digits'),
```

## 5. Ручний `interface CheckoutForm` дублює схему (рядки 26–46)

```ts
export interface CheckoutForm {
  email: string;
  fullName: string;
  shippingAddress: { line1: string; line2?: string; ... };
  ...
}
```

**Чому це важливо:** це рівно антипатерн, який описує `type-use-z-infer` — тип підтримується вручну паралельно зі схемою. Якщо в новому флоу хтось додасть/змінить поле в `CheckoutFormSchema` (наприклад, додасть `phone`), цей `interface` мовчки розійдеться зі схемою: TypeScript не попередить, а функція `validateCheckoutForm` продовжить компілюватись, повертаючи тип, який вже не відповідає реальним даним із `.parse()`. Тут особливо небезпечно, бо `line2?: string` в інтерфейсі вручну повторює nullability/optionality схеми (рядок 5) — одна розсинхронізація (`.nullable()` замість `.optional()`, наприклад) — і тип бреше мовчки.

**Фікс:**

```ts
export const CheckoutFormSchema = z.object({ /* ... */ });
export type CheckoutForm = z.infer<typeof CheckoutFormSchema>;
```

Прибрати ручний `interface` повністю.

## 6. `.refine()` без `path` — помилка "губиться" на рівні об'єкта (рядки 19–24)

**Чому це важливо:** без `path` результат `error.flatten()` покаже помилку в `formErrors`, а не в `fieldErrors.billingAddress`. У новому флоу, якщо UI показує помилки поруч із конкретним полем (типовий патерн форм), ця помилка або взагалі не покажеться користувачу, або зʼявиться як незрозумілий банер зверху форми без прив'язки до `billingAddress`.

**Фікс:** див. приклад у пункті 1 — додати `path: ['billingAddress']`.

## 7. Немає `.trim()` — рядки з самих пробілів проходять `min(1)` (рядки 4, 6, 13 та відповідні поля адреси)

```ts
line1: z.string().min(1),
city: z.string().min(1),
fullName: z.string().min(1).max(120),
```

**Чому це важливо:** `"   ".length === 3`, тобто `min(1)` пропускає рядок із самих пробілів як "непорожній". Для `fullName`/`line1`/`city` це означає, що формально валідні дані можуть бути семантично порожніми — адреса без вулиці, ім'я з одних пробілів. Це саме той клас проблем, який `schema-string-validations` явно перелічує серед типових пропусків.

**Фікс:**

```ts
fullName: z.string().trim().min(1, 'Full name is required').max(120),
// аналогічно для line1, city; postalCode варто ще й .toUpperCase() за потреби формату
```

## 8. Об'єкт без `.strict()` — зайві поля тихо відкидаються (рядки 11–24)

**Чому це важливо:** зараз схема в default strip-режимі. Це не помилка саме по собі, але при перевикористанні в новому флоу — де форма могла б, наприклад, додатково приймати `giftMessage` чи `couponMeta` — будь-яке поле, якого немає в схемі, мовчки зникне після `.parse()`/`.safeParse()`, і діагностувати "чому дані не долетіли" буде важче, ніж отримати явну помилку "Unrecognized key". Для форми-контракту, що йде на новий флоу, варто зробити вибір явним, а не покладатися на default.

**Фікс:** `.strict()` для явного відхилення невідомих полів, якщо схема — контракт "точно ці поля і жодних інших":

```ts
export const CheckoutFormSchema = z.object({ /* ... */ }).strict().refine(/* ... */);
```

## 9. `AddressSchema` не експортується — суперечить заявленій меті "перевикористати" (рядок 3)

```ts
const AddressSchema = z.object({ /* ... */ });
```

**Чому це важливо:** ви прямо кажете, що плануєте перевикористати схему в новому флоу. `AddressSchema` — найімовірніший кандидат на перевикористання окремо (наприклад, флоу редагування адреси доставки без усього checkout). Зараз вона `const` без `export`, тобто новий флоу або продублює її з нуля (класичний дрейф, який описує `compose-shared-schemas`), або muddy-імпортуватиме внутрішній файл в обхід публічного API модуля.

**Фікс:**

```ts
export const AddressSchema = z.object({ /* ... */ });
export type Address = z.infer<typeof AddressSchema>;
```

## 10. Відсутні кастомні повідомлення про помилки (рядки 12–24)

**Чому це важливо:** усі валідатори (`min`, `max`, `length`) використовують дефолтні повідомлення Zod ("String must contain at least 1 character(s)" тощо) — технічні й не прив'язані до конкретного поля форми. У новому флоу, де UI-шар може відрізнятись від поточного (можливо, без кастомного маппінгу помилок, який, ймовірно, існує зараз для оригінальної форми), це напряму потрапить в очі користувачу.

**Фікс:** додати повідомлення inline, як у прикладах вище (`z.string().min(1, 'City is required')` тощо) — по одному на кожен валідатор, що реально може впасти.

## 11. `billingAddress?` + `refine` — умовна обов'язковість через optional+refine, а не через структуру (рядки 15, 19–24)

**Чому це важливо:** це не "неправильно", але це MEDIUM-HIGH за class відхилення, яке варто врахувати саме тому, що схема йде на новий флоу. Правило `object-discriminated-unions`/`refine-vs-superrefine` рекомендує, коли наявність поля залежить від значення іншого поля, моделювати це структурно, а не постфактум-перевіркою:

```ts
sameAsShipping: z.literal(true) → billingAddress необов'язковий
sameAsShipping: z.literal(false) → billingAddress обов'язковий
```

Поточний підхід (optional-поле + окремий `refine`) працює, але має два практичні недоліки саме в контексті перевикористання: (а) TypeScript не звужує тип — `billingAddress` завжди `Address | undefined` у виведеному типі, і код нижче за течією (new flow) все одно змушений робити ручний null-check, навіть коли `sameAsShipping === false` логічно гарантує наявність адреси; (б) кожен новий бізнес-правило такого типу означає ще один `.refine()`, тоді як `superRefine` дозволяє звести їх в одне місце з кількома `path`-прив'язаними помилками одразу (корисно, якщо в новому флоу зʼявиться більше умовних полів).

**Фікс (мінімальний, без структурної переробки):** залишити поточну форму, але виправити throw (п.1) і додати path (п.6) — цього достатньо для коректності. Розглянути дискримінований union лише якщо в новому флоу зʼявляться додаткові умовні поля — тоді вигода переважить складність рефакторингу.

---

## Що можна залишити як є

- Використання спільної `AddressSchema` для `shippingAddress`/`billingAddress` замість дублювання структури — правильний патерн композиції (`compose-shared-schemas`), лише бракує `export` (п.9).
- `sameAsShipping: z.boolean().default(true)` — коректне використання `.default()` для boolean-прапорця з розумним дефолтом.
- Схема закешована на рівні модуля (не створюється динамічно в hot path) — відповідає `perf-cache-schemas`.

## Пріоритет виправлень перед перевикористанням

1. **Обов'язково перед реюзом:** п.1 (throw ламає safeParse), п.2 (parse → safeParse на боундарі), п.3 (email format), п.4 (cardLastFour digits-only), п.5 (z.infer замість ручного interface).
2. **Дуже бажано:** п.6 (path у refine), п.7 (trim), п.9 (export AddressSchema).
3. **На розсуд команди залежно від нового флоу:** п.8 (.strict()), п.10 (custom messages), п.11 (discriminated union).
