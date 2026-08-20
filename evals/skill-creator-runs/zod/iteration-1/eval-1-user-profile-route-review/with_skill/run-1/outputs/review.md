# Code Review: `PUT/GET /me/profile`

Файл: `.claude/skills/zod-workspace/fixtures/user-profile-schema.ts`

Огляд зроблено з опорою на skill `zod` (43 правила, категорії `schema-*`,
`parse-*`, `type-*`, `object-*`) плюс кілька зауважень поза Zod, які впливають
на безпеку/коректність цього конкретного роута. Посилання на конкретні
правила skill наведено в дужках.

---

## Критичні проблеми

### 1. `metadata: z.any()` — повна відмова від типобезпеки (line 10)

```ts
metadata: z.any(),
```

`z.any()` вимикає перевірку типів TypeScript для всього, що піде далі
(`input.metadata` на lines 33 і 42), і **не валідує форму/розмір значення
взагалі** — клієнт може надіслати що завгодно: рядок, масив, 5 МБ вкладеного
JSON, `null`, навіть функцію-подібний об'єкт після серіалізації. Це і
проблема типобезпеки, і проблема ресурсів: немає межі на розмір, а поле йде
прямо в `insert`/`onConflictDoUpdate` без жодного бар'єру.

Skill: `schema-use-unknown-not-any` (CRITICAL) — «z.any() bypasses
TypeScript's type system entirely; z.unknown() forces type narrowing before
use».

**Фікс.** Мінімум — `z.unknown()`, щоб хоч TS змушував звужувати тип перед
використанням. Краще — визначити реальну форму `metadata` (навіть
`z.record(z.string(), z.unknown())` з обмеженням розміру через `.refine()`),
якщо відомо, що там завжди об'єкт:

```ts
metadata: z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 10_000, 'metadata too large')
  .default({}),
```

---

### 2. `.parse()` на необробленому `req.body`, без обробки помилки (line 24)

```ts
const input = UserProfileSchema.parse(req.body) as UserProfileInput;
```

`parse()` кидає `ZodError` при невалідних даних. Тут виклик нічим не
огорнутий — жодного `try/catch`, жодного явного 400-відповіді. Якщо у файлі
немає гарантованого глобального `setErrorHandler`, що розпізнає `ZodError`,
кожен невалідний `PUT` завершиться непередбачуваною відповіддю сервера
(у гіршому випадку — 500 зі стек-трейсом клієнту). Навіть якщо десь є
глобальний хендлер, роут явно не контролює формат помилки (`400` +
структуровані `issues`), що потрібно для нормального UX форми.

Skill: `parse-use-safeparse` (CRITICAL) — «parse() throws exceptions on
invalid data; unhandled exceptions crash servers and expose stack traces to
users». Пов'язано також з `parse-validate-early` — валідація на межі системи
має явно повертати керовану відповідь, а не покладатись на випадкове
перехоплення нижче по стеку.

**Фікс:**

```ts
const parsed = UserProfileSchema.safeParse(req.body);
if (!parsed.success) {
  reply.status(400);
  return { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors };
}
const input = parsed.data; // вже типізовано правильно, без ручного каста
```

---

### 3. Схема приймає `camelCase`, хоча репозиторій жорстко фіксує `snake_case` на wire-межі (lines 6–12)

```ts
const UserProfileSchema = z.object({
  displayName: z.string().min(1).max(80),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  ...
});
```

Кореневий `CLAUDE.md` проєкту явно фіксує конвенцію: *«Wire contracts are
`snake_case` (`head_sha`, `files_count`) even though the Drizzle schema and TS
are `camelCase` — the mapping happens explicitly at the route boundary.
Contracts live in `server/src/vendor/shared/contracts/`»*. Ця схема валідує
`req.body` напряму в `camelCase` (`displayName`, `avatarUrl`) — тобто або
порушує конвенцію (клієнт має слати `display_name`, `avatar_url`), або файл
не використовує спільний контракт з `server/src/vendor/shared/contracts/`
взагалі, дублюючи його визначення тут. Обидва варіанти — привід зупинити PR
до з'ясування.

**Фікс.** Або імпортувати контракт з `server/src/vendor/shared/contracts/`
(якщо такий вже існує для профілю) і мапити `snake_case → camelCase` явно на
межі роута, або, якщо контракту ще нема, створити Zod-схему в `snake_case`
і явно перекласти поля перед вставкою в Drizzle:

```ts
const UserProfileWireSchema = z.object({
  display_name: z.string().min(1).max(80),
  bio: z.string().max(500).optional(),
  avatar_url: z.string().url().optional(),
  metadata: z.unknown(),
  timezone: z.string().default('UTC'),
});

// map snake_case → camelCase явно, як заведено в проєкті
const input = {
  displayName: parsed.data.display_name,
  bio: parsed.data.bio,
  avatarUrl: parsed.data.avatar_url,
  ...
};
```

---

### 4. `GET /me/profile`: `.where((t) => t.userId === req.userId)` майже напевно не робить того, що виглядає (line 53)

```ts
const [row] = await db.select().from(userProfiles).where((t) => t.userId === req.userId);
```

Це не Drizzle-ідіома. `.where()` очікує SQL-вираз, побудований через
оператори (`eq(userProfiles.userId, req.userId)`), а не JS-колбек, що
порівнює через `===`. `t.userId === req.userId` порівнює об'єкт колонки
(Drizzle column proxy) з рядком — це завжди `false` як булеве значення, і
сам колбек, найімовірніше, або буде проігнорований типом `.where()`
(runtime-помилка/no-op), або в кращому разі призведе до вибірки **першого
рядка всієї таблиці `userProfiles` без жодного фільтра** — тобто профіль
довільного користувача може повернутись замість профілю того, хто питав.
Це вихід за межі теми Zod, але це найгостріша проблема безпеки/коректності
у файлі, і review був би неповним без неї: PUT-роут коректно формує
`insert`/`onConflictDoUpdate`, а сусідній GET-роут поруч — ні.

**Фікс:**

```ts
import { eq } from 'drizzle-orm';
...
const [row] = await db.select().from(userProfiles).where(eq(userProfiles.userId, req.userId));
```

Обов'язково додати регресійний тест на це — саме такі помилки в
`.where()` не завжди ловляться на компіляції, залежно від типізації
`db.select()`.

---

## Високий пріоритет

### 5. Ручний тип `UserProfileInput` + `as`-каст поверх результату `.parse()` (lines 14–20, 24)

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

Це рівно антипатерн, задокументований у skill: тип дублює схему вручну і
неминуче розійдеться з нею з часом (наприклад, якщо хтось додасть поле в
схему й забуде тут — компілятор мовчки пропустить). Гірше: `.parse()` вже
повертає правильно виведений тип (`z.infer<typeof UserProfileSchema>`), і
`as UserProfileInput` **примусово перезаписує** цей правильний тип
незалежно від того, що реально виведе Zod — це саме той сценарій, де
компілятор міг би зловити помилку (наприклад, невідповідність `metadata:
any` vs `metadata: unknown` після фіксу з п.1), а каст цю можливість
глушить.

Skill: `type-use-z-infer` (HIGH) — «Manual type definitions drift from
schemas over time; z.infer guarantees types match validation exactly».

**Фікс:**

```ts
type UserProfileInput = z.infer<typeof UserProfileSchema>;
// ручний type-alias більше не потрібен — прибрати lines 14–20 повністю
const input = parsed.data; // вже UserProfileInput, без "as"
```

---

### 6. Опціональні поля + `onConflictDoUpdate` можуть мовчки затерти існуючі дані (lines 8–9, 31–32, 40–41)

```ts
bio: z.string().max(500).optional(),
avatarUrl: z.string().url().optional(),
...
bio: input.bio ?? null,
avatarUrl: input.avatarUrl ?? null,
```

Роут — один і той самий `UserProfileSchema` для *створення* й для
*оновлення* (через upsert). Якщо клієнт при оновленні профілю пришле
запит без поля `bio` (наприклад, форма редагування avatarUrl окремо від
bio), Zod пропустить це як валідне (`bio` — `optional()`), і `?? null`
перетворить відсутнє поле на `null` в `SET bio = null` у гілці
`onConflictDoUpdate` — тобто **існуючий bio користувача буде стерто**,
хоча клієнт нічого про bio не казав. Це класична пастка при перевикористанні
однієї схеми для create і update: skill описує саме цей випадок.

Skill: `object-partial-for-updates` (MEDIUM-HIGH) — партиальні поля мають
різну семантику для create («немає значення») і update («не чіпати
значення»); one-schema-fits-all тут їх плутає.

**Фікс.** Якщо ендпоінт справді семантика PUT-як-повна-заміна (клієнт
завжди шле весь профіль) — це прийнятно, але тоді варто зробити поля, які
логічно завжди мають сенс (`bio`, `avatarUrl`), `nullable()` замість
`optional()`, щоб відрізняти «явно очистити» (`null`) від «не передано»
(відсутність ключа — тоді `.strict()` або `parse` мають це відхиляти як
помилку, а не мовчки трактувати як `null`). Якщо ж потрібна часткова
семантика (PATCH-подібне оновлення), розділити на дві схеми:

```ts
const CreateProfileSchema = UserProfileSchema; // все обов'язкове, крім bio/avatarUrl
const UpdateProfileSchema = UserProfileSchema.partial(); // усе опціональне

// в SET-гілці апдейтити лише передані поля:
set: {
  ...(input.bio !== undefined && { bio: input.bio }),
  ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
  ...
}
```

---

### 7. `req.userId` використовується без явної перевірки автентифікації (lines 29, 53)

У файлі немає видимого `preHandler`/guard, що гарантує наявність
`req.userId` до виконання хендлера. Якщо роут зареєстрований поза плагіном
автентифікації (легко трапляється при рефакторингу маршрутів), `req.userId`
буде `undefined`, і `insert` впаде на NOT NULL constraint із незрозумілою
500-помилкою замість чіткого `401`. Це не суто Zod-проблема, але вплітається
в “validate at boundary”: межа роута має явно перевіряти й авторизаційний,
і структурний вхід.

**Фікс:** явна перевірка на початку хендлера (або офіційний
`preHandler: [requireAuth]` на рівні реєстрації роута, якщо такий є в
проєкті):

```ts
if (!req.userId) {
  reply.status(401);
  return { error: 'Unauthorized' };
}
```

---

## Середній пріоритет

### 8. `displayName` не тримиться — пробіли проходять `min(1)` (line 7)

```ts
displayName: z.string().min(1).max(80),
```

`min(1)` рахує довжину рядка як є. `"   "` (три пробіли) має довжину 3 і
успішно пройде валідацію, залишивши користувача з видимо порожнім ім'ям
у профілі.

Skill: `schema-string-validations` — рядкові валідації мають застосовуватись
на рівні схеми, з урахуванням реальних крайових випадків.

**Фікс:**

```ts
displayName: z.string().trim().min(1, 'Display name is required').max(80),
```

### 9. `timezone` не валідується як реальна IANA-таймзона (line 11)

```ts
timezone: z.string().default('UTC'),
```

Приймається довільний рядок — `"not-a-timezone"` пройде валідацію так само,
як `"Europe/Kyiv"`. Далі це значення, ймовірно, піде в форматування дат на
клієнті/сервері й впаде або поводитиметься непередбачувано.

**Фікс:** звузити через `refine` на `Intl.supportedValuesOf('timeZone')`
(Node 18+/сучасні браузери), або тримати статичний enum, якщо підтримується
обмежений список:

```ts
const TZ_SET = new Set(Intl.supportedValuesOf('timeZone'));
timezone: z.string().default('UTC').refine((tz) => TZ_SET.has(tz), 'Invalid IANA timezone'),
```

### 10. `avatarUrl` не обмежує протокол (line 9)

```ts
avatarUrl: z.string().url().optional(),
```

`.url()` приймає будь-яку валідну URL-схему, включно з `javascript:` (у
старих рушіях) чи `data:` — якщо це значення потім рендериться як
`<img src>` без додаткової санітизації на клієнті, це відкриває шлях до
XSS/data-exfiltration через зловмисно сформований аватар-URL.

**Фікс:**

```ts
avatarUrl: z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'avatarUrl must be http(s)')
  .optional(),
```

### 11. Немає явного `.strict()`/`.strip()` — намір щодо зайвих полів не задокументовано (lines 6–12)

За замовчуванням Zod-об'єкти працюють у режимі `.strip()` — зайві ключі з
`req.body` мовчки відкидаються. Це саме по собі не помилка, але для
route-рівневого контракту (особливо в поєднанні з п.3 про snake_case) явний
`.strict()` зловив би, наприклад, клієнт, що досі шле старі
`camelCase`/`snake_case` поля не туди, і дав би чіткий `400` замість
тихого ігнорування.

Skill: `object-strict-vs-strip` (MEDIUM-HIGH).

**Фікс:** додати `.strict()` до `UserProfileWireSchema`, якщо контракт
API вважається закритим (рекомендовано для body PUT-роута).

---

## Низький пріоритет

### 12. `reply.status(200)` для upsert, який іноді є `INSERT` (line 48)

Для першого виклику (створення профілю) семантично коректніше повернути
`201 Created`; зараз завжди `200`. Не критично, але варто узгодити з
рештою API-конвенцій проєкту — перевірити, чи `server/src/vendor/shared/
contracts/` вже фіксує очікуваний код для цього ендпоінту.

### 13. Валідація роблена вручну (`.safeParse`) замість Fastify JSON Schema / `fastify-type-provider-zod` (весь файл)

Якщо в проєкті вже є конвенція реєструвати Zod-схеми як `schema: { body,
response }` через type provider (варто перевірити `server/README.md` /
`server/CLAUDE.md`), краще піти цим шляхом: Fastify тоді сам поверне
структуровану `400`-відповідь при невалідному тілі, без ручного
`if (!parsed.success)` у кожному хендлері, і заодно провалідує/серіалізує
відповідь через `response`-схему.

---

## Підсумок пріоритетів

| # | Проблема | Рядки | Severity |
|---|---|---|---|
| 1 | `metadata: z.any()` | 10 | Critical |
| 2 | `.parse()` без обробки помилки | 24 | Critical |
| 3 | camelCase замість snake_case на wire-межі | 6–12 | Critical |
| 4 | `.where()` у GET — імовірно no-op / data leak | 53 | Critical |
| 5 | Ручний тип + `as`-каст замість `z.infer` | 14–20, 24 | High |
| 6 | Upsert через optional-поля може стерти дані | 8–9, 31–32, 40–41 | High |
| 7 | Немає явної перевірки `req.userId` | 29, 53 | High |
| 8 | `displayName` не тримиться | 7 | Medium |
| 9 | `timezone` не валідована як IANA tz | 11 | Medium |
| 10 | `avatarUrl` без обмеження протоколу | 9 | Medium |
| 11 | Немає явного `.strict()`/`.strip()` | 6–12 | Medium |
| 12 | `200` замість `201` при створенні | 48 | Low |
| 13 | Ручна валідація замість Fastify schema provider | увесь файл | Low |

Перед відкриттям PR я б заблокував на пунктах 1–4 (особливо 3 і 4 — це
питання коректності контракту й безпеки даних, а не стилю), решту можна
або виправити в цьому ж PR, або завести follow-up issue з явним посиланням
на ці рядки.
