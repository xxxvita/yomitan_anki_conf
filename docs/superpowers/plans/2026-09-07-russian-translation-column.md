# Колонка русского перевода и хранилище событий — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В попапе появляется одна кнопка `Ru`, раскрывающая колонку русских переводов — заблюренную на `flib.club`, — а каждый раскрытый перевод и каждая добавленная в Anki карточка пишутся в локальную очередь событий.

**Architecture:** Вся нетривиальная логика — в **чистых модулях** (арбитраж ширины, паринг статей, конверт события, проверка хоста), покрытых unit-тестами; DOM и провода тонкие. Очередь событий — IndexedDB через `ext/js/data/database.js`. **Решение о ширине принимает фронтенд** (только он знает ширину страницы) и возвращает достигнутый размер дисплею — дисплей по ответу выбирает две колонки или стопку.

**Tech Stack:** JavaScript ES-модули, `checkJs` + JSDoc, vitest 3, `fake-indexeddb` 6, jsdom через `test/fixtures/dom-test.js`, Chrome MV3.

**Spec:** `docs/superpowers/specs/2026-09-07-russian-translation-and-chunk-search-design.md`

**Редакция 2** — после трёх независимых проверок, одна из которых исполнила код задач 1–4 вживую. Что изменилось против редакции 1:

| было                                              | стало                                                                                 | почему                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ширина считалась по `window.innerWidth` в дисплее | ширину решает фронтенд и **возвращает** достигнутую                                   | ⚠️ дисплей живёт в iframe: `innerWidth` там — ширина попапа, режим всегда выходил `stack`. Колонка не открылась бы **никогда** |
| кнопка `Ru` в трёх шаблонах статей                | **одна** кнопка в панели над `#dictionary-entries`, под условиями показа              | ТЗ A14: «ровно одна кнопка, постатейных ноль»                                                                                  |
| `render()` звался по клику и на старте            | подписка на `contentUpdateEntry`/`contentUpdateComplete` + `chrome.storage.onChanged` | колонка пропадала после смены слова; состояние не переживало переход во вкладку                                                |
| `strict: true` захардкожен                        | сверка `revision` через `getDictionaryInfo()`                                         | `strict` был полем без читателя, а на сегодняшних словарях (`sequence = 0`) молча получались одни сироты                       |
| `_appendOrphanRow` только определён               | и **вызывается**, и снимается при перерисовке                                         | сироты не рисовались, а строки копились с каждым нажатием                                                                      |
| `recordEvent` — две транзакции                    | одна `readwrite` на оба хранилища                                                     | гонка двух кликов: дубль в `events` + `ConstraintError` наружу (воспроизведено)                                                |
| `sender.tab.url`                                  | `sender.tab.url` + фолбэк `_getTabUrl`                                                | ⚠️ проект уже обходит это (`backend.js:2186`): в Firefox MV3 host-permissions опциональны и поле пустое                        |
| `ProfileOptions` не упоминался                    | `types/ext/settings.d.ts` в списке правок                                             | закрытый тип: без него `test:ts` красный на задачах 6 и 9                                                                      |
| фикстуры `ts = 1, 2, 3`                           | `maxAgeMs: Infinity` в тестах                                                         | 1970 год старше предела ротации: 7 из 8 тестов краснели по ложной причине                                                      |

## Global Constraints

- Node >= 22. После чекаута: `npm ci`, **затем `npm run build:libs`** — без него `ext/lib/*` отсутствует, и `tsc`/eslint падают на чужих ошибках.
- **Лицензионная шапка GPL-3.0-or-later обязательна в каждом новом `.js` И `.d.ts`** (правило `header/header` покрывает `**/*.js` и `**/*.ts`). Копировать из `ext/js/data/video-examples-bootstrap.js:1-17`. ⚠️ Строка `Copyright (C) 2023-2025  Yomitan Authors` **обязательна** — без неё паттерн не сойдётся; строку `Copyright (C) 2026  Flib-club Authors (fork of Yomitan)` можно добавить перед ней.
- Только ES-модули, `const`/`let`, `async`/`await`. CommonJS в `ext/` запрещён.
- Строгий `checkJs`. Флаги строгости не отключать. Типы — в `types/ext/*.d.ts`, ссылка через `import('имя')` без пути.
- **`ext/manifest.json` руками не править** — генерируется `npm run build`.
- Дефолты настроек — и в `ext/data/schemas/options-schema.json`, и в `ext/data/provisioning/default-options.json` (второй применяется на чистом профиле, `options-util.js:142`).
- Проверка на каждом шаге: `npm run test:fast`. Полный прогон перед сдачей: `npm test`.
- ⚠️ **eslint строг к мелочам, и на них уже спотыкались при прогоне этого плана:** пустая строка между соседними `export const` (`@stylistic/padding-line-between-statements`); каждое свойство объекта на своей строке (`@stylistic/object-property-newline`); в `@ts-expect-error` после директивы — **дефис-минус**, не длинное тире (`ban-ts-comment` требует `^ - .+$`).
- Один коммит на задачу. **Сообщения на английском**, как вся история репозитория (`feat(popup): ...`, `fix(events): ...`).
- **Правки в `ext/` не доезжают до браузера сами.** Ручная проверка: `./scripts/yomitan-check.sh --bump && ./scripts/build-all.sh 0.3.2.N && ./scripts/yomitan-check.sh`. Браузер грузит `builds/cu/`.

## Что в этот план НЕ входит

Чанк-поиск (§4 ТЗ), доставка словарей (§3.5) и трек ядра (§12) — отдельными планами.

⚠️ **Ограничение приёмки, которое надо знать заранее.** Пары словарей со штампами `sequence` сегодня не существует (ТЗ §12: инструмент экспорта не написан). На доступном `wty-en-en` все `sequence = 0`, поэтому строгий паринг не соберёт ни одной пары — и это **правильное** поведение (задача 7): пользователь увидит переводы сиротами и одну warn-запись, а не тихую пару не с той частью речи. Ручная приёмка проверяет именно это, а не «колонка полна переводов».

---

## Файловая структура

**Создаются:**

| файл                                    | ответственность                                                      |
| --------------------------------------- | -------------------------------------------------------------------- |
| `ext/js/app/popup-size-registry.js`     | чистый арбитр: кто чего просит и какой размер применить              |
| `ext/js/data/flib-host.js`              | единственная проверка «это `flib.club`?» + адрес вкладки отправителя |
| `ext/js/data/flib-event-envelope.js`    | чистое: нормализация лемм, ключ дедупа, сборка конверта              |
| `ext/js/data/flib-events-database.js`   | IndexedDB: атомарная запись с дедупом, чтение, удаление, ротация     |
| `ext/js/data/flib-secrets.js`           | чистое: вычистить личный ключ из выгрузки настроек                   |
| `types/ext/flib-events.d.ts`            | типы события                                                         |
| `ext/js/display/translation-pairing.js` | чистое: сверка отпечатков и разбор статьи на ряды                    |
| `ext/js/display/display-translation.js` | DOM и провода: кнопка, колонка, блюр, раскрытие                      |

**Тесты:** `popup-size-registry`, `flib-host`, `flib-event-envelope`, `flib-events-database`, `flib-record-event`, `flib-secrets`, `translation-pairing`, `display-translation`, `display-translation-events`, `anki-add-event`.

**Изменяются:** `ext/js/app/frontend.js`, `types/ext/cross-frame-api.d.ts`, **`types/ext/settings.d.ts`**, `ext/js/display/display-anki.js`, `ext/js/display/display-generator.js`, `ext/js/pages/popup-main.js`, `ext/js/pages/search-main.js`, `ext/css/display.css`, `ext/data/schemas/options-schema.json`, `ext/data/provisioning/default-options.json`, `ext/js/data/options-util.js`, `ext/js/background/backend.js`, `ext/js/comm/api.js`, `types/ext/api.d.ts`, `ext/settings.html`, `ext/js/pages/settings/backup-controller.js`, `test/options-util.test.js`.

---

## Task 1: Арбитр ширины попапа

Исходный размер попапа хранится в **одном** слоте (`frontend.js:514-518`), а `frontendRestorePopupSize` дёргается из 13 мест `display-anki.js`, включая `_onContentClear` — на каждую смену слова. Колонка `Ru` стала бы вторым потребителем и подралась бы с панелью `Ex`.

⚠️ Ручка обязана **возвращать достигнутый размер**: только фронтенд знает ширину страницы, а дисплей по ответу решает, рисовать две колонки или стопку.

**Files:**

- Create: `ext/js/app/popup-size-registry.js`
- Test: `test/popup-size-registry.test.js`
- Modify: `ext/js/app/frontend.js` (`:200-213`, `:352-386`, `:514-538`)
- Modify: `types/ext/cross-frame-api.d.ts:117-147`
- Modify: `ext/js/display/display-anki.js` (`:499`, `:509`, `:874`, `:878`, `:1022`)

**Interfaces:**

- Produces: `class PopupSizeRegistry` — `request(owner, minWidth, minHeight): void`, `release(owner): void`, `target(): {minWidth, minHeight} | null`, `get size(): number`.
- Produces: `computeAppliedSize({base, target, caps}): {width: number, height: number}` — чистая.
- Produces: ручки `frontendRequestPopupSize({owner, minWidth, minHeight})` → `{width, height, valid}` и `frontendReleasePopupSize({owner})` → `void`.
- Владельцы: `'video-examples'`, `'translation-column'`.

- [ ] **Step 1: Написать падающий тест**

Создать `test/popup-size-registry.test.js`:

```js
import { describe, expect, test } from "vitest";
import {
  computeAppliedSize,
  PopupSizeRegistry,
} from "../ext/js/app/popup-size-registry.js";

describe("PopupSizeRegistry", () => {
  test("пустой реестр не требует размера", () => {
    expect(new PopupSizeRegistry().target()).toBe(null);
  });
  test("один владелец — его требование и есть цель", () => {
    const r = new PopupSizeRegistry();
    r.request("video-examples", 820, 900);
    expect(r.target()).toEqual({ minWidth: 820, minHeight: 900 });
  });
  test("два владельца — максимум по каждой оси независимо", () => {
    const r = new PopupSizeRegistry();
    r.request("video-examples", 820, 900);
    r.request("translation-column", 1000, 0);
    expect(r.target()).toEqual({ minWidth: 1000, minHeight: 900 });
  });
  test("снятие одного владельца не обнуляет требование другого", () => {
    const r = new PopupSizeRegistry();
    r.request("video-examples", 820, 900);
    r.request("translation-column", 1000, 0);
    r.release("video-examples");
    expect(r.target()).toEqual({ minWidth: 1000, minHeight: 0 });
  });
  test("повторный request того же владельца заменяет требование", () => {
    const r = new PopupSizeRegistry();
    r.request("translation-column", 800, 0);
    r.request("translation-column", 1000, 0);
    expect(r.size).toBe(1);
    expect(r.target()).toEqual({ minWidth: 1000, minHeight: 0 });
  });
  test("после снятия последнего владельца цели нет", () => {
    const r = new PopupSizeRegistry();
    r.request("translation-column", 1000, 0);
    r.release("translation-column");
    expect(r.target()).toBe(null);
  });
  test("снятие незарегистрированного владельца безвредно", () => {
    const r = new PopupSizeRegistry();
    r.release("нет такого");
    expect(r.target()).toBe(null);
  });
});

describe("computeAppliedSize", () => {
  const base = { width: 400, height: 250 };
  const caps = { width: 1536, height: 900 };

  test("нет владельцев — возвращаемся к базе", () => {
    expect(computeAppliedSize({ base, target: null, caps })).toEqual({
      width: 400,
      height: 250,
    });
  });
  test("один владелец — его требование", () => {
    expect(
      computeAppliedSize({
        base,
        target: { minWidth: 800, minHeight: 0 },
        caps,
      }),
    ).toEqual({ width: 800, height: 250 });
  });
  test("СЖИМАЕТСЯ при снятии одного из двух владельцев", () => {
    // Было 1000 (Ru) + 820 (Ex); Ru снят -> цель 820, попап обязан сжаться.
    expect(
      computeAppliedSize({
        base,
        target: { minWidth: 820, minHeight: 900 },
        caps,
      }),
    ).toEqual({ width: 820, height: 900 });
  });
  test("потолок экрана не превышается", () => {
    expect(
      computeAppliedSize({
        base,
        target: { minWidth: 5000, minHeight: 5000 },
        caps,
      }),
    ).toEqual({ width: 1536, height: 900 });
  });
  test("требование меньше базы базу не уменьшает", () => {
    expect(
      computeAppliedSize({
        base,
        target: { minWidth: 100, minHeight: 0 },
        caps,
      }),
    ).toEqual({ width: 400, height: 250 });
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm run test:unit -- test/popup-size-registry.test.js`
Expected: FAIL — `Failed to resolve import ".../popup-size-registry.js"`.

- [ ] **Step 3: Реализация**

Создать `ext/js/app/popup-size-registry.js`:

```js
/**
 * Арбитр размера попапа. Потребителей несколько (панель примеров, колонка
 * перевода), а iframe один: без арбитра закрытие одной панели схлопывало бы
 * попап под живой другой.
 */
export class PopupSizeRegistry {
  constructor() {
    /** @type {Map<string, {minWidth: number, minHeight: number}>} */
    this._owners = new Map();
  }

  /** @returns {number} */
  get size() {
    return this._owners.size;
  }

  /**
   * @param {string} owner
   * @param {number} minWidth
   * @param {number} minHeight
   */
  request(owner, minWidth, minHeight) {
    this._owners.set(owner, { minWidth, minHeight });
  }

  /** @param {string} owner */
  release(owner) {
    this._owners.delete(owner);
  }

  /**
   * Максимум по каждой оси независимо: широкая колонка и высокая панель
   * должны уживаться, а не вытеснять друг друга.
   * @returns {?{minWidth: number, minHeight: number}}
   */
  target() {
    if (this._owners.size === 0) {
      return null;
    }
    let minWidth = 0;
    let minHeight = 0;
    for (const requirement of this._owners.values()) {
      if (requirement.minWidth > minWidth) {
        minWidth = requirement.minWidth;
      }
      if (requirement.minHeight > minHeight) {
        minHeight = requirement.minHeight;
      }
    }
    return { minWidth, minHeight };
  }
}

/**
 * Размер, который надо применить.
 *
 * ⚠️ Считается от БАЗЫ, а не от текущего размера фрейма. Иначе при снятии
 * одного из двух владельцев попап остался бы раздутым под требование снятого:
 * Ru(1000) + Ex(820), сняли Ru -> цель 820, но max(текущие 1000, 820) = 1000.
 * @param {{base: {width: number, height: number}, target: ?{minWidth: number, minHeight: number}, caps: {width: number, height: number}}} details
 * @returns {{width: number, height: number}}
 */
export function computeAppliedSize({ base, target, caps }) {
  if (target === null) {
    return { width: base.width, height: base.height };
  }
  return {
    width: Math.max(base.width, Math.min(target.minWidth, caps.width)),
    height: Math.max(base.height, Math.min(target.minHeight, caps.height)),
  };
}
```

- [ ] **Step 4: Прогнать — тесты зелёные**

Run: `npm run test:unit -- test/popup-size-registry.test.js`
Expected: PASS, 12 тестов.

- [ ] **Step 5: Объявить ручки в типах**

В `types/ext/cross-frame-api.d.ts` **заменить** `frontendEnsurePopupWidth`, `frontendEnsurePopupHeight`, `frontendRestorePopupSize` на:

```ts
    frontendRequestPopupSize: {
        params: {
            owner: string;
            minWidth: number;
            minHeight: number;
        };
        return: {
            width: number;
            height: number;
            valid: boolean;
        };
    };
    frontendReleasePopupSize: {
        params: {
            owner: string;
        };
        return: void;
    };
```

- [ ] **Step 6: Переписать обработчики во `frontend.js`**

Импорт: `import {computeAppliedSize, PopupSizeRegistry} from './popup-size-registry.js';`

В конструкторе рядом с `this._popupOriginalSize`:

```js
/** @type {PopupSizeRegistry} */
this._popupSizeRegistry = new PopupSizeRegistry();
```

В `registerHandlers` (`:200`) заменить три строки на две:

```js
            ['frontendRequestPopupSize', this._onApiRequestPopupSize.bind(this)],
            ['frontendReleasePopupSize', this._onApiReleasePopupSize.bind(this)],
```

Заменить три старых обработчика на:

```js
    /**
     * Регистрирует требование владельца, приводит попап к максимуму требований
     * и ОТДАЁТ достигнутый размер: дисплей живёт в iframe и ширины страницы не
     * знает, поэтому решение columns/stack он принимает по этому ответу.
     * @type {import('cross-frame-api').ApiHandler<'frontendRequestPopupSize'>}
     */
    async _onApiRequestPopupSize({owner, minWidth, minHeight}) {
        this._popupSizeRegistry.request(owner, minWidth, minHeight);
        return await this._applyPopupSizeTarget();
    }

    /**
     * @type {import('cross-frame-api').ApiHandler<'frontendReleasePopupSize'>}
     */
    async _onApiReleasePopupSize({owner}) {
        this._popupSizeRegistry.release(owner);
        await this._applyPopupSizeTarget();
    }

    /**
     * Единственное место, где размер попапа меняется по требованию панелей.
     * @returns {Promise<{width: number, height: number, valid: boolean}>}
     */
    async _applyPopupSizeTarget() {
        if (this._popup === null) { return {width: 0, height: 0, valid: false}; }
        const size = await this._popup.getFrameSize();
        // ⚠️ Режим popup-window (отдельное окно) размера не отдаёт и не меняет
        // (popup-window.js:252, :262). Отвечаем valid:false — дисплей нарисует
        // стопкой. Молчаливого "сделал" здесь быть не должно.
        if (!size.valid) { return {width: 0, height: 0, valid: false}; }
        const target = this._popupSizeRegistry.target();
        if (target === null) {
            const original = this._popupOriginalSize;
            this._popupOriginalSize = null;
            if (original === null) { return {width: size.width, height: size.height, valid: true}; }
            try {
                await this._popup.setFrameSize(original.width, original.height);
            } catch (e) {
                return {width: size.width, height: size.height, valid: true};
            }
            return {width: original.width, height: original.height, valid: true};
        }
        this._capturePopupOriginalSize(size);
        const base = /** @type {{width: number, height: number}} */ (this._popupOriginalSize);
        const applied = computeAppliedSize({
            base,
            target,
            caps: {
                width: Math.floor(window.innerWidth * 0.96),
                height: Math.floor(window.innerHeight * 0.96),
            },
        });
        if (applied.width !== size.width || applied.height !== size.height) {
            await this._popup.setFrameSize(applied.width, applied.height);
        }
        return {width: applied.width, height: applied.height, valid: true};
    }
```

⚠️ `_capturePopupOriginalSize` (`:514`) пишет слот только когда он пуст — это и даёт «базу». `popup._show()` сбрасывает размер фрейма при каждом показе (`popup.js:737`), поэтому дисплей обязан **перезапрашивать** размер на каждой новой выдаче (задача 8), а не полагаться на то, что попап остался раздвинутым.

- [ ] **Step 7: Перевести панель `Ex` на новый контракт**

В `display-anki.js` заменить обе пары вызовов (`:499`+`:509`, `:874`+`:878`) на один каждую:

```js
void this._display
  .invokeContentOrigin("frontendRequestPopupSize", {
    owner: "video-examples",
    minWidth: 820,
    minHeight: 900,
  })
  .catch(() => {
    // Отсоединённый фронтенд — молча.
  });
```

и `:1022` — на:

```js
void this._display
  .invokeContentOrigin("frontendReleasePopupSize", {
    owner: "video-examples",
  })
  .catch(() => {
    // Отсоединённый фронтенд — молча.
  });
```

- [ ] **Step 8: Прогнать**

Run: `npm run test:fast`
Expected: PASS. ⚠️ `tsc` — сторож полноты миграции: `invokeContentOrigin` типизирован дженериком по `ApiNames` (`cross-frame-api.js:359-365`, `display.js:662`), поэтому забытый вызов со старым именем не скомпилируется.

- [ ] **Step 9: Коммит**

```bash
git add ext/js/app/popup-size-registry.js test/popup-size-registry.test.js ext/js/app/frontend.js types/ext/cross-frame-api.d.ts ext/js/display/display-anki.js
git commit -m "feat(popup): size registry with achieved-size feedback instead of a single slot"
```

---

## Task 2: Проверка хоста и адрес отправителя

**Files:**

- Create: `ext/js/data/flib-host.js`
- Test: `test/flib-host.test.js`

**Interfaces:**

- Produces: `isFlibHost(url: string): boolean`; `pickSenderUrl(sender: {tab?: {url?: string}}): string | null`.
- ⚠️ **Второй реализации быть не должно** — две копии, покрытые тестом, который гоняет обе в одном движке, расхождения не ловят.

- [ ] **Step 1: Написать падающий тест**

Создать `test/flib-host.test.js`:

```js
import { describe, expect, test } from "vitest";
import { isFlibHost, pickSenderUrl } from "../ext/js/data/flib-host.js";

describe("isFlibHost", () => {
  test.each([
    ["https://flib.club/book/1", true],
    ["http://flib.club/", true],
    ["https://www.flib.club/x", true],
    ["https://a.b.flib.club/x", true],
    ["https://FLIB.CLUB/x", true],
    ["https://flib.club./x", true],
    ["https://example.com/", false],
    ["https://notflib.club/", false],
    ["https://xflib.club/", false],
    ["https://flib.club.evil.com/", false],
    ["https://evil.com/?x=flib.club", false],
    ["about:blank", false],
    ["", false],
    ["не url", false],
  ])("%s -> %s", (url, expected) => {
    expect(isFlibHost(url)).toBe(expected);
  });
  test("не бросает на не-строке", () => {
    // @ts-expect-error - проверяем защиту от мусора на проводе
    expect(isFlibHost(null)).toBe(false);
  });
});

describe("pickSenderUrl", () => {
  test("берёт адрес вкладки, а не данные клиента", () => {
    expect(pickSenderUrl({ tab: { url: "https://flib.club/1" } })).toBe(
      "https://flib.club/1",
    );
  });
  test("нет вкладки — нет адреса", () => {
    expect(pickSenderUrl({})).toBe(null);
  });
  test("вкладка без url — нет адреса (Firefox без выданных host-permissions)", () => {
    expect(pickSenderUrl({ tab: {} })).toBe(null);
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npm run test:unit -- test/flib-host.test.js`
Expected: FAIL — модуль не резолвится.

- [ ] **Step 3: Реализация**

Создать `ext/js/data/flib-host.js`:

```js
/**
 * ЕДИНСТВЕННАЯ в репозитории проверка «страница на flib.club». Её читают и
 * дисплей (блюрить ли перевод), и бэкенд (писать ли событие). Вторая копия
 * запрещена: расхождение двух копий тест в одном движке не поймает.
 * @param {string} url
 * @returns {boolean}
 */
export function isFlibHost(url) {
  if (typeof url !== "string" || url.length === 0) {
    return false;
  }
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch (e) {
    return false;
  }
  // Замыкающая точка — законная запись корня DNS: flib.club. === flib.club
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "flib.club" || host.endsWith(".flib.club");
}

/**
 * Адрес вкладки отправителя, если он есть.
 *
 * ⚠️ Возвращает null ЧАСТО, и это не край: tab.url требует разрешения `tabs`,
 * которого у расширения нет, а в Firefox MV3 host-permissions опциональны,
 * пока пользователь их не выдал. Вызывающий обязан иметь фолбэк
 * (backend._getTabUrl), а не считать null за «не flib.club».
 * @param {{tab?: {url?: string}}} sender
 * @returns {?string}
 */
export function pickSenderUrl(sender) {
  const url = sender?.tab?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}
```

- [ ] **Step 4: Прогнать**

Run: `npm run test:unit -- test/flib-host.test.js`
Expected: PASS, 18 тестов.

- [ ] **Step 5: Коммит**

```bash
git add ext/js/data/flib-host.js test/flib-host.test.js
git commit -m "feat(events): single flib.club host check and sender URL picker"
```

---

## Task 3: Конверт события

**Files:**

- Create: `ext/js/data/flib-event-envelope.js`, `types/ext/flib-events.d.ts`
- Test: `test/flib-event-envelope.test.js`

**Interfaces:**

- Produces: `FLIB_EVENT_SCHEMA_VERSION`; `normalizeLemmas(lemmas: unknown): string[]`; `dedupKey(url, type, lemma): string`; `buildEvent({type, lemmas, url, ts, eventId}): FlibEvent | null`.

- [ ] **Step 1: Написать падающий тест**

Создать `test/flib-event-envelope.test.js`:

```js
import { describe, expect, test } from "vitest";
import {
  buildEvent,
  dedupKey,
  normalizeLemmas,
} from "../ext/js/data/flib-event-envelope.js";

describe("normalizeLemmas", () => {
  test("обрезает и опускает регистр", () => {
    expect(normalizeLemmas(["  Figure Out ", "GIVE UP"])).toEqual([
      "figure out",
      "give up",
    ]);
  });
  test("выбрасывает пустые и не-строки", () => {
    expect(normalizeLemmas(["a", "", "   ", null, 7, "b"])).toEqual(["a", "b"]);
  });
  test("схлопывает дубли после нормализации", () => {
    expect(normalizeLemmas(["Give Up", "give up"])).toEqual(["give up"]);
  });
  test("не-массив даёт пустой список", () => {
    expect(normalizeLemmas(null)).toEqual([]);
  });
});

describe("dedupKey", () => {
  test("включает url, род и лемму", () => {
    expect(
      dedupKey("https://flib.club/1", "translation_opened", "give up"),
    ).toBe("https://flib.club/1|translation_opened|give up");
  });
  test("разные страницы дают разные ключи — второе свидетельство глушить нельзя", () => {
    expect(
      dedupKey("https://flib.club/1", "translation_opened", "give up"),
    ).not.toBe(
      dedupKey("https://flib.club/2", "translation_opened", "give up"),
    );
  });
  test("разные рода на одной странице не глушат друг друга", () => {
    expect(
      dedupKey("https://flib.club/1", "translation_opened", "give up"),
    ).not.toBe(
      dedupKey("https://flib.club/1", "word_added_to_dict", "give up"),
    );
  });
});

describe("buildEvent", () => {
  /** @type {{type: import('flib-events').FlibEventType, url: string, ts: number, eventId: string}} */
  const base = {
    type: "translation_opened",
    url: "https://Flib.Club/book/1",
    ts: 1000,
    eventId: "id-1",
  };
  test("собирает конверт с нормализованными леммами и хостом", () => {
    expect(buildEvent({ ...base, lemmas: [" Give Up "] })).toEqual({
      event_id: "id-1",
      type: "translation_opened",
      lemmas: ["give up"],
      host: "flib.club",
      url: "https://Flib.Club/book/1",
      ts: 1000,
      schema_version: 1,
    });
  });
  test("пустой список лемм события не даёт", () => {
    expect(buildEvent({ ...base, lemmas: ["  "] })).toBe(null);
  });
  test("негодный url события не даёт", () => {
    expect(buildEvent({ ...base, url: "не url", lemmas: ["x"] })).toBe(null);
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npm run test:unit -- test/flib-event-envelope.test.js`
Expected: FAIL — модуль не резолвится.

- [ ] **Step 3: Объявить тип**

Создать `types/ext/flib-events.d.ts` (с лицензионной шапкой):

```ts
export type FlibEventType = "translation_opened" | "word_added_to_dict";

export type FlibEvent = {
  event_id: string;
  type: FlibEventType;
  lemmas: string[];
  host: string;
  url: string;
  ts: number;
  schema_version: number;
};
```

- [ ] **Step 4: Реализация**

Создать `ext/js/data/flib-event-envelope.js`:

```js
/** Версия формата записи. Растёт при несовместимом изменении полей. */
export const FLIB_EVENT_SCHEMA_VERSION = 1;

/**
 * ⚠️ Нормализация обязательна: заголовки статей приезжают в словарном
 * регистре, а резолв на стороне шлюза — точным совпадением, без лемматизации.
 * Без неё разъедутся и ключ дедупа, и будущий резолв.
 * @param {unknown} lemmas
 * @returns {string[]}
 */
export function normalizeLemmas(lemmas) {
  if (!Array.isArray(lemmas)) {
    return [];
  }
  /** @type {string[]} */
  const result = [];
  const seen = new Set();
  for (const raw of lemmas) {
    if (typeof raw !== "string") {
      continue;
    }
    const lemma = raw.trim().toLowerCase();
    if (lemma.length === 0 || seen.has(lemma)) {
      continue;
    }
    seen.add(lemma);
    result.push(lemma);
  }
  return result;
}

/**
 * ⚠️ Ключ включает URL: то же слово на другой странице — ВТОРОЕ свидетельство,
 * и глушить его нельзя.
 * @param {string} url
 * @param {string} type
 * @param {string} lemma
 * @returns {string}
 */
export function dedupKey(url, type, lemma) {
  return `${url}|${type}|${lemma}`;
}

/**
 * @param {{type: import('flib-events').FlibEventType, lemmas: unknown, url: string, ts: number, eventId: string}} details
 * @returns {?import('flib-events').FlibEvent}
 */
export function buildEvent({ type, lemmas, url, ts, eventId }) {
  const normalized = normalizeLemmas(lemmas);
  if (normalized.length === 0) {
    return null;
  }
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch (e) {
    return null;
  }
  if (host.length === 0) {
    return null;
  }
  return {
    event_id: eventId,
    type,
    lemmas: normalized,
    host,
    url,
    ts,
    schema_version: FLIB_EVENT_SCHEMA_VERSION,
  };
}
```

- [ ] **Step 5: Прогнать**

Run: `npm run test:fast`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add ext/js/data/flib-event-envelope.js types/ext/flib-events.d.ts test/flib-event-envelope.test.js
git commit -m "feat(events): event envelope and lemma normalisation"
```

---

## Task 4: Хранилище событий

⚠️ Дедуп живёт **в хранилище, а не в памяти**: MV3 глушит сервис-воркер по простою, множество в памяти исчезло бы молча.

⚠️ **Запись атомарна.** Проверка ключей и обе вставки — в ОДНОЙ `readwrite`-транзакции. Две отдельные транзакции давали гонку (воспроизведено прогоном): два клика по одной ячейке проходили проверку одновременно, оба писали событие, второй падал на вставке ключа — дубль плюс исключение наружу.

**Files:**

- Create: `ext/js/data/flib-events-database.js`
- Test: `test/flib-events-database.test.js`

**Interfaces:**

- Consumes: `dedupKey` (Task 3); `Database` (`ext/js/data/database.js` — `open` `:38`, `transaction` `:88`, `delete` `:339`).
- Produces: `class FlibEventsDatabase` — `prepare()`, `recordEvent(event): Promise<boolean>`, `listEvents({since, limit}): Promise<FlibEvent[]>`, `deleteEvents(ids): Promise<void>`.
- Конструктор: `{maxRecords?, maxAgeMs?}`.

⚠️ **Фикстуры тестов обязаны использовать `maxAgeMs: Number.POSITIVE_INFINITY`**, кроме теста возраста. Иначе `ts = 1, 2, 3` — это 1970 год, ротация сносит запись сразу после вставки, и 7 из 8 тестов краснеют по ложной причине. Проверено.

- [ ] **Step 1: Написать падающий тест**

Создать `test/flib-events-database.test.js`:

```js
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { buildEvent } from "../ext/js/data/flib-event-envelope.js";
import { FlibEventsDatabase } from "../ext/js/data/flib-events-database.js";

vi.stubGlobal("IDBKeyRange", IDBKeyRange);

/**
 * @param {string} lemma
 * @param {number} ts
 * @param {string} [url]
 * @returns {import('flib-events').FlibEvent}
 */
const ev = (lemma, ts, url = "https://flib.club/1") =>
  /** @type {import('flib-events').FlibEvent} */ (
    buildEvent({
      type: "translation_opened",
      lemmas: [lemma],
      url,
      ts,
      eventId: `${lemma}-${ts}-${url}`,
    })
  );

describe("FlibEventsDatabase", () => {
  /** @type {FlibEventsDatabase} */
  let db;
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    // Возраст отключён: фикстурные ts — 1970 год, дефолтная ротация снесла
    // бы каждую запись сразу после вставки.
    db = new FlibEventsDatabase({ maxAgeMs: Number.POSITIVE_INFINITY });
    await db.prepare();
  });

  test("первая запись проходит", async () => {
    expect(await db.recordEvent(ev("give up", 1))).toBe(true);
    expect((await db.listEvents({})).length).toBe(1);
  });

  test("повтор той же леммы на той же странице отбрасывается", async () => {
    await db.recordEvent(ev("give up", 1));
    expect(await db.recordEvent(ev("give up", 2))).toBe(false);
    expect((await db.listEvents({})).length).toBe(1);
  });

  test("та же лемма на ДРУГОЙ странице пишется — второе свидетельство", async () => {
    await db.recordEvent(ev("give up", 1, "https://flib.club/1"));
    expect(await db.recordEvent(ev("give up", 2, "https://flib.club/2"))).toBe(
      true,
    );
    expect((await db.listEvents({})).length).toBe(2);
  });

  test("в записи остаются только свежие леммы", async () => {
    await db.recordEvent(ev("give up", 1));
    const mixed = /** @type {import('flib-events').FlibEvent} */ (
      buildEvent({
        type: "translation_opened",
        lemmas: ["give up", "book up"],
        url: "https://flib.club/1",
        ts: 3,
        eventId: "mixed",
      })
    );
    expect(await db.recordEvent(mixed)).toBe(true);
    const stored = (await db.listEvents({})).find(
      (e) => e.event_id === "mixed",
    );
    expect(stored?.lemmas).toEqual(["book up"]);
  });

  test("дедуп переживает пересоздание объекта над той же базой (смерть воркера)", async () => {
    await db.recordEvent(ev("give up", 1));
    const revived = new FlibEventsDatabase({
      maxAgeMs: Number.POSITIVE_INFINITY,
    });
    await revived.prepare();
    expect(await revived.recordEvent(ev("give up", 2))).toBe(false);
  });

  test("одновременные записи одной леммы дают ровно одну запись без исключения", async () => {
    const results = await Promise.all([
      db.recordEvent(ev("give up", 1)),
      db.recordEvent(ev("give up", 1)),
    ]);
    expect(results.filter(Boolean).length).toBe(1);
    expect((await db.listEvents({})).length).toBe(1);
  });

  test("deleteEvents убирает названные записи", async () => {
    await db.recordEvent(ev("give up", 1));
    await db.recordEvent(ev("book up", 2));
    await db.deleteEvents(["give up-1-https://flib.club/1"]);
    expect((await db.listEvents({})).map((e) => e.lemmas[0])).toEqual([
      "book up",
    ]);
  });

  test("listEvents фильтрует по since и режет по limit", async () => {
    for (let i = 1; i <= 5; ++i) {
      await db.recordEvent(ev(`w${i}`, i * 10));
    }
    expect((await db.listEvents({ since: 25 })).map((e) => e.ts)).toEqual([
      30, 40, 50,
    ]);
    expect((await db.listEvents({ limit: 2 })).length).toBe(2);
  });

  test("ротация по числу оставляет самые свежие", async () => {
    const small = new FlibEventsDatabase({
      maxRecords: 3,
      maxAgeMs: Number.POSITIVE_INFINITY,
    });
    await small.prepare();
    for (let i = 1; i <= 5; ++i) {
      await small.recordEvent(ev(`w${i}`, i));
    }
    const kept = (await small.listEvents({}))
      .map((e) => e.ts)
      .sort((a, b) => a - b);
    expect(kept).toEqual([3, 4, 5]);
  });

  test("ротация по возрасту выбрасывает записи старше предела", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const aged = new FlibEventsDatabase();
    await aged.prepare();
    await aged.recordEvent(ev("старое", Date.now() - 91 * 24 * 60 * 60 * 1000));
    await aged.recordEvent(ev("свежее", Date.now()));
    expect((await aged.listEvents({})).map((e) => e.lemmas[0])).toEqual([
      "свежее",
    ]);
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npm run test:unit -- test/flib-events-database.test.js`
Expected: FAIL — модуль не резолвится.

- [ ] **Step 3: Реализация**

Создать `ext/js/data/flib-events-database.js`:

```js
import { Database } from "./database.js";
import { dedupKey } from "./flib-event-envelope.js";

export const FLIB_EVENTS_DB_NAME = "flib-events";

export const FLIB_EVENTS_DB_VERSION = 1;

export const FLIB_EVENTS_MAX_RECORDS = 10000;

export const FLIB_EVENTS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Локальная очередь пользовательских событий. Читателя пока нет — отправщик
 * появится позже; наружу торчат listEvents/deleteEvents именно для него.
 *
 * ⚠️ Ключи дедупа лежат ЗДЕСЬ, а не в памяти: сервис-воркер MV3 глушится по
 * простою, и множество в памяти исчезло бы молча.
 */
export class FlibEventsDatabase {
  /**
   * @param {{maxRecords?: number, maxAgeMs?: number}} [options]
   */
  constructor({
    maxRecords = FLIB_EVENTS_MAX_RECORDS,
    maxAgeMs = FLIB_EVENTS_MAX_AGE_MS,
  } = {}) {
    /** @type {Database<'events'|'dedup'>} */
    this._db = new Database();
    /** @type {number} */
    this._maxRecords = maxRecords;
    /** @type {number} */
    this._maxAgeMs = maxAgeMs;
  }

  /** @returns {Promise<void>} */
  async prepare() {
    await this._db.open(FLIB_EVENTS_DB_NAME, FLIB_EVENTS_DB_VERSION, [
      {
        version: 1,
        stores: {
          events: {
            primaryKey: { keyPath: "event_id" },
            indices: ["ts", "host"],
          },
          dedup: { primaryKey: { keyPath: "key" }, indices: ["ts"] },
        },
      },
    ]);
  }

  /**
   * ⚠️ ВСЁ В ОДНОЙ ТРАНЗАКЦИИ: проверка ключей, запись события и запись
   * ключей. Иначе два клика в полёте оба проходят проверку, оба пишут
   * событие, второй падает на ключе — дубль плюс исключение наружу.
   * @param {import('flib-events').FlibEvent} event
   * @returns {Promise<boolean>} true, если запись состоялась
   */
  async recordEvent(event) {
    const written = await new Promise((resolve, reject) => {
      const transaction = this._db.transaction(
        ["events", "dedup"],
        "readwrite",
      );
      const events = transaction.objectStore("events");
      const dedup = transaction.objectStore("dedup");
      /** @type {string[]} */
      const fresh = [];
      let pending = event.lemmas.length;

      transaction.onerror = () => {
        reject(transaction.error);
      };
      transaction.onabort = () => {
        reject(transaction.error);
      };

      const finish = () => {
        if (fresh.length === 0) {
          resolve(false);
          return;
        }
        events.add({ ...event, lemmas: fresh });
        for (const lemma of fresh) {
          dedup.add({
            key: dedupKey(event.url, event.type, lemma),
            ts: event.ts,
          });
        }
        transaction.oncomplete = () => {
          resolve(true);
        };
      };

      if (pending === 0) {
        resolve(false);
        return;
      }
      for (const lemma of event.lemmas) {
        const request = dedup.get(dedupKey(event.url, event.type, lemma));
        request.onsuccess = () => {
          if (typeof request.result === "undefined") {
            fresh.push(lemma);
          }
          if (--pending === 0) {
            finish();
          }
        };
      }
    });
    if (written) {
      await this._rotate();
    }
    return written;
  }

  /**
   * @param {{since?: number, limit?: number}} details
   * @returns {Promise<import('flib-events').FlibEvent[]>}
   */
  async listEvents({ since, limit }) {
    const all = await this._getAllEvents();
    const filtered = all
      .filter((e) => typeof since !== "number" || e.ts > since)
      .sort((a, b) => a.ts - b.ts);
    return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
  }

  /**
   * @param {string[]} ids
   * @returns {Promise<void>}
   */
  async deleteEvents(ids) {
    for (const id of ids) {
      await this._db.delete("events", id);
    }
  }

  /** @returns {Promise<void>} */
  async _rotate() {
    const events = await this._getAllEvents();
    const cutoff = Date.now() - this._maxAgeMs;
    const doomed = events.filter((e) => e.ts < cutoff);
    const survivors = events
      .filter((e) => e.ts >= cutoff)
      .sort((a, b) => a.ts - b.ts);
    const excess = survivors.length - this._maxRecords;
    if (excess > 0) {
      doomed.push(...survivors.slice(0, excess));
    }
    for (const e of doomed) {
      await this._db.delete("events", e.event_id);
      for (const lemma of e.lemmas) {
        await this._db.delete("dedup", dedupKey(e.url, e.type, lemma));
      }
    }
  }

  /** @returns {Promise<import('flib-events').FlibEvent[]>} */
  _getAllEvents() {
    return new Promise((resolve, reject) => {
      const transaction = this._db.transaction(["events"], "readonly");
      const request = transaction.objectStore("events").getAll();
      request.onsuccess = () => {
        resolve(
          /** @type {import('flib-events').FlibEvent[]} */ (request.result),
        );
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }
}
```

⚠️ `Number.POSITIVE_INFINITY` в `maxAgeMs` даёт `cutoff = -Infinity`, и ротация по возрасту не срабатывает — это и нужно тестам.

- [ ] **Step 4: Прогнать**

Run: `npm run test:unit -- test/flib-events-database.test.js`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Коммит**

```bash
git add ext/js/data/flib-events-database.js test/flib-events-database.test.js
git commit -m "feat(events): IndexedDB queue with atomic dedup and rotation"
```

---

## Task 5: Запись события через бэкенд с гейтом по домену

`ИЗ КОДА` Обработчики бэкенда получают `sender` вторым аргументом (`backend.js:490-492`); `ApiExtraArgs = [sender: chrome.runtime.MessageSender]` (`types/ext/api.d.ts:471`), тип `ApiHandler` это уже учитывает — расширять не надо.

⚠️ **`sender.tab.url` ненадёжен, и проект это знает.** `backend.js:2186` дословно: «This function works around the need to have the "tabs" permission to access tab.url», а `_getTabUrl` (`:2152-2167`) берёт адрес сообщением в контент-скрипт вкладки. Ни один обработчик `sender.tab.url` не читает.

**Files:**

- Modify: `ext/js/background/backend.js`, `types/ext/api.d.ts`, `ext/js/comm/api.js`
- Test: `test/flib-record-event.test.js`

- [ ] **Step 1: Написать падающий тест обработчика**

⚠️ Тест зовёт **настоящий** метод бэкенда, а не свою копию его логики: копия останется зелёной и после того, как в бэкенде поменяют источник URL.

Создать `test/flib-record-event.test.js`:

```js
import { describe, expect, test } from "vitest";
import { Backend } from "../ext/js/background/backend.js";

/**
 * Голый Backend с подменённой очередью и резолвом URL вкладки.
 * @param {?string} fallbackUrl адрес, который отдаст _getTabUrl
 * @returns {{backend: Backend, recorded: import('flib-events').FlibEvent[]}}
 */
function makeBackend(fallbackUrl) {
  const backend = /** @type {Backend} */ (Object.create(Backend.prototype));
  /** @type {import('flib-events').FlibEvent[]} */
  const recorded = [];
  // @ts-expect-error - подменяем приватные поля ради изоляции обработчика
  backend._flibEvents = {
    recordEvent: async (event) => {
      recorded.push(event);
      return true;
    },
  };
  // @ts-expect-error - фолбэк вместо реального обмена с контент-скриптом
  backend._getTabUrl = async () => fallbackUrl;
  return { backend, recorded };
}

describe("_onApiFlibRecordEvent", () => {
  test("на flib.club пишет событие с нормализованной леммой", async () => {
    const { backend, recorded } = makeBackend(null);
    // @ts-expect-error - приватный обработчик вызывается напрямую
    const ok = await backend._onApiFlibRecordEvent(
      { type: "translation_opened", lemmas: ["Give Up"] },
      { tab: { id: 1, url: "https://flib.club/1" } },
    );
    expect(ok).toBe(true);
    expect(recorded[0].lemmas).toEqual(["give up"]);
    expect(recorded[0].host).toBe("flib.club");
  });

  test("на чужом домене не пишет", async () => {
    const { backend, recorded } = makeBackend(null);
    // @ts-expect-error - приватный обработчик
    const ok = await backend._onApiFlibRecordEvent(
      { type: "translation_opened", lemmas: ["give up"] },
      { tab: { id: 1, url: "https://example.com/1" } },
    );
    expect(ok).toBe(false);
    expect(recorded.length).toBe(0);
  });

  test("пустой sender.tab.url — идём в фолбэк _getTabUrl (Firefox)", async () => {
    const { backend, recorded } = makeBackend("https://flib.club/2");
    // @ts-expect-error - приватный обработчик
    const ok = await backend._onApiFlibRecordEvent(
      { type: "word_added_to_dict", lemmas: ["figure out"] },
      { tab: { id: 7 } },
    );
    expect(ok).toBe(true);
    expect(recorded[0].url).toBe("https://flib.club/2");
  });

  test("подделать адрес через полезную нагрузку нельзя", async () => {
    const { backend, recorded } = makeBackend(null);
    // @ts-expect-error - приватный обработчик
    const ok = await backend._onApiFlibRecordEvent(
      { type: "translation_opened", lemmas: ["https://flib.club/"] },
      { tab: { id: 1, url: "https://example.com/1" } },
    );
    expect(ok).toBe(false);
    expect(recorded.length).toBe(0);
  });

  test("нет вкладки и фолбэк пуст — не пишет", async () => {
    const { backend } = makeBackend(null);
    // @ts-expect-error - приватный обработчик
    const ok = await backend._onApiFlibRecordEvent(
      { type: "translation_opened", lemmas: ["x"] },
      {},
    );
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npm run test:unit -- test/flib-record-event.test.js`
Expected: FAIL — `backend._onApiFlibRecordEvent is not a function`.

- [ ] **Step 3: Объявить API**

В `types/ext/api.d.ts` в `ApiSurface`:

```ts
    flibRecordEvent: {
        params: {
            type: import('flib-events').FlibEventType;
            lemmas: string[];
        };
        return: boolean;
    };
```

В `ext/js/comm/api.js`:

```js
    /**
     * @param {import('api').ApiParam<'flibRecordEvent', 'type'>} type
     * @param {import('api').ApiParam<'flibRecordEvent', 'lemmas'>} lemmas
     * @returns {Promise<import('api').ApiReturn<'flibRecordEvent'>>}
     */
    flibRecordEvent(type, lemmas) {
        return this._invoke('flibRecordEvent', {type, lemmas});
    }
```

- [ ] **Step 4: Обработчик в бэкенде**

Импорты:

```js
import { buildEvent } from "../data/flib-event-envelope.js";
import { FlibEventsDatabase } from "../data/flib-events-database.js";
import { isFlibHost, pickSenderUrl } from "../data/flib-host.js";
```

Поле в конструкторе:

```js
/** @type {?FlibEventsDatabase} */
this._flibEvents = null;
```

В карту API добавить `['flibRecordEvent', this._onApiFlibRecordEvent.bind(this)]` и обработчик:

```js
    /**
     * ⚠️ Гейт стоит ЗДЕСЬ, а не только в дисплее: авторитетная проверка должна
     * быть там, где пишутся данные, и на адресе ВКЛАДКИ, а не на поле из
     * полезной нагрузки. Вне flib.club события не пишутся вовсе — решение
     * владельца, а не упущение.
     * @type {import('api').ApiHandler<'flibRecordEvent'>}
     */
    async _onApiFlibRecordEvent({type, lemmas}, sender) {
        let url = pickSenderUrl(sender);
        // ⚠️ Фолбэк обязателен: tab.url требует разрешения `tabs`, которого у
        // расширения нет, а в Firefox MV3 host-permissions опциональны. Тот же
        // обход уже применён в _getTabUrl (:2152).
        if (url === null) {
            const tabId = sender?.tab?.id;
            if (typeof tabId === 'number') {
                try {
                    url = await this._getTabUrl(tabId);
                } catch (e) {
                    url = null;
                }
            }
        }
        if (url === null || !isFlibHost(url)) { return false; }
        const event = buildEvent({type, lemmas, url, ts: Date.now(), eventId: crypto.randomUUID()});
        if (event === null) { return false; }
        try {
            if (this._flibEvents === null) {
                const database = new FlibEventsDatabase();
                await database.prepare();
                this._flibEvents = database;
            }
            return await this._flibEvents.recordEvent(event);
        } catch (e) {
            log.error(e);
            return false;
        }
    }
```

⚠️ Сверить фактическую сигнатуру `_getTabUrl` (`grep -n '_getTabUrl' ext/js/background/backend.js`) и при расхождении подстроить вызов, а не тест.

- [ ] **Step 5: Прогнать**

Run: `npm run test:fast`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add ext/js/background/backend.js ext/js/comm/api.js types/ext/api.d.ts test/flib-record-event.test.js
git commit -m "feat(events): backend recording gated on the tab URL"
```

---

## Task 6: Настройки `flibTranslation` и `flibService`

⚠️ Ветка названа `flibService`, а не `flibEvents`: личный ключ — учётные данные пользователя у сервиса, и его же потребует стриминг видео (отдельное ТЗ).

**Files:**

- Modify: `types/ext/settings.d.ts` (**обязательно**: `ProfileOptions` закрыт, без правки `test:ts` красный)
- Modify: `ext/data/schemas/options-schema.json`, `ext/data/provisioning/default-options.json`, `ext/js/data/options-util.js`, `ext/settings.html`, `ext/js/pages/settings/backup-controller.js`
- Create: `ext/js/data/flib-secrets.js`
- Test: `test/options-util.test.js` (дописать), `test/flib-secrets.test.js`

- [ ] **Step 1: Найти номер следующей версии**

Run: `grep -n '_updateVersion' ext/js/data/options-util.js | tail -3`
Последняя — `_updateVersion77` (`:1881`), зарегистрирована в `_getVersionUpdates` (`:598`). Новая — `_updateVersion78`. Если в дереве уже другая, подставить свою.

- [ ] **Step 2: Написать падающие тесты**

В `test/options-util.test.js` дописать:

```js
test("миграция 78 заводит flibTranslation и flibService", async () => {
  const optionsUtil = new OptionsUtil();
  await optionsUtil.prepare();
  const options = await optionsUtil.update(createOptionsTestData1(), 78);
  const profile = options.profiles[0].options;
  expect(profile.flibTranslation).toEqual({
    translationDictionary: "flibooster-en-ru",
    hostDictionary: "wty-en-en",
    buttonLabel: "Ru",
  });
  expect(profile.flibService).toEqual({ gatewayUrl: "", personalKey: "" });
});
```

⚠️ `update(optionsInput, targetVersion = null)` — **два** параметра (`options-util.js:53`). Третий аргумент не скомпилируется, а `0` вторым означало бы «мигрировать до версии 0», то есть ни одной миграции.

⚠️ Существующий тест сравнивает результат с `createOptionsUpdatedTestData1()` (`:625`) через `toStrictEqual` — фикстуру надо дополнить теми же двумя объектами, иначе он покраснеет.

Создать `test/flib-secrets.test.js`:

```js
import { describe, expect, test } from "vitest";
import { redactFlibSecrets } from "../ext/js/data/flib-secrets.js";

const makeOptions = () => ({
  profiles: [
    {
      options: {
        flibService: { gatewayUrl: "https://gw", personalKey: "tpk_secret" },
      },
    },
  ],
});

describe("redactFlibSecrets", () => {
  test("личный ключ вычищен", () => {
    expect(
      redactFlibSecrets(makeOptions()).profiles[0].options.flibService
        .personalKey,
    ).toBe("");
  });
  test("адрес шлюза сохранён", () => {
    expect(
      redactFlibSecrets(makeOptions()).profiles[0].options.flibService
        .gatewayUrl,
    ).toBe("https://gw");
  });
  test("исходный объект НЕ изменён", () => {
    const source = makeOptions();
    redactFlibSecrets(source);
    expect(source.profiles[0].options.flibService.personalKey).toBe(
      "tpk_secret",
    );
  });
  test("профиль без flibService не ломает функцию", () => {
    expect(() =>
      redactFlibSecrets({ profiles: [{ options: {} }] }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 3: Прогнать — падает**

Run: `npm run test:unit -- test/options-util.test.js test/flib-secrets.test.js`
Expected: FAIL — `flibTranslation` undefined и модуль `flib-secrets.js` не резолвится.

- [ ] **Step 4: Типы**

В `types/ext/settings.d.ts` объявить:

```ts
export type FlibTranslationOptions = {
  translationDictionary: string;
  hostDictionary: string;
  buttonLabel: string;
};

export type FlibServiceOptions = {
  gatewayUrl: string;
  personalKey: string;
};
```

и добавить в `ProfileOptions` (`:92-105`):

```ts
flibTranslation: FlibTranslationOptions;
flibService: FlibServiceOptions;
```

- [ ] **Step 5: Схема**

В `ext/data/schemas/options-schema.json`, в объект профиля: в `required` добавить `"flibTranslation"`, `"flibService"`; в `properties`:

```json
"flibTranslation": {
    "type": "object",
    "required": ["translationDictionary", "hostDictionary", "buttonLabel"],
    "additionalProperties": false,
    "properties": {
        "translationDictionary": {"type": "string", "default": "flibooster-en-ru"},
        "hostDictionary": {"type": "string", "default": "wty-en-en"},
        "buttonLabel": {"type": "string", "default": "Ru"}
    }
},
"flibService": {
    "type": "object",
    "required": ["gatewayUrl", "personalKey"],
    "additionalProperties": false,
    "properties": {
        "gatewayUrl": {"type": "string", "default": ""},
        "personalKey": {"type": "string", "default": ""}
    }
}
```

- [ ] **Step 6: Миграция**

⚠️ `UpdateFunction` возвращает `void` (`types/ext/options-util.d.ts:26`) — `return options` не нужен. Функции складываются в массив **unbound**, поэтому `this` внутри использовать нельзя.

В `ext/js/data/options-util.js` рядом с `_updateVersion77`:

```js
    /**
     * - Added flibTranslation (which dictionaries form the EN/RU pair, and the
     *   button label) and flibService (gateway URL and the user's personal key).
     *   The label is a setting, not derived: the Yomitan format carries no
     *   language field.
     * @type {import('options-util').UpdateFunction}
     */
    _updateVersion78(options) {
        for (const {options: profileOptions} of options.profiles) {
            profileOptions.flibTranslation = {
                translationDictionary: 'flibooster-en-ru',
                hostDictionary: 'wty-en-en',
                buttonLabel: 'Ru',
            };
            profileOptions.flibService = {gatewayUrl: '', personalKey: ''};
        }
    }
```

и зарегистрировать в `_getVersionUpdates` следом за `this._updateVersion77`.

- [ ] **Step 7: Provisioned-дефолты**

В `ext/data/provisioning/default-options.json` в `profiles[0].options` добавить оба объекта с теми же значениями. ⚠️ Без этого чистый профиль получит одно, а мигрированный — другое.

- [ ] **Step 8: Чистая функция вычистки ключа**

Создать `ext/js/data/flib-secrets.js`:

```js
/**
 * Убирает личный ключ из копии настроек, готовящейся к выгрузке.
 *
 * ⚠️ Клонирует, а не правит на месте: тот же объект приходит из
 * settingsController и продолжает жить как настройки пользователя.
 * ⚠️ Ключ — учётные данные; файлы резервных копий пересылают.
 * @template T
 * @param {T} optionsFull
 * @returns {T}
 */
export function redactFlibSecrets(optionsFull) {
  const clone = structuredClone(optionsFull);
  const profiles =
    /** @type {{options?: {flibService?: {personalKey: string}}}[]} */ (
      /** @type {unknown} */ (
        /** @type {{profiles?: unknown}} */ (clone).profiles
      )
    );
  if (!Array.isArray(profiles)) {
    return clone;
  }
  for (const profile of profiles) {
    const service = profile?.options?.flibService;
    if (service) {
      service.personalKey = "";
    }
  }
  return clone;
}
```

- [ ] **Step 9: Подключить в выгрузку**

Run: `grep -n '_getSettingsExportData' -A 14 ext/js/pages/settings/backup-controller.js`

В `_getSettingsExportData` (`:138`) обернуть `optionsFull` в `redactFlibSecrets(...)` в месте сборки итогового объекта, добавив импорт.

- [ ] **Step 10: Поле ключа в настройках**

В `ext/settings.html` рядом с блоком `anki-api-key-input` (`:1920-1928`, `advanced-only`):

```html
<div class="settings-item advanced-only">
  <div class="settings-item-inner settings-item-inner-wrappable">
    <div class="settings-item-left">
      <div class="settings-item-label">Flib personal key</div>
      <div class="settings-item-description">
        A tpk_... key used to send learning events to the server.
      </div>
    </div>
    <div class="settings-item-right">
      <input
        type="password"
        placeholder="Not set"
        spellcheck="false"
        autocomplete="off"
        data-setting="flibService.personalKey"
      />
    </div>
  </div>
</div>
```

- [ ] **Step 11: Прогнать**

Run: `npm run test:fast && npm run test:unit:options`
Expected: PASS.

- [ ] **Step 12: Коммит**

```bash
git add types/ext/settings.d.ts ext/data/schemas/options-schema.json ext/data/provisioning/default-options.json ext/js/data/options-util.js ext/js/data/flib-secrets.js ext/settings.html ext/js/pages/settings/backup-controller.js test/options-util.test.js test/flib-secrets.test.js
git commit -m "feat(settings): flibTranslation and flibService, personal key kept out of backups"
```

---

## Task 7: Сверка отпечатков и разбор статьи на пары

Русские определения приезжают **внутри той же** `TermDictionaryEntry` (`group` сливает словари по ключу `[term, normalizedReading, ...inflectionRuleChain]`, `translator.js:854-857`), различаются по `definition.dictionary` и несут свой `sequences` (`types/ext/dictionary.d.ts:359`).

**Files:**

- Create: `ext/js/display/translation-pairing.js`
- Test: `test/translation-pairing.test.js`

**Interfaces:**

- Produces: `isStrictPairingAvailable(dictionaryInfo, {translationDictionary, hostDictionary}): boolean`.
- Produces: `pairDefinitions(dictionaryEntry, {translationDictionary, hostDictionary, strict}): TranslationRow[]`, где `TranslationRow = {hostIndex: number | null, hostDefinition: TermDefinition | null, translation: TermDefinition | null}`.
- `hostIndex` — индекс в **исходном** массиве `definitions`; на нём стоит `dataset.index` разметки (`display-generator.js:187-188`).

- [ ] **Step 1: Написать падающий тест**

Создать `test/translation-pairing.test.js`:

```js
import { describe, expect, test } from "vitest";
import {
  isStrictPairingAvailable,
  pairDefinitions,
} from "../ext/js/display/translation-pairing.js";

const opts = {
  translationDictionary: "ru",
  hostDictionary: "en",
  strict: true,
};

/**
 * @param {string} dictionary
 * @param {number[]} sequences
 * @returns {import('dictionary').TermDefinition}
 */
const def = (dictionary, sequences) =>
  /** @type {import('dictionary').TermDefinition} */ (
    /** @type {unknown} */ ({
      dictionary,
      sequences,
      id: sequences[0],
      entries: [],
      tags: [],
      headwordIndices: [0],
    })
  );

describe("isStrictPairingAvailable", () => {
  const names = { translationDictionary: "ru", hostDictionary: "en" };
  test("совпавшие отпечатки включают строгий режим", () => {
    expect(
      isStrictPairingAvailable(
        [
          { title: "en", revision: "2026.09.07+1962075" },
          { title: "ru", revision: "2026.09.07+1962075" },
        ],
        names,
      ),
    ).toBe(true);
  });
  test("разные отпечатки строгий режим выключают", () => {
    expect(
      isStrictPairingAvailable(
        [
          { title: "en", revision: "2026.03.05" },
          { title: "ru", revision: "2026.09.07+1962075" },
        ],
        names,
      ),
    ).toBe(false);
  });
  test("словаря-хозяина нет — строгого режима нет", () => {
    expect(
      isStrictPairingAvailable([{ title: "ru", revision: "x" }], names),
    ).toBe(false);
  });
  test("пустая ревизия строгий режим не включает", () => {
    expect(
      isStrictPairingAvailable(
        [
          { title: "en", revision: "" },
          { title: "ru", revision: "" },
        ],
        names,
      ),
    ).toBe(false);
  });
  test("пустой список словарей", () => {
    expect(isStrictPairingAvailable([], names)).toBe(false);
  });
});

describe("pairDefinitions", () => {
  test("перевод встаёт к своей английской статье по штампу", () => {
    const entry = {
      definitions: [def("en", [10]), def("en", [20]), def("ru", [20])],
    };
    const rows = pairDefinitions(entry, opts);
    expect(rows.map((r) => r.hostIndex)).toEqual([0, 1]);
    expect(rows[0].translation).toBe(null);
    expect(rows[1].translation).toBe(entry.definitions[2]);
  });

  test("hostIndex — индекс в ИСХОДНОМ массиве, не порядковый номер ряда", () => {
    const entry = { definitions: [def("ru", [10]), def("en", [10])] };
    expect(pairDefinitions(entry, opts)[0].hostIndex).toBe(1);
  });

  test("чужой непереводной словарь хозяином не становится", () => {
    const entry = { definitions: [def("другой-en", [20]), def("ru", [20])] };
    const rows = pairDefinitions(entry, opts);
    expect(rows[0].translation).toBe(null);
    expect(rows[1].hostIndex).toBe(null);
  });

  test("перевод без хозяина показывается сиротой, а не выбрасывается", () => {
    const entry = { definitions: [def("en", [10]), def("ru", [999])] };
    const rows = pairDefinitions(entry, opts);
    expect(rows.length).toBe(2);
    expect(rows[1].hostIndex).toBe(null);
    expect(rows[1].translation).toBe(entry.definitions[1]);
  });

  test("сверяется ПЕРЕСЕЧЕНИЕ списков штампов, не первый элемент", () => {
    const entry = { definitions: [def("en", [10, 20]), def("ru", [20])] };
    expect(pairDefinitions(entry, opts)[0].translation).toBe(
      entry.definitions[1],
    );
  });

  test("штамп 0 пары не даёт — это апстримный словарь без штампов", () => {
    const entry = { definitions: [def("en", [0]), def("ru", [0])] };
    const rows = pairDefinitions(entry, opts);
    expect(rows[0].translation).toBe(null);
    expect(rows[1].hostIndex).toBe(null);
  });

  test("нестрогий режим делает сиротами ВСЕ переводы, без смешения", () => {
    const entry = { definitions: [def("en", [20]), def("ru", [20])] };
    const rows = pairDefinitions(entry, { ...opts, strict: false });
    expect(rows[0].translation).toBe(null);
    expect(rows[1].hostIndex).toBe(null);
  });

  test("один хозяин не берёт два перевода", () => {
    const entry = {
      definitions: [def("en", [20]), def("ru", [20]), def("ru", [20])],
    };
    const rows = pairDefinitions(entry, opts);
    expect(rows.length).toBe(2);
    expect(rows[0].translation).toBe(entry.definitions[1]);
    expect(rows[1].hostIndex).toBe(null);
    expect(rows[1].translation).toBe(entry.definitions[2]);
  });

  test("статья без переводов даёт ряды с пустой правой ячейкой", () => {
    const entry = { definitions: [def("en", [1]), def("en", [2])] };
    expect(
      pairDefinitions(entry, opts).every((r) => r.translation === null),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npm run test:unit -- test/translation-pairing.test.js`
Expected: FAIL — модуль не резолвится.

- [ ] **Step 3: Реализация**

Создать `ext/js/display/translation-pairing.js`:

```js
/**
 * @typedef {{
 *   hostIndex: ?number,
 *   hostDefinition: ?import('dictionary').TermDefinition,
 *   translation: ?import('dictionary').TermDefinition,
 * }} TranslationRow
 */

/**
 * Строгий паринг допустим, только когда оба словаря вышли из одной сборки.
 *
 * ⚠️ Без этой сверки протухший штамп молча поставил бы перевод под чужую
 * статью. Отпечаток кладётся в index.json.revision обоих zip (ТЗ Ш-3), а сюда
 * приходит из api.getDictionaryInfo().
 * @param {{title: string, revision: string}[]} dictionaryInfo
 * @param {{translationDictionary: string, hostDictionary: string}} names
 * @returns {boolean}
 */
export function isStrictPairingAvailable(
  dictionaryInfo,
  { translationDictionary, hostDictionary },
) {
  const host = dictionaryInfo.find((d) => d.title === hostDictionary);
  const translation = dictionaryInfo.find(
    (d) => d.title === translationDictionary,
  );
  if (typeof host === "undefined" || typeof translation === "undefined") {
    return false;
  }
  return host.revision.length > 0 && host.revision === translation.revision;
}

/**
 * Складывает определения ОДНОЙ статьи в ряды «оригинал + перевод».
 *
 * ⚠️ ХОЗЯИН НАЗВАН ПОИМЁННО, а не «любой непереводной словарь»: у пользователя
 * может стоять второй английский словарь с чужими sequence.
 *
 * ⚠️ СМЕШАННОГО РЕЖИМА НЕТ: либо все пары строгие, либо все переводы сироты.
 * Часть строгими, часть по заголовку — состояние, в котором причину увиденного
 * не восстановить.
 * @param {{definitions: import('dictionary').TermDefinition[]}} dictionaryEntry
 * @param {{translationDictionary: string, hostDictionary: string, strict: boolean}} options
 * @returns {TranslationRow[]}
 */
export function pairDefinitions(
  dictionaryEntry,
  { translationDictionary, hostDictionary, strict },
) {
  /** @type {TranslationRow[]} */
  const rows = [];
  /** @type {TranslationRow[]} */
  const translations = [];

  dictionaryEntry.definitions.forEach((definition, hostIndex) => {
    if (definition.dictionary === translationDictionary) {
      translations.push({
        hostIndex: null,
        hostDefinition: null,
        translation: definition,
      });
      return;
    }
    rows.push({ hostIndex, hostDefinition: definition, translation: null });
  });

  for (const orphan of translations) {
    const translation = /** @type {import('dictionary').TermDefinition} */ (
      orphan.translation
    );
    const host = strict ? findHost(rows, translation, hostDictionary) : null;
    if (host !== null) {
      host.translation = translation;
    } else {
      rows.push(orphan);
    }
  }
  return rows;
}

/**
 * @param {TranslationRow[]} rows
 * @param {import('dictionary').TermDefinition} translation
 * @param {string} hostDictionary
 * @returns {?TranslationRow}
 */
function findHost(rows, translation, hostDictionary) {
  // ⚠️ Пересечение списков, а не sequences[0]: определения одного словаря с
  // идентичным глоссарием сливаются, объединяя штампы.
  // ⚠️ Штампы <= 0 не в счёт: апстримный словарь пишет 0, отсутствие — -1.
  const stamps = new Set(translation.sequences.filter((s) => s > 0));
  if (stamps.size === 0) {
    return null;
  }
  for (const row of rows) {
    const host = row.hostDefinition;
    if (host === null || row.translation !== null) {
      continue;
    }
    if (host.dictionary !== hostDictionary) {
      continue;
    }
    if (host.sequences.some((s) => stamps.has(s))) {
      return row;
    }
  }
  return null;
}
```

- [ ] **Step 4: Прогнать**

Run: `npm run test:unit -- test/translation-pairing.test.js`
Expected: PASS, 14 тестов.

- [ ] **Step 5: Коммит**

```bash
git add ext/js/display/translation-pairing.js test/translation-pairing.test.js
git commit -m "feat(translation): pair EN and RU definitions by sequence stamp behind a build-fingerprint gate"
```

---

## Task 8: Одна кнопка `Ru` и раскрытие попапа

⚠️ **Кнопка одна на попап, а не на статью** (ТЗ A14). Она живёт в собственной панели над `#dictionary-entries` и рендерится, только когда словарь переводов установлен **и** `resultOutputMode === 'group'` — иначе словари не сливаются в одну статью и хозяина для перевода не найти никогда.

⚠️ **Ширину решает фронтенд.** Дисплей просит `base × 2` и смотрит на **возвращённую** ширину: хватает на две колонки по 240 px — колонки, не хватает или `valid: false` (popup-window) — стопка.

**Files:**

- Create: `ext/js/display/display-translation.js`
- Modify: `ext/js/pages/popup-main.js`, `ext/js/pages/search-main.js`, `ext/css/display.css`
- Test: `test/display-translation.test.js`

**Interfaces:**

- Consumes: ручки Task 1, `isStrictPairingAvailable`/`pairDefinitions` (Task 7), `isFlibHost` (Task 2).
- Produces: `MIN_COLUMN_WIDTH`, `COLUMN_OPEN_KEY`, `chooseLayout({achievedWidth, valid, minColumnWidth}): 'columns'|'stack'`, `class DisplayTranslation`.

- [ ] **Step 1: Написать падающий тест раскладки**

Создать `test/display-translation.test.js`:

```js
import { describe, expect, test } from "vitest";
import {
  chooseLayout,
  MIN_COLUMN_WIDTH,
} from "../ext/js/display/display-translation.js";

describe("chooseLayout", () => {
  test("достигнутой ширины хватает на две колонки", () => {
    expect(
      chooseLayout({
        achievedWidth: 800,
        valid: true,
        minColumnWidth: MIN_COLUMN_WIDTH,
      }),
    ).toBe("columns");
  });
  test("ровно на границе — ещё колонки", () => {
    expect(
      chooseLayout({ achievedWidth: 480, valid: true, minColumnWidth: 240 }),
    ).toBe("columns");
  });
  test("колонка уже порога — стопка", () => {
    expect(
      chooseLayout({ achievedWidth: 470, valid: true, minColumnWidth: 240 }),
    ).toBe("stack");
  });
  test("фронтенд размер менять не умеет (popup-window) — стопка", () => {
    expect(
      chooseLayout({ achievedWidth: 0, valid: false, minColumnWidth: 240 }),
    ).toBe("stack");
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npm run test:unit -- test/display-translation.test.js`
Expected: FAIL — модуль не резолвится.

- [ ] **Step 3: Реализация**

Создать `ext/js/display/display-translation.js`. В этой задаче — кнопка, состояние и ширина; рендер ячеек добавляет задача 9.

```js
import { log } from "../core/log.js";
import { isFlibHost } from "../data/flib-host.js";
import { isStrictPairingAvailable } from "./translation-pairing.js";

/** Минимальная ширина колонки, ниже которой рисуем стопкой, а не рядом. */
export const MIN_COLUMN_WIDTH = 240;

/** Ключ состояния колонки в chrome.storage.local. */
export const COLUMN_OPEN_KEY = "flibTranslationColumnOpen";

/**
 * ⚠️ Решение принимается по ДОСТИГНУТОЙ ширине, которую вернул фронтенд.
 * Дисплей живёт в iframe: его window.innerWidth — ширина попапа, и считать по
 * нему значило бы всегда получать stack.
 * @param {{achievedWidth: number, valid: boolean, minColumnWidth: number}} details
 * @returns {'columns'|'stack'}
 */
export function chooseLayout({ achievedWidth, valid, minColumnWidth }) {
  if (!valid) {
    return "stack";
  }
  return achievedWidth / 2 >= minColumnWidth ? "columns" : "stack";
}

export class DisplayTranslation {
  /**
   * @param {import('./display.js').Display} display
   */
  constructor(display) {
    /** @type {import('./display.js').Display} */
    this._display = display;
    /** @type {boolean} */
    this._open = false;
    /** @type {Set<number>} */
    this._revealed = new Set();
    /** @type {'columns'|'stack'} */
    this._layout = "stack";
    /** @type {boolean} */
    this._strict = false;
    /** @type {?HTMLButtonElement} */
    this._button = null;
    /** @type {Map<HTMLElement, import('dictionary').TermDictionaryEntry>} */
    this._entries = new Map();
  }

  /** @returns {boolean} */
  get isOpen() {
    return this._open;
  }

  /** Подписки и стартовое состояние. */
  prepare() {
    this._display.on("contentClear", () => {
      this._revealed.clear();
      this._entries.clear();
    });
    // ⚠️ contentUpdateEntry (display.js:2417) даёт {dictionaryEntry, element,
    // index} — узел и его статью, без сопоставления по порядковому номеру.
    this._display.on("contentUpdateEntry", (details) => {
      this._onContentUpdateEntry(details);
    });
    this._display.on("contentUpdateComplete", () => {
      void this._onContentUpdateComplete();
    });
    // ⚠️ Состояние меняется в ЛЮБОЙ вкладке: без подписки вкладка, чей
    // Display уже подготовлен, не узнает о нажатии Ru в соседней (ТЗ A21).
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !Object.hasOwn(changes, COLUMN_OPEN_KEY)) {
        return;
      }
      this._open = changes[COLUMN_OPEN_KEY].newValue === true;
      void this._applyState();
    });
    void this._loadOpenState();
  }

  /** @returns {Promise<void>} */
  async _loadOpenState() {
    try {
      const stored = await chrome.storage.local.get([COLUMN_OPEN_KEY]);
      this._open = stored[COLUMN_OPEN_KEY] === true;
    } catch (e) {
      this._open = false;
    }
  }

  /**
   * Кнопка показывается, только когда пара словарей пригодна к работе.
   * @returns {Promise<boolean>}
   */
  async _shouldShowButton() {
    const options = this._display.getOptions();
    if (options === null) {
      return false;
    }
    // ⚠️ В режимах split/merge словари не сливаются в одну статью, и хозяина
    // для перевода не найти никогда — кнопки быть не должно.
    if (options.general.resultOutputMode !== "group") {
      return false;
    }
    const info = await this._display.application.api.getDictionaryInfo();
    return info.some(
      (d) => d.title === options.flibTranslation.translationDictionary,
    );
  }

  /** @returns {Promise<void>} */
  async _onContentUpdateComplete() {
    const options = this._display.getOptions();
    if (options === null) {
      return;
    }
    if (!(await this._shouldShowButton())) {
      this._removeButton();
      return;
    }
    const info = await this._display.application.api.getDictionaryInfo();
    this._strict = isStrictPairingAvailable(info, options.flibTranslation);
    if (!this._strict) {
      log.warn(
        new Error(
          "flib: dictionary build fingerprints differ, translations shown unpaired",
        ),
      );
    }
    this._ensureButton(options.flibTranslation.buttonLabel);
    await this._applyState();
  }

  /**
   * ⚠️ Размер ПЕРЕЗАПРАШИВАЕТСЯ на каждой выдаче: popup._show() сбрасывает
   * размер фрейма при каждом показе (popup.js:737), поэтому «раз раздвинули и
   * держится» — неверная посылка.
   * @returns {Promise<void>}
   */
  async _applyState() {
    const options = this._display.getOptions();
    if (options === null || this._button === null) {
      return;
    }
    this._button.setAttribute("aria-pressed", this._open ? "true" : "false");
    if (!this._open) {
      this._layout = "stack";
      await this._display
        .invokeContentOrigin("frontendReleasePopupSize", {
          owner: "translation-column",
        })
        .catch(() => {});
      this._renderColumns();
      return;
    }
    const base = options.general.popupWidth;
    const achieved = await this._display
      .invokeContentOrigin("frontendRequestPopupSize", {
        owner: "translation-column",
        minWidth: base * 2,
        minHeight: 0,
      })
      .catch(() => ({ width: 0, height: 0, valid: false }));
    this._layout = chooseLayout({
      achievedWidth: achieved.width,
      valid: achieved.valid,
      minColumnWidth: MIN_COLUMN_WIDTH,
    });
    this._renderColumns();
  }

  /** @param {string} label */
  _ensureButton(label) {
    if (this._button !== null) {
      this._button.textContent = label;
      return;
    }
    const entries = document.getElementById("dictionary-entries");
    if (entries === null || entries.parentNode === null) {
      return;
    }
    const bar = document.createElement("div");
    bar.className = "translation-toolbar";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "translation-toolbar-button";
    button.dataset.action = "show-translation";
    button.setAttribute("aria-pressed", "false");
    button.title = "Показать перевод";
    button.textContent = label;
    button.addEventListener("click", () => {
      void this._toggle();
    });
    bar.appendChild(button);
    entries.parentNode.insertBefore(bar, entries);
    this._button = button;
  }

  _removeButton() {
    const bar = this._button?.parentElement ?? null;
    if (bar !== null) {
      bar.remove();
    }
    this._button = null;
  }

  /** @returns {Promise<void>} */
  async _toggle() {
    // ⚠️ Нажатие Ru события НЕ шлёт: одно нажатие пометило бы «не знал»
    // разом все статьи слова.
    this._open = !this._open;
    try {
      await chrome.storage.local.set({ [COLUMN_OPEN_KEY]: this._open });
    } catch (e) {
      // Приватное окно или очищенное хранилище — состояние живёт в памяти.
    }
    await this._applyState();
  }

  /**
   * @param {import('display').EventArgument<'contentUpdateEntry'>} details
   */
  _onContentUpdateEntry({ dictionaryEntry, element }) {
    if (dictionaryEntry.type !== "term") {
      return;
    }
    this._entries.set(/** @type {HTMLElement} */ (element), dictionaryEntry);
  }

  /** Тело пишет задача 9. */
  _renderColumns() {
    // Task 9
  }
}
```

⚠️ `isFlibHost` и `pairDefinitions` в этой задаче ещё не используются — **не импортировать их сейчас**, иначе `no-unused-vars` уронит `test:fast`. Импорты добавляет задача 9.

- [ ] **Step 4: Подключить в точках входа**

⚠️ `DisplayAnki` создаётся не в конструкторе `Display`, а в точках входа (`popup-main.js:38-41`, `search-main.js:48-51`) — новая подсистема идёт туда же.

В `ext/js/pages/popup-main.js` и `ext/js/pages/search-main.js` рядом с созданием `DisplayAnki`:

```js
const displayTranslation = new DisplayTranslation(display);
displayTranslation.prepare();
```

- [ ] **Step 5: Стили панели**

В `ext/css/display.css`:

```css
.translation-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 0.25em 0.5em;
}
.translation-toolbar-button {
  font: inherit;
  cursor: pointer;
  padding: 0.15em 0.6em;
  border-radius: 0.25em;
}
```

⚠️ Цвет активного состояния добавляется отдельным правилом с фактической переменной темы: `grep -n -- '--button-.*background' ext/css/display.css` и взять существующую.

- [ ] **Step 6: Прогнать**

Run: `npm run test:fast`
Expected: PASS.

- [ ] **Step 7: Наблюдаемая проверка задачи**

Собрать (`./scripts/yomitan-check.sh --bump && ./scripts/build-all.sh 0.3.2.1 && ./scripts/yomitan-check.sh`), навести на слово:

1. Над списком статей **одна** кнопка `Ru`; в самих статьях кнопок перевода нет.
2. Нажатие — попап видимо раздвигается примерно вдвое; повторное — возвращается к исходной ширине.
3. Отключить словарь переводов в настройках → кнопки нет.
4. Переключить `resultOutputMode` на `split` → кнопки нет.

- [ ] **Step 8: Коммит**

```bash
git add ext/js/display/display-translation.js ext/js/pages/popup-main.js ext/js/pages/search-main.js ext/css/display.css test/display-translation.test.js
git commit -m "feat(translation): single Ru toolbar button that widens the popup"
```

---

## Task 9: Колонка, блюр и событие `translation_opened`

⚠️ **Блюр обязан быть герметичным.** Сегодня перевода в DOM нет вовсе; с блюром текст появится, и его можно выделить, скопировать или прочитать скринридером — то есть получить перевод, не отправив события, ради которого всё делается.

**Files:**

- Modify: `ext/js/display/display-translation.js`, `ext/js/display/display-generator.js`, `ext/css/display.css`
- Test: `test/display-translation.test.js` (дописать), `test/display-translation-events.test.js`

**Interfaces:**

- Consumes: `api.flibRecordEvent` (Task 5), `pairDefinitions` (Task 7), `isFlibHost` (Task 2).
- Produces: `DisplayGenerator.createTermDefinitionContent(definition): HTMLElement` — публичный, возвращает `ul.gloss-list`.
- Produces: `createTranslationCell(row, {blurred, revealed, headword, content}): HTMLElement`.

- [ ] **Step 1: Написать падающий тест разметки**

Дописать в `test/display-translation.test.js` (импорт наверху файла привести к `import {afterEach, beforeEach, describe, expect, test} from 'vitest';`):

```js
import { createTranslationCell } from "../ext/js/display/display-translation.js";
import { setupDomTest } from "./fixtures/dom-test.js";

describe("createTranslationCell", () => {
  /** @type {{teardown: (g: unknown) => unknown}} */
  let env;
  beforeEach(async () => {
    env = await setupDomTest();
  });
  afterEach(async () => {
    await env.teardown(global);
  });

  /** @returns {import('../ext/js/display/translation-pairing.js').TranslationRow} */
  const row = () => ({
    hostIndex: 0,
    hostDefinition: null,
    translation: /** @type {import('dictionary').TermDefinition} */ (
      /** @type {unknown} */ ({ dictionary: "ru", sequences: [1], id: 1 })
    ),
  });
  const content = () => document.createTextNode("перевод");

  test("заблюренная ячейка — настоящая кнопка с внятной подписью", () => {
    const cell = createTranslationCell(row(), {
      blurred: true,
      revealed: false,
      headword: "give up",
      content: content(),
    });
    expect(cell.tagName).toBe("BUTTON");
    expect(cell.getAttribute("aria-label")).toBe("Показать перевод: give up");
  });

  test("содержимое герметично: aria-hidden и inert", () => {
    const cell = createTranslationCell(row(), {
      blurred: true,
      revealed: false,
      headword: "x",
      content: content(),
    });
    const inner = /** @type {HTMLElement} */ (cell.firstElementChild);
    expect(inner.getAttribute("aria-hidden")).toBe("true");
    expect(inner.hasAttribute("inert")).toBe(true);
  });

  test("фильтр блюра стоит на внутреннем узле, а не на кнопке", () => {
    const cell = createTranslationCell(row(), {
      blurred: true,
      revealed: false,
      headword: "x",
      content: content(),
    });
    expect(cell.classList.contains("is-blurred")).toBe(false);
    expect(cell.querySelector(".is-blurred")).not.toBe(null);
  });

  test("раскрытая ячейка кнопкой не является и не блюрится", () => {
    const cell = createTranslationCell(row(), {
      blurred: true,
      revealed: true,
      headword: "x",
      content: content(),
    });
    expect(cell.tagName).toBe("DIV");
    expect(cell.querySelector(".is-blurred")).toBe(null);
  });

  test("вне flib.club ячейка сразу открыта", () => {
    const cell = createTranslationCell(row(), {
      blurred: false,
      revealed: false,
      headword: "x",
      content: content(),
    });
    expect(cell.tagName).toBe("DIV");
  });

  test("прочерк не кликается и не фокусируется", () => {
    const empty = createTranslationCell(
      { hostIndex: 0, hostDefinition: null, translation: null },
      { blurred: true, revealed: false, headword: "x", content: content() },
    );
    expect(empty.tagName).toBe("SPAN");
    expect(empty.getAttribute("aria-hidden")).toBe("true");
    expect(empty.textContent).toBe("—");
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npm run test:unit -- test/display-translation.test.js`
Expected: FAIL — `createTranslationCell` не экспортируется.

- [ ] **Step 3: Публичный рендер глоссария в `DisplayGenerator`**

⚠️ Дублировать разбор структурированного контента нельзя: он умеет изображения, ссылки и вложенность, и вторая реализация разойдётся молча. Выносим ту же строку, что уже есть в `_createTermDefinition` (`:516`).

В `ext/js/display/display-generator.js`:

```js
    /**
     * Список толкований одного определения, без обёртки .definition-item.
     * Используется колонкой перевода, которая рисует правую ячейку ряда.
     * @param {import('dictionary').TermDefinition} definition
     * @returns {HTMLElement}
     */
    createTermDefinitionContent(definition) {
        const {dictionary, entries} = definition;
        const list = document.createElement('ul');
        list.className = 'gloss-list';
        this._appendMultiple(list, this._createTermDefinitionEntry.bind(this), entries, dictionary);
        return list;
    }
```

- [ ] **Step 4: Ячейка**

В `ext/js/display/display-translation.js` добавить импорты `isFlibHost` и `pairDefinitions` (теперь они используются) и функцию:

```js
/**
 * ⚠️ Блюр ставится на ВНУТРЕННИЙ узел, а не на кнопку: иначе размывается и её
 * фокусное кольцо, и клавиатурный пользователь не видит, где находится.
 * Радиус в em, потому что размер шрифта попапа — настройка.
 *
 * ⚠️ inert нужен потому, что статья может содержать <details>, чей <summary>
 * иначе ловит фокус по Tab внутри скрытого поддерева.
 * @param {import('./translation-pairing.js').TranslationRow} row
 * @param {{blurred: boolean, revealed: boolean, headword: string, content: Node}} details
 * @returns {HTMLElement}
 */
export function createTranslationCell(
  row,
  { blurred, revealed, headword, content },
) {
  if (row.translation === null) {
    const empty = document.createElement("span");
    empty.className = "translation-cell translation-cell-empty";
    empty.setAttribute("aria-hidden", "true");
    // ⚠️ «для этой статьи», а не «для этой части речи»: штамп соответствия
    // части речи не гарантирует, и обещать его в интерфейсе нельзя.
    empty.title = "для этой статьи перевода пока нет";
    empty.textContent = "—";
    return empty;
  }
  if (!blurred || revealed) {
    const open = document.createElement("div");
    open.className = "translation-cell";
    open.appendChild(content);
    return open;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "translation-cell translation-cell-blurred";
  button.setAttribute("aria-label", `Показать перевод: ${headword}`);
  const inner = document.createElement("div");
  inner.className = "is-blurred";
  inner.setAttribute("aria-hidden", "true");
  inner.setAttribute("inert", "");
  inner.appendChild(content);
  button.appendChild(inner);
  return button;
}
```

- [ ] **Step 5: Рендер рядов и сирот**

Заменить заглушку `_renderColumns` и добавить соседние методы:

```js
    /**
     * ⚠️ Ряд = статья: правая ячейка живёт в ОДНОМ узле со своим определением.
     * Отдельная колонка-сиблинг дала бы второй скролл и разъезд по вертикали.
     */
    _renderColumns() {
        const options = this._display.getOptions();
        if (options === null) { return; }
        const blurred = isFlibHost(this._display.getOptionsContext().url ?? '');
        const columns = this._open && this._layout === 'columns';

        for (const [entryNode, dictionaryEntry] of this._entries) {
            // ⚠️ Снимаем ВСЁ своё, включая строки-сироты: иначе каждый рендер
            // добавлял бы ещё одну, и список рос бы с каждым нажатием.
            for (const stale of entryNode.querySelectorAll('.translation-cell, .translation-orphan')) {
                stale.remove();
            }
            for (const inner of entryNode.querySelectorAll('.definition-item-inner')) {
                delete /** @type {HTMLElement} */ (inner).dataset.translationLayout;
            }
            if (!this._open) { continue; }

            const rows = pairDefinitions(dictionaryEntry, {
                translationDictionary: options.flibTranslation.translationDictionary,
                hostDictionary: options.flibTranslation.hostDictionary,
                strict: this._strict,
            });
            const headword = dictionaryEntry.headwords[0]?.term ?? '';
            for (const row of rows) {
                if (row.hostIndex === null) {
                    this._appendOrphanRow(entryNode, row, headword, blurred, columns);
                    continue;
                }
                const item = entryNode.querySelector(`.definition-item[data-index="${row.hostIndex}"]`);
                const inner = /** @type {?HTMLElement} */ (item?.querySelector('.definition-item-inner') ?? null);
                if (inner === null) { continue; }
                inner.dataset.translationLayout = columns ? 'columns' : 'stack';
                inner.appendChild(this._buildCell(row, headword, blurred));
            }
        }
    }

    /**
     * @param {import('./translation-pairing.js').TranslationRow} row
     * @param {string} headword
     * @param {boolean} blurred
     * @returns {HTMLElement}
     */
    _buildCell(row, headword, blurred) {
        const translation = row.translation;
        const content = translation === null ?
            document.createDocumentFragment() :
            this._display.displayGenerator.createTermDefinitionContent(translation);
        const revealed = translation !== null && this._revealed.has(translation.id);
        const cell = createTranslationCell(row, {blurred, revealed, headword, content});
        if (translation !== null) {
            cell.dataset.definitionId = `${translation.id}`;
            cell.dataset.lemma = headword;
            if (cell.tagName === 'BUTTON') {
                cell.addEventListener('click', () => { this._reveal(translation.id, headword); });
            }
        }
        return cell;
    }

    /**
     * ⚠️ Видимая сирота честнее тихой пары не с той частью речи.
     * @param {HTMLElement} entryNode
     * @param {import('./translation-pairing.js').TranslationRow} row
     * @param {string} headword
     * @param {boolean} blurred
     * @param {boolean} columns
     */
    _appendOrphanRow(entryNode, row, headword, blurred, columns) {
        const list = entryNode.querySelector('.definition-list');
        if (list === null || row.translation === null) { return; }
        const item = document.createElement('li');
        item.className = 'definition-item translation-orphan';
        const inner = document.createElement('div');
        inner.className = 'definition-item-inner';
        inner.dataset.translationLayout = columns ? 'columns' : 'stack';
        const left = document.createElement('div');
        left.className = 'definition-item-content';
        const chip = document.createElement('span');
        chip.className = 'translation-orphan-chip';
        chip.textContent = 'только перевод';
        left.append(headword, ' ', chip);
        inner.append(left, this._buildCell(row, headword, blurred));
        item.appendChild(inner);
        list.appendChild(item);
    }

    /**
     * Снимает блюр С ОДНОЙ ячейки и шлёт ровно одно событие.
     * @param {number} definitionId
     * @param {string} lemma
     */
    _reveal(definitionId, lemma) {
        this._revealed.add(definitionId);
        // ⚠️ Результат намеренно игнорируется: поведение интерфейса не должно
        // зависеть от того, записалось ли событие.
        void this._display.application.api.flibRecordEvent('translation_opened', [lemma]);
        this._renderColumns();
    }
```

- [ ] **Step 6: Тест раскрытия и событий**

Создать `test/display-translation-events.test.js`. Каркас: `setupDomTest()`, затем собрать `DisplayTranslation` через `Object.create(DisplayTranslation.prototype)` с подменёнными `_display` (`getOptions`, `getOptionsContext`, `displayGenerator.createTermDefinitionContent`, `application.api.flibRecordEvent`) и `_entries`, заполненной двумя статьями — `book up` и `give up`, обе с переводом-сиротой. Проверки:

```js
test("раскрытие колонки событий не шлёт", () => {
  // _open = true; _renderColumns(); expect(calls.length).toBe(0)
});
test("клик по ячейке даёт РОВНО одно событие с леммой этой статьи", () => {
  // click -> expect(calls).toEqual([['translation_opened', ['give up']]])
});
test("две статьи — два независимых события", () => {
  // клик по обеим -> ['book up'] и ['give up'] по отдельности
});
test("повторный рендер событие заново не шлёт", () => {
  // _renderColumns(); expect(calls.length).toBe(1)
});
test("раскрытая ячейка остаётся открытой до contentClear", () => {
  // после _renderColumns() у неё нет .translation-cell-blurred
});
test("contentClear сбрасывает revealed — ячейка снова под блюром", () => {
  // _revealed.clear(); _renderColumns(); есть .translation-cell-blurred
});
test("EN и RU одной статьи — потомки одного .definition-item", () => {
  // item.querySelector('.gloss-list') и item.querySelector('.translation-cell') не null
});
```

⚠️ Тесты обязаны проверять **число вызовов** `flibRecordEvent`, а не только факт: A15 в ТЗ специально сформулирован не-тавтологично — «ноль на нажатие при том, что клик по ячейке в том же прогоне даёт запись».

- [ ] **Step 7: Стили колонки**

В `ext/css/display.css`:

```css
.definition-item-inner[data-translation-layout="columns"] {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 0.75em;
  align-items: start;
}
.definition-item-inner[data-translation-layout="stack"] .translation-cell {
  display: block;
  margin-top: 0.5em;
}
.translation-cell {
  min-width: 0;
}
.translation-cell-empty {
  cursor: default;
  opacity: 0.6;
}
.translation-cell-blurred {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.translation-cell-blurred > .is-blurred {
  filter: blur(0.45em);
  user-select: none;
  pointer-events: none;
}
.translation-orphan-chip {
  font-size: 0.85em;
  opacity: 0.7;
}
```

⚠️ Колонок в гриде **три**, а не две: `.definition-item-inner` содержит `button.expansion-button` (`templates-display.html:60`), и при `.collapsible` она видима. С `1fr 1fr` ячейка уехала бы на вторую строку.

- [ ] **Step 8: Прогнать**

Run: `npm run test:fast`
Expected: PASS.

- [ ] **Step 9: Коммит**

```bash
git add ext/js/display/display-translation.js ext/js/display/display-generator.js ext/css/display.css test/display-translation.test.js test/display-translation-events.test.js
git commit -m "feat(translation): hermetic blur, in-entry column, orphan rows and translation_opened"
```

---

## Task 10: Событие `word_added_to_dict`

**Files:**

- Modify: `ext/js/display/display-translation.js` (добавить `pickAddedLemma`), `ext/js/display/display-anki.js`
- Test: `test/anki-add-event.test.js`

- [ ] **Step 1: Написать падающий тест**

Создать `test/anki-add-event.test.js`:

```js
import { describe, expect, test } from "vitest";
import { pickAddedLemma } from "../ext/js/display/display-translation.js";

describe("pickAddedLemma", () => {
  test("обычная статья — заголовочное слово", () => {
    expect(
      pickAddedLemma({ headword: "figure out", expressionField: null }),
    ).toBe("figure out");
  });
  test("попап фразы — то, что в поле на момент добавления, а не выделение", () => {
    expect(
      pickAddedLemma({
        headword: "take it easy!!",
        expressionField: "take it easy",
      }),
    ).toBe("take it easy");
  });
  test("пустое поле фразы откатывается к заголовку", () => {
    expect(
      pickAddedLemma({ headword: "give up", expressionField: "   " }),
    ).toBe("give up");
  });
  test("ничего пригодного — null", () => {
    expect(pickAddedLemma({ headword: "  ", expressionField: null })).toBe(
      null,
    );
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `npm run test:unit -- test/anki-add-event.test.js`
Expected: FAIL — `pickAddedLemma` не экспортируется.

- [ ] **Step 3: Реализация**

В `ext/js/display/display-translation.js`:

```js
/**
 * ⚠️ Для попапа фразы лемма берётся из ПОЛЯ на момент добавления, а не из
 * исходного выделения: пользователю разрешено править текст выражения перед
 * добавлением, и переход кнопки view->add завязан именно на правку.
 * @param {{headword: string, expressionField: ?string}} details
 * @returns {?string}
 */
export function pickAddedLemma({ headword, expressionField }) {
  const fromField =
    typeof expressionField === "string" ? expressionField.trim() : "";
  if (fromField.length > 0) {
    return fromField;
  }
  const fromHeadword = headword.trim();
  return fromHeadword.length > 0 ? fromHeadword : null;
}
```

- [ ] **Step 4: Хук в обычное добавление**

В `_saveAnkiNote` (`display-anki.js:1842`), **после** блока `try/catch/finally` и **перед** `if (allErrors.length > 0)` (`:1904`):

```js
// ⚠️ Событие шлётся ПО УСПЕХУ, а не по клику: «добавил», отправленное
// на провалившемся добавлении, — ложь об обучении. Ранний return в try
// (:1888) сюда не доходит, потому что перед ним allErrors уже пополнен.
// ⚠️ Перезапись существующей заметки событием не является: это правка
// уже добавленного, а не добавление в словарь.
if (allErrors.length === 0 && !button.dataset.overwrite) {
  const lemma = pickAddedLemma({
    headword:
      dictionaryEntry.type === "term"
        ? (dictionaryEntry.headwords[0]?.term ?? "")
        : "",
    expressionField: null,
  });
  if (lemma !== null) {
    void this._display.application.api.flibRecordEvent("word_added_to_dict", [
      lemma,
    ]);
  }
}
```

- [ ] **Step 5: Хук в попап фразы**

В `_savePhraseNote` (`:1339`) переменная с текстом поля — **`phraseText`** (`:1348`), ветка успеха — `:1367`. Заменить её на:

```js
            } else {
                this._setPhraseButtonState(cardFormatIndex, [noteId]);
                const lemma = pickAddedLemma({headword: '', expressionField: phraseText});
                if (lemma !== null) {
                    void this._display.application.api.flibRecordEvent('word_added_to_dict', [lemma]);
                }
            }
```

⚠️ При `noteId === null` ветка другая (`allErrors.push`) — событие не уйдёт, и это правильно: «дубликат предотвращён» не есть «добавил».

- [ ] **Step 6: Полный прогон**

Run: `npm test`
Expected: PASS — включая `test:html`, `test:css`, `test:ts` и сухой прогон сборки.

- [ ] **Step 7: Ручная приёмка**

```bash
./scripts/yomitan-check.sh --bump
./scripts/build-all.sh 0.3.2.2
./scripts/yomitan-check.sh
```

Загрузить `builds/cu/` в Chrome, импортировать русский словарь вручную. Проверить по списку:

1. Над списком статей **одна** кнопка `Ru`; в статьях кнопок перевода нет.
2. Нажатие раздвигает попап; повторное — возвращает исходную ширину.
3. ⚠️ **Ожидаемо на сегодняшних данных:** отпечатки словарей не совпадают, поэтому переводы идут **сиротами** с чипом «только перевод», а в консоли попапа одна warn-запись. Колонка прочерков у спаренных статей — это не успех, а признак того, что пары нет.
4. На `flib.club` перевод под блюром; клик снимает блюр с одной ячейки; на `example.com` перевод открыт сразу.
5. `Ex` открыта + `Ru` открыта → закрытие `Ex` не схлопывает колонку, и наоборот.
6. Смена слова: колонка остаётся раскрытой, все ячейки снова под блюром.
7. Вторая вкладка: нажатие `Ru` в одной отражается в другой.
8. DevTools попапа → `indexedDB` → база `flib-events`: в `events` записи `translation_opened` и `word_added_to_dict`; повтор того же слова на той же странице новой записи не даёт.
9. **Firefox:** то же самое; ⚠️ если событий нет — проверить, выданы ли host-permissions (известное различие, Task 5).
10. **Обход учёта — ПОДТВЕРДИТЬ, что он именно такой, а не хуже** (ТЗ §7.18, §7.19; принято для этого релиза, чинить не надо — надо увидеть своими глазами):
    - открыть `search.html` расширения, найти слово с переводом: переводы должны быть **сразу открыты** (блюра нет) и в `flib-events` **не появиться ни одной записи**;
    - в режиме `popup-window` (отдельное окно попапа) на странице `flib.club`: ячейка **под блюром**, клик её раскрывает — и записи в `flib-events` при этом **нет**. Это ожидаемое состояние: блюр есть, учёта нет.
11. **`{{glossary}}` уносит перевод в карточку мимо учёта** (ТЗ §5.4а; тоже принято, проверяется на факт): взять формат карточки, чей шаблон использует `{{glossary}}`, добавить заметку по слову с русским переводом — в поле карточки **окажется русский глоссарий**, хотя в попапе он показан только в колонке и записи `translation_opened` не было. Убедиться, что английский глоссарий при этом на месте.
12. **Ручной ресайз попапа переживает следующий лукап.** Открыть `Ru`, потянуть за уголок попапа мышью до заметно другого размера, затем навести на новое слово. Ожидается: попап остаётся у размера, до которого его дотянули (ширина и высота), а не откатывается к тому, что было до ресайза. Отдельно проверить во вложенном попапе (навести на слово ВНУТРИ уже открытого попапа, если словарь это допускает) и, если доступно, при включённой опции `showIframePopupsInRootFrame` — это два случая, для которых чинился маршрут `frontendSetPopupSize` (см. §5.2 ТЗ, коммит `93fb1f8d`, BLOCKING 1).
13. **Высота попапа не скачет между лукапами при открытой `Ru`.** Открыть `Ru`, затем подряд навести на несколько разных слов, у которых заведомо разное число определений (короткая статья → длинная статья → снова короткая). Ожидается: высота попапа плавно подстраивается под каждое слово, а НЕ залипает на высоте, зафиксированной при первом слове, и не остаётся раздутой от самого высокого просмотренного слова. Это регрессия, которую чинил коммит `14b348cf` (арбитр брал `base` один раз при первом запросе вместо обновления на каждый).
14. **Стопка `Ru` — не только переключение, но и сама раскладка.** Сузить попап (или использовать `popup-window`) так, чтобы `chooseLayout` вернул `stack`, раскрыть `Ru` и убедиться, что строки перевода рисуются двухрядной стопкой: первый трек (кнопка сворачивания) правильной ширины, без удвоенного отступа между строками — а не сломанной сеткой. Юнит-тестом покрыт только выбор `chooseLayout`; сама CSS-грид-раскладка `[data-translation-layout="stack"]` невидима jsdom и на этой ветке чинилась дважды CSS-only коммитами (`3745ece5`, `b1614590`) — пункт 2 проверяет только переключение ширины, не саму раскладку.

- [ ] **Step 8: Коммит**

```bash
git add ext/js/display/display-anki.js ext/js/display/display-translation.js test/anki-add-event.test.js
git commit -m "feat(events): word_added_to_dict on successful Anki add"
```

---

## Соответствие критериям приёмки ТЗ

| критерий                                       | задача | чем проверяется                             |
| ---------------------------------------------- | ------ | ------------------------------------------- |
| A14 (одна кнопка, условия показа)              | 8      | `_shouldShowButton` + ручная 7.1, 7.3, 7.4  |
| A15 (ноль событий на нажатие, не тавтологично) | 9      | `display-translation-events`                |
| A16 (клик снимает блюр с одной)                | 9      | `display-translation-events`                |
| A17 (схлопывание возвращает base)              | 1, 8   | `computeAppliedSize` + ручная 2             |
| A18 (EN и RU в одном узле)                     | 9      | `display-translation-events`                |
| A19 (прочерк инертен)                          | 9      | `display-translation`                       |
| A20 (герметичность блюра)                      | 9      | `display-translation`                       |
| A21 (`open` переживает, `revealed` нет)        | 8, 9   | `display-translation-events` + ручная 6, 7  |
| A22 (арбитр `Ex` и `Ru`)                       | 1      | `computeAppliedSize` «СЖИМАЕТСЯ» + ручная 5 |
| A23 (стопка, popup-window)                     | 8      | `chooseLayout`                              |
| A24, A25 (хосты, одна реализация)              | 2      | `flib-host`                                 |
| A26, A27, A28 (гейт, дедуп, атомарность)       | 4, 5   | `flib-events-database`, `flib-record-event` |
| A29 (нормализация лемм)                        | 3      | `flib-event-envelope`                       |
| A30 (ротация)                                  | 4      | `flib-events-database`                      |
| A32 (две статьи — два события)                 | 9      | `display-translation-events`                |
| A33–A35 (`word_added_to_dict`)                 | 10     | `anki-add-event` + ручная 8                 |
| A36 (оба рода под гейтом)                      | 5      | `flib-record-event`                         |
| A37 (ключ не в бэкапе)                         | 6      | `flib-secrets`                              |
| §3.3 (строгий режим по отпечаткам + warn)      | 7, 8   | `translation-pairing` + ручная 3            |

**Вне этого плана:** A1–A13, A31, A38–A42 — доставка словарей, чанк-поиск, трек ядра.

## Известные пробелы

- **A31 (кириллица `wty-en-en` не блюрится)** выполняется по построению — блюр накрывает только определения словаря переводов, — но своего теста не имеет: нужен настоящий словарь. Проверяется вручную.
- **Пара словарей со штампами не существует** (ТЗ §12), поэтому в ручной приёмке подтверждается **отказ** строгого паринга (сироты + warn), а не его срабатывание. Полная проверка — после плана доставки.
- **`flibService.gatewayUrl`** заводится, но читателя не имеет до появления отправщика — осознанно, ТЗ §6.3.
- **`_applyPopupSizeTarget`** покрыт unit-тестом только через чистую `computeAppliedSize`; сама проводка во `frontend.js` проверяется вручную (пункт 5 приёмки) — для неё нужен живой попап.

Ниже — то, что осталось от рабочего блокнота исполнения (`.superpowers/sdd/2026-09-07-russian-translation-column/progress.md`, git-ignored, будет удалён вместе с воркспейсом). Ветка на момент записи — HEAD `93fb1f8d`, все задачи плана и обе состязательные волны правок завершены, дерево чистое.

### Дыры тест-сьюта, доказанные мутацией и намеренно не закрытые

Каждая ниже воспроизведена так: правится продакшн-код одной строкой, сьют остаётся зелёным. Кто угодно может это перепроверить тем же способом.

- **A20 (герметичность блюра, CSS).** `test/display-translation.test.js` (хелпер `ruleBody`) ищет правило регэкспом через `RegExp.exec` **без глобального флага** — это возвращает только ПЕРВОЕ совпадение в `display.css`. Более позднее, более специфичное переопределение, которое вернуло бы `.translation-cell-blurred > .is-blurred { user-select: text; }` где-нибудь ниже по файлу, тест не увидит вовсе.
- **A25 (один хост-литерал).** `test/flib-host.test.js` («литерал хоста `flib.club` встречается в коде только в `flib-host.js`») проверяет буквальную подстроку `code.includes('flib.club')`, а не инвариант «есть вторая независимая реализация хост-проверки». Вторая реализация, написанная как регэксп с экранированной точкой — `/(?:^|\.)flib\.club$/u` — не содержит подстроки `flib.club` (между `b` и `c` стоит `\.`, а не `.`) и обходит проверку целиком.
- **Весь жизненный цикл видимости `DisplayTranslation` не застрахован.** Греп по `test/display-translation*.test.js` на `_toggle`, `_applyState`, `_removeButton` не находит ни одного упоминания. Это значит, что можно без разговора с сьютом удалить: условия показа кнопки из A14, само переключение `_toggle` (A17), персистентность через `chrome.storage` (A21), рендер по `_layout` в `_applyState` (A22/A23) и снятие требования размера в `_removeButton` (см. группу Task-8 ниже) — сьют не покраснеет ни на одном из них. Сюда же — молчаливая зависимость арбитра размера от `box-sizing: border-box` на `iframe.yomitan-popup`, которую не поймает ни один тест: она уже записана в спеке §5.2, здесь не повторяется.
- **A37 (личный ключ — пароль, не текст).** `ext/settings.html` — `type="password"` на `data-setting="flibService.personalKey"` не утверждается ни одним тестом. Замена на `type="text"` проходит `html-validate` и ни один unit-тест на неё не ссылается.
- **`test/flib-record-event.test.js` по-прежнему `vi.mock`-ает весь модуль `flib-events-database.js`** и подсовывает `isUsable` как обычное свойство объекта-заглушки, а не как геттер над реальным соединением. Это и было корнем находки BLOCKING 2 состязательной проверки в `93fb1f8d`: `isUsable → true` и выпотрошенный `Database.setOnCloseListener` оставляли сьют зелёным, потому что мок не пропускал через себя ни один из них. Честный интеграционный тест на реальном `fake-indexeddb`-соединении добавлен РЯДОМ, в `test/flib-events-database.test.js` (три кейса, включая сквозной через настоящий `Backend`) — **но старый мокающий файл никуда не делся**. Если этот новый `describe` когда-нибудь удалят как «дублирующий», дыра вернётся молча.

### Группа Task-8: жизненный цикл тулбара

Гонка `_onContentUpdateComplete` (отставший обработчик мог переустановить видимость кнопки и заново захватить требование размера после того, как более свежий вызов уже всё убрал) **закрыта** токеном поколения `_contentUpdateToken`: `display-translation.js:225-241`, JSDoc на `:216-224` прямо называет этот сценарий причиной, по которой токен заведён. Это не остаток — считать его так значит послать читателя чинить уже сделанное.

Единственный реально запаркованный остаток этой группы: `_removeButton` (`display-translation.js:354-368`) обнуляет `_applyStateToken`, дожидается `await frontendReleasePopupSize`, а затем пишет `this._layout` и `this._button.hidden` **без повторной сверки `_contentUpdateToken`** — то есть релиз размера токеном прикрыт, а запись состояния кнопки после него нет. Латентный, но узкий: нужен более свежий `_onContentUpdateComplete`, успевающий обогнать этот `await`.

Пять смежных отложенных находок того же раунда правок (не паркованы отдельно, но и не закрыты):

- `ensurePopupToolbar` при полубитом существующем баре создаёт второй — **недостижимо сегодня**;
- при `parent === null` хелпер не кэширует, два потребителя получили бы разные бары — **недостижимо в реальном DOM**;
- `_removeButton` сбрасывает `this._layout`, но не зовёт `_renderColumns`;
- `DisplayAnki` кэширует `_popupToolbar` навсегда и не сверяет с DOM — **вне области** этой ветки;
- слушатель `chrome.storage.onChanged` никогда не снимается — **вне области** этой ветки.

Всё вместе трассируется к одному структурному факту: панель тулбара (`ext/js/display/popup-toolbar.js`) общая, но её жизненным циклом видимости управляют **две независимые** подсистемы — `DisplayAnki` (владеет левым слотом, кнопкой Ex) и `DisplayTranslation` (владеет правым слотом, кнопкой Ru; `_ensureButton` — `display-translation.js:311`), каждая ссылается на общий узел и снимает/ставит своё независимо. Латентный конфликт за узел общего слота — между `DisplayTranslation._ensureButton` и `DisplayAnki._hideVideoExamplesDensityToggleIfEmpty` (`display-anki.js:1009`, действие на `:1016-1017`). Контроллер плана остановил цикл правок на втором раунде, и итоговая проверка всей ветки независимо согласилась не трогать эту область. Записываю это как область, которую стоит **переструктурировать, если когда-нибудь появится третий потребитель** общего тулбара — не как список багов на сегодня: остаток узкий (нужен выигрыш гонки в несколько round-trip'ов) и не блокировал ни одну задачу плана.

### Осознанно оставленные проектные хвосты

- **Поле `ts` в сторе `dedup` и его индекс (стор объявлен в `ext/js/data/flib-events-database.js`, метод `prepare()`) не имеют читателя.** Уборка ключей дедупа (`_rotate`) с ревизии 6 идёт по сиротству (сверка с живыми ключами из `events`), а не по возрасту — индекс `ts` остался от прежней схемы. Не убран, потому что удаление индекса требует бампа версии базы (`FLIB_EVENTS_DB_VERSION`), а поле `ts` понадобится обратно в день, когда ТЗ `О-7` будет пересмотрено вместе с появлением отправщика (спека §6.3, §11 «О-7» — ротация по возрасту снова станет осмысленной, но уже над **отправленным**, а не над всем подряд).
- **У барьера подсчёта в `_rotate` (`dedup.count() > live.size`, `ext/js/data/flib-events-database.js` вокруг строки 338) есть второй порядок каверзы, отдельный от задокументированного в коде самолечения.** Код и спека (§6.3) уже фиксируют: если внешнее повреждение убрало живой ключ из `dedup`, барьер это пропустит (счётчики совпадут), но следующая запись той же пары «страница+лемма» восстановит ключ сама. Не зафиксировано нигде: если после такого восстановления ОДНА и та же пара «страница+лемма» оказалась представлена **двумя** событиями, делящими один физический ключ дедупа (старое — до потери, новое — после самолечения), а затем ротация по переполнению вытесняет **более старое** из этих двух событий — цикл вытеснения удаляет дедуп-ключ по лемме вытесняемого события, то есть тот же самый физический ключ, которым всё ещё пользуется **выжившее** событие. Ключ выжившего события исчезает вместе с вытесненным — состояние «потерянного ключа» воспроизводится заново, уже без внешнего повреждения, чисто последовательностью самолечение → переполнение. Достижимо только из внешней порчи данных как первого шага; ущерб ограничен одной временно заглушённой леммой.

### Вопрос только для владельца продукта — уже пишется в данные

Ключ дедупа события снимает фрагмент URL (`stripUrlFragment`, `ext/js/data/flib-event-envelope.js:57-73`) **намеренно, а не по недосмотру** — сам код прямо утверждает (без пометки `ЗАМЕРЕНО`, то есть не перепроверено инвентаризацией): на читалке `flib.club` номер страницы живёт именно во фрагменте, и без среза `…/read/1#p=7` и `…/read/1#p=8` дали бы два разных ключа для одной и той же книги на одной и той же странице — а именно от такого раздувания ключ и защищает. То есть срез фрагмента УЖЕ реализует «одно событие на книгу», а не «на страницу», и это решение, а не пропуск: не «чинить» `stripUrlFragment`, если кто-то захочет вернуть постраничную гранулярность.

Инвентаризации адресных схем `flib.club` в этом плане не было (вне области, ТЗ и рамки этой ветки её не запрашивали) — а от неё зависит настоящий открытый вопрос:

- **достаточна ли продукту гранулярность «одно событие на книгу»**, или нужна более тонкая привязка. Утверждение из комментария кода про постраничный фрагмент нигде не перепроверено инвентаризацией: если на КАКОЙ-ТО поверхности `flib.club` фрагмент вместо номера страницы адресует целиком другую книгу (клиентский роутинг без пути или query), тот же срез схлопнёт разные книги в один ключ — и это уже не «одно на книгу», а потеря данных;
- одновременно волатильные query-параметры (`?sid=…`, `?t=…`) в ключе **сохраняются** — если такие есть на реальных страницах, они срывают дедуп полностью (каждый визит — новый ключ) и позже уедут в конверте события к шлюзу.

Нужна инвентаризация форм URL `flib.club` от владельца продукта.

### Нормализация лемм: расхождение с шлюзом, невидимое до первой отправки

Расширение (`normalizeLemmas`, `ext/js/data/flib-event-envelope.js`) схлопывает ЛЮБОЙ пробег пробельных символов (`\s+` → один обычный пробел) перед `trim().toLowerCase()`. Шлюз (`route-word-events.ts:64`, спека §6.2/§6.3 помечает эту строку `ИЗ КОДА`) делает только `trim()` + `toLowerCase()` — БЕЗ схлопывания внутренних пробелов. Ни одна из двух сторон не применяет Unicode NFC. Спека §6.2 говорит прямо: шлюз резолвит леммы **точным совпадением, без лемматизации** — значит любое из следующих расхождений молча не резолвит слово вообще, без ошибки и без сигнала:

- составной и разложенный варианты одного и того же символа (например, `Café` через `U+00E9` против `e` + `U+0301`) остаются РАЗНЫМИ строками после `toLowerCase()` с обеих сторон, потому что NFC не применяет никто;
- класс `\s` в JS-регэкспе `/\s+/gu` покрывает `U+00A0`, `U+2000`–`U+200A`, `U+202F`, `U+205F`, `U+3000`, `U+FEFF`, но **не** покрывает `U+200B` (zero-width space), `U+00AD` (soft hyphen) и `U+2060` (word joiner) — заголовок статьи с любым из них внутри схлопыванием не тронется и до шлюза доедет с невидимым символом внутри.

Не исправлено на этой ветке: невидимо до первого реального импорта леммы с одной из этих особенностей, и решение требует согласования формата с `anki_conf` (кросс-репозиторная зависимость, спека §12), а не только правки расширения.
