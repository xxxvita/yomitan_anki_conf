# Кнопка «?» (часть речи по контексту): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Кнопка «?» в левой полосе карточки спрашивает у ChatGPT через шлюз часть речи слова в предложении и ставит
карточку на подходящую статью.

**Architecture:**

- Чистый модуль `flib-pos.js` (промпт, тело запроса, разбор ответа, сопоставление со статьями).
- Метод клиента шлюза поверх общего OpenAI-прокси.
- Обработчик API в service worker.
- Компонент `DisplayPosHint` в popup, который встаёт в `.content-sidebar-top` под стрелками `DisplayStrip`.

**Tech Stack:** JS (ES modules, checkJs), vitest + jsdom, существующие `FlibGatewayClient`, `Display`, i18n `translate`.

**Spec:** `docs/superpowers/specs/2026-11-15-pos-hint-button-design.md`

## Global Constraints

- Домен `flib.club` — только в `ext/js/data/flib-host.js` (A25, `test/flib-host.test.js`).
- Ручка: `POST /v1/openai/chat/completions`, `Authorization: Bearer tpk_…`, через `FlibGatewayClient._requestJson`.
- Тело запроса: `model "gpt-4o-mini"`, `temperature 0.4`, `response_format {"type":"json_object"}`.
  - system — дословно `pos_detect` из anki_conf `configs/llm_queries.yaml` в коммите `5e34f6249` (закрепление копии, общий документ anki_conf `docs/ref/card-enrichment-and-pos.md`);
  - user — `"#DATA " + JSON.stringify({w, s})`.
- Канон частей речи: noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, interjection,
  numeral. `name` отдельно и с noun не совпадает.
- Коды ошибок (таблица из spec):
  - `flib_key_missing`, `flib_key_invalid` (401 и 403);
  - `llm_quota_exhausted` (429 `quota_exhausted`);
  - `flib_rate_limited` (прочие 429);
  - `flib_service_unavailable` (404, 5xx, сеть, таймаут);
  - `llm_bad_answer`.
- Тексты для пользователя через i18n на ru и en, ключи в обоих файлах. Названия сервисов «Chad» и «LingQ» нигде
  не упоминаются.
- Лицензионный заголовок GPL на каждом новом JS-файле.

## Review Focus

1. Ответ пришёл после того, как пользователь навёл на другое слово, — карточка не должна прыгнуть (Task 4,
   `stale answer is dropped`).
2. Ошибка шлюза не должна выглядеть как «нет статьи» (Task 4, `quota error shows its own text and link`).
3. Кавычки, переводы строк и обратный слэш в предложении не ломают запрос (Task 1, `body survives quotes`).
4. ChatGPT отвечает «Verb», текстом вокруг JSON или незнакомым словом (Task 1, `parse tolerant`, `parse rejects unknown`).
5. Повторное нажатие на ту же фразу не тратит квоту (Task 4, `cache avoids second request`).

---

### Task 1: Чистый модуль части речи

**Files:**

- Create: `ext/js/data/flib-pos.js`
- Test: `test/flib-pos.test.js`

**Interfaces:**

- Produces:

  - `FLIB_POS_SYSTEM_PROMPT: string`
  - `buildPosRequestBody(word: string, sentence: string): object`
  - `parsePosAnswer(content: unknown): ?FlibPos`, где `FlibPos` — одно из 10 канонических имён
  - `entryPosSet(entry: import('dictionary').DictionaryEntry): Set<string>` — канон из `headwords[*].wordClasses`
    и `definitions[*].tags[*].name`; `name` остаётся `name`
  - `pickEntryByPos(entries, pos: string, currentIndex: number): number` — `currentIndex`, если текущая
    подходит, иначе первая подходящая, иначе `-1`
  - `countWords(sentence: string): number`

- [ ] **Step 1: Write failing tests** `test/flib-pos.test.js`:
  - `body survives quotes`: `JSON.parse(body.messages[1].content.slice(6))` для предложения `He said "book it"\n\\` равен `{w, s}`; `body.model === 'gpt-4o-mini'`, `temperature === 0.4`, `response_format.type === 'json_object'`, `messages[0].content === FLIB_POS_SYSTEM_PROMPT`.
  - `prompt is pos_detect verbatim`: промпт начинается с `Role: English part-of-speech tagger.` и содержит строку `- pos: exactly ONE of noun, verb, adjective, adverb, pronoun, preposition,`.
  - `parse tolerant`: `'{"pos":"verb"}'` → `verb`; `'Sure: {"pos": "Verb"} ok'` → `verb`; `'{"pos":"adj"}'` → `adjective`.
  - `parse rejects unknown`: `'{"pos":"gerundive"}'`, `'no json'`, `null`, `'{"pos":3}'` → `null`.
  - `entry pos`: `wordClasses ['v']` → `{verb}`; `['n']` + тег `uncount` → `{noun}`; `['name']` → `{name}`.
  - `pick`: текущая подходит → её индекс; подходит вторая → 1; ничего → -1; pos `noun` против статьи `name` → -1.
  - `countWords`: `''` → 0, `'book'` → 1, `'book a table'` → 3.
- [ ] **Step 2: Run** `npm run test:unit -- --exclude '.claude/**' test/flib-pos.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `ext/js/data/flib-pos.js`. Таблица сокращений — по `ALIAS` из anki_conf `electron/renderer/yomitan/pos-normalise.ts` (n, v, vt, vi, adj, adv, pron, prep, conj, det, artic, article, intj, int, num, number, name и полные названия). Разбор: подстрока от первой `{` до последней `}`, `JSON.parse`, поле `pos` в нижнем регистре, затем таблица.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): pure part-of-speech helpers and the pos_detect prompt`.

### Task 2: Метод клиента шлюза

**Files:**

- Modify: `ext/js/comm/flib-gateway-client.js` (новый публичный метод после `getExamples`)
- Modify: `types/ext/flib-gateway.d.ts` (тип `PosResult = {pos: string}`)
- Test: `test/flib-gateway-client.test.js`

**Interfaces:**

- Consumes: `buildPosRequestBody`, `parsePosAnswer` (Task 1).
- Produces: `detectPartOfSpeech(word: string, sentence: string, {signal}?): Promise<import('flib-gateway').PosResult>`. Бросает ExtensionError с кодами из Global Constraints.

- [ ] **Step 1: Write failing tests** (фейковый `fetch`, как в соседних тестах файла):
  - `pos ok`: 200 с `{"choices":[{"message":{"content":"{\"pos\":\"verb\"}"}}]}` → `{pos:'verb'}`; запрос ушёл на `${base}/v1/openai/chat/completions` с `Authorization: Bearer tpk_…`.
  - `pos 401 text` → `flib_key_invalid`; `pos 403 text "API key revoked"` → `flib_key_invalid`.
  - `pos 429 quota` с телом `{"error":"quota_exhausted","service":"openai"}` → `llm_quota_exhausted`.
  - `pos 429 rate` с телом `{"error":{"type":"rate_limit_error","code":"rpm_exceeded"}}` → `flib_rate_limited`.
  - `pos 404`, `pos 502`, `pos 503`, сеть → `flib_service_unavailable`.
  - `pos bad answer`: 200 с content `"hello"` или без `choices` → `llm_bad_answer`.
  - `pos empty input`: пустое слово или пустое предложение → `flib_word_empty`, без запроса.
- [ ] **Step 2: Run** `npm run test:unit -- --exclude '.claude/**' test/flib-gateway-client.test.js -t pos` — Expected: FAIL.
- [ ] **Step 3: Implement** `detectPartOfSpeech`: `_requestJson('POST', '/v1/openai/chat/completions', {body, signal})`; поймать ExtensionError и переложить коды. 403 → `flib_key_invalid`, `flib_rate_limited` с `data.reason === 'quota_exhausted'` → `llm_quota_exhausted`, `flib_http_error` и `flib_network`/`flib_timeout` → `flib_service_unavailable`. Остальное пробросить. Ответ: `choices[0].message.content` → `parsePosAnswer`, `null` → `llm_bad_answer`. Общий `_createHttpError` не менять: на нём держатся примеры.
- [ ] **Step 4: Run** — Expected: PASS, весь файл зелёный.
- [ ] **Step 5: Commit** `feat(pos): ask the gateway's OpenAI proxy for the part of speech`.

### Task 3: API service worker

**Files:**

- Modify: `types/ext/api.d.ts` (`flibPosDetect: {params: {word: string; sentence: string}; return: import('flib-gateway').PosResult}`)
- Modify: `ext/js/background/backend.js` (регистрация рядом с `flibGatewayExamples`:324, обработчик рядом с `_onApiFlibGatewayExamples`)
- Modify: `ext/js/comm/api.js` (`flibPosDetect(word, sentence)`)
- Test: `test/flib-pos-backend.test.js`

**Interfaces:**

- Consumes: `detectPartOfSpeech` (Task 2).
- Produces: `api.flibPosDetect(word: string, sentence: string): Promise<{pos: string}>`.

- [ ] **Step 1: Write failing tests** по образцу `test/flib-secrets-backend.test.js`:
  - `forbidden sender`: отправитель — content script чужой вкладки → `flib_secret_forbidden`;
  - `delegates`: страница расширения → вызывает `detectPartOfSpeech('booked','I booked a table')` и возвращает его результат.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `_onApiFlibPosDetect({word, sentence}, sender)`: `this._requireFlibPageSender(sender)`, затем `this._flibGateway.detectPartOfSpeech(word, sentence)`.
- [ ] **Step 4: Run** the test and `npm run test:ts` — Expected: PASS, tsc без ошибок.
- [ ] **Step 5: Commit** `feat(pos): flibPosDetect API for extension pages`.

### Task 4: Кнопка в полосе карточки

**Files:**

- Create: `ext/js/display/display-pos-hint.js`
- Modify: `ext/js/display/popup-main.js` (создать после `DisplayStrip`, вызвать `prepare()`)
- Modify: `ext/js/i18n/messages-ru.js`, `ext/js/i18n/messages-en.js` (ключи ниже)
- Modify: `ext/css/flib-card.css` (`.fc-strip-pos`, `.fc-strip-pos-label`, состояние `[aria-busy=true]`)
- Test: `test/display-pos-hint.test.js`

**Interfaces:**

- Consumes: `api.flibPosDetect` (Task 3); `entryPosSet`, `pickEntryByPos`, `countWords` (Task 1); `display.history.state.sentence`, `display.dictionaryEntries`, `display.selectedIndex`, `display.moveCurrentEntry(offset)`, события `contentUpdateComplete`, `contentClear`, `currentEntryChanged`, `optionsUpdated`.
- Produces: `class DisplayPosHint { constructor(display, {api}); prepare(): void }`.

i18n ключи (ru / en):

- `pos.button`: «Какая это часть речи здесь?» / «Which part of speech is it here?»;
- `pos.short.<canon>`: «сущ.», «гл.», «прил.», «нар.», «мест.», «предл.», «союз», «опр.», «межд.», «числ.» / «n.», «v.», «adj.», «adv.», «pron.», «prep.», «conj.», «det.», «intj.», «num.»;
- `pos.full.<canon>`: полное название;
- `pos.noEntry`: «{pos}: такой статьи нет» / «{pos}: no entry of this kind»;
- `pos.quota`: «Квота переводов на этот месяц исчерпана» / «The translation quota for this month is used up»;
- `pos.quotaLink`: «Продлить квоту переводов — скоро будет» / «Extend the translation quota — coming soon»;
- `pos.rateLimited`, `pos.unavailable`, `pos.badAnswer`, `pos.keyMissing`, `pos.keyInvalid`.

- [ ] **Step 1: Write failing tests** (фейковый `display` с `EventDispatcher`, как в `test/display-strip.test.js`):
  - `disabled with one entry or one-word sentence`;
  - `enabled with two entries and a sentence`;
  - `moves to matching entry`: ответ `verb`, статьи `[n, v]`, текущая 0 → `moveCurrentEntry(1)`; подпись `гл.`;
  - `stays when current matches`: `moveCurrentEntry` не вызван;
  - `no entry`: ответ `adverb` → подсказка `pos.noEntry`, без перехода;
  - `one request on double click`;
  - `stale answer is dropped`: `contentUpdateComplete` до ответа → без перехода и без подписи;
  - `cache avoids second request`: два нажатия на ту же пару слово+предложение → один вызов API;
  - `quota error shows its own text and link`: ошибка `llm_quota_exhausted` → текст `pos.quota` и `pos.quotaLink`, а не `pos.noEntry`;
  - `key errors`: `flib_key_missing` и `flib_key_invalid` → свои тексты.
- [ ] **Step 2: Run** `npm run test:unit -- --exclude '.claude/**' test/display-pos-hint.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `DisplayPosHint`:
  - состояние по spec — `_button`, `_busy`, `_label`, `_requestId`, `_cache`;
  - слово берётся из `headwords[0].sources[0].originalText` текущей статьи, запасное — `headwords[0].term`;
  - кнопка добавляется в `.content-sidebar-top` последней, после `.fc-strip-next`;
  - подсказка и сообщения ставятся в `title` и в видимую подпись под кнопкой;
  - ошибки ключа показывают текст, блок ключа в узкой полосе не монтируется.
- [ ] **Step 4: Run** the test file, then `npx eslint` on changed files, `npx html-validate`, `npm run test:css` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(pos): "?" button under the entry arrows`.

### Task 5: Проверка целиком

- [ ] **Step 1:** Чистый экспорт (`git checkout-index --prefix=<scratchpad>/export/ -f -a`, ссылка на node_modules):
      `npm run build`, `test:js`, `test:ts`, `test:html`, `test:css`, prettier по md, `test:unit` — всё зелёное.
- [ ] **Step 2:** Живая проверка в Chromium (Playwright, распакованная сборка, мини-словари `dev/card-shot/mkdicts.py`
      со статьями `book` n и v, заглушка шлюза на `127.0.0.1:18778` отвечает `{"pos":"verb"}`). Наведение на «book»
      в «book a table», нажатие «?» — карточка на статье `v`, под кнопкой «гл.». Скриншот отправить владельцу.
- [ ] **Step 3:** Адверсариальный аудит (P8, только отчёт) с главным утверждением: «устаревший ответ никогда не
      переключает карточку, и ни одна ошибка шлюза не показывается как "нет статьи"». HIGH и CRIT исправить до PR.
- [ ] **Step 4:** PR в `main`, слияние — по слову владельца.
