# Обогащение карточки при «+»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** при «+» в Anki приходит обогащённая базовая заметка и две производные (ReverseDeck, Phrases) с озвучкой.
Всё делается через шлюз под ключом пользователя, без Flibooster. Колода «Flibooster» и три типа заметок ставятся
сами.

**Architecture:**

- Данные моделей из anki_conf копируются скриптом с меткой ревизии.
- Чистые модули: промпты и разбор ответов, сборка полей производных.
- Клиент шлюза: chat и TTS.
- Обёртки AnkiConnect.
- Оркестратор `FlibCardEnricher` в service worker: шаги независимы, на выходе отчёт.
- API `flibEnrichNote`.
- В popup: тег `flib_enriched`, вызов обогащения и строка состояния.
- Галочка в настройках.

**Tech Stack:** JS (ES modules, checkJs), vitest + jsdom, существующие `FlibGatewayClient`, `AnkiConnect`, `Backend`,
`DisplayAnki`.

**Spec:** `docs/superpowers/specs/2026-11-15-card-enrichment-design.md`

## Global Constraints

- Только шлюз: `POST /v1/openai/chat/completions`, `POST /v1/text-to-speech/HCfhOrkFKTGCSl4c8rjs`, `Bearer tpk_…`.
- Промпты `enrichment`, `phrases`, `find_form` — дословно из anki_conf `configs/llm_queries.yaml` @ `a62faa63e`.
  Модель gpt-4o-mini, temperature 0.4, `response_format json_object`, user через `JSON.stringify`.
- TTS: тело ровно `{"text": t, "model_id": "eleven_multilingual_v2"}`, без query, `t = NFC(trim(text))`.
- Типы заметок — anki_conf `internal/ankimodels/models/*.json` @ `b112f6648` с меткой
  `/* ankimodels-rev:<16 hex> */\n` первой строкой CSS.
- Колода по умолчанию для новых установок — «Flibooster». Производные заметки идут в колоду базовой.
- Теги производных: `<noteId>_reverse` или `<noteId>_phrases`, `flib_enriched`, пользовательские теги заметки.
- Обогащение только для модели «Yomitan Card Type» и только при `flibService.enrichCards === true` и годном ключе.
- Шаги независимы. Сбой не отменяет добавленную заметку и остальные шаги.
- Литерал `flib.club` — только в `flib-host.js` (A25). GPL-заголовок на новых файлах. Тексты ru и en. «Chad» и «LingQ»
  не упоминаются.

## Review Focus

1. Повторный вызов обогащения для той же заметки (двойной клик, гонка) не создаёт дублей ReverseDeck и Phrases
   (Task 6, `second call for the same note creates nothing`).
2. Сбой одного шага (quota у ChatGPT, quota у TTS, Anki упал между шагами) не роняет остальные и не теряет отчёт
   (Task 6, `each step failing alone`).
3. Типы заметок уже есть: модели не перезаписываются, добавляются только недостающие поля (Task 5,
   `existing model is never recreated`).
4. HTML или кавычки в слове и предложении не ломают JSON и не дают XSS в поля ReverseDeck и Phrases (Task 2,
   `escapes model html`).
5. Галочка выключена: ни одного запроса к шлюзу и нет тега `flib_enriched` (Task 8, `disabled sends nothing`).

---

### Task 1: Модели Anki из anki_conf

**Files:**

- Create: `dev/sync-anki-models.js` (копирует JSON, считает метку, пишет модуль)
- Create: `ext/js/data/flib-anki-models.js` (сгенерированный: `FLIB_ANKI_MODELS`, `FLIB_PRODUCT_DECK = 'Flibooster'`, источник-коммит)
- Create: `dev/lib/anki-model-revision.js` (`modelRevision(model): string`, `stampRevMarker(css, rev): string`)
- Test: `test/anki-model-revision.test.js`

**Interfaces:**

- Produces:

  - `FLIB_ANKI_MODELS: ReadonlyArray<{name: string, fields: string[], css: string, isCloze: boolean, cardTemplates: {Name: string, Front: string, Back: string}[]}>` — CSS уже с меткой; шаблоны по имени в алфавитном порядке, как в Go.
  - `FLIB_PRODUCT_DECK`.

- [ ] **Step 1: Write failing tests:**
  - `golden revisions`: `modelRevision` трёх моделей из anki_conf @ `b112f6648`: Yomitan Card Type `fc38edc91863cf3d`, ReverseDeck `eb902e8263b4dbcf`, Phrases `242a8c70246f3a95` (посчитаны Go-кодом установщика).
  - `marker replaces, never stacks`: `stampRevMarker` над CSS с меткой даёт ровно одну метку первой строкой.
  - `generated module matches sources`: каждая модель в `FLIB_ANKI_MODELS` совпадает с JSON источника (поля, шаблоны, CSS без метки) и несёт метку `modelRevision`.
- [ ] **Step 2: Run** `npm run test:unit -- --exclude '.claude/**' test/anki-model-revision.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** порт `modelRevision`:

  - sha256 над кодировкой с префиксами длины (uvarint) в порядке из `anki_bootstrap_revision.go:57-94`: `"ankimodels-rev/v1"`, имя, число полей и поля, отсортированные имена шаблонов, отсортированные стороны, `normContent` = CRLF→LF + `trim`, CSS без меток, `"cloze"`/`"standard"`;
  - первые 8 байт в hex.

  Затем скрипт `node dev/sync-anki-models.js <anki_conf path> <commit>` пишет `ext/js/data/flib-anki-models.js`.

- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(enrich): Flibooster note types with the revision marker`.

### Task 2: Промпты и чистые функции обогащения

**Files:**

- Create: `ext/js/data/flib-enrich.js`
- Test: `test/flib-enrich.test.js`

**Interfaces:**

- Produces:

  - `FLIB_ENRICH_PROMPTS: {enrichment: {system, user}, phrases: {system, user}, findForm: {system, user}}` — дословно.
  - `buildChatBody(prompt, data: object): object`.
  - `parseJsonAnswer(content: unknown): ?object` — терпимый разбор, от первой `{` до последней `}`.
  - `enrichmentFields(answer, {translateEmpty: boolean}): {ExampleLLM: string, Translate?: string}`.
  - `reverseDeckFields({word, translation, answer, baseAudioFile}): {Front, Back, ExampleLLM, EnglishWords, data}` — `data` по схеме v1.0.
  - `blankSentence(sentence, candidates: string[]): ?string` — первая форма, найденная по границам слова, без учёта регистра → `_____`.
  - `phrasesFields({word, answer, front}): {Front, Expression, EnglishWord, ExpressionTranslate}`.
  - `ttsText(text): string` — NFC(trim).
  - `frontSpeechText(front): string` — `_____` → `... ... ...`.
  - `mediaFileName(kind: 'word'|'rev'|'phr_exp'|'phr_front', key: string|number): string` — `tts_<word>_<id>.mp3`, `tts_rev_<id>.mp3`, `tts_phr_exp_<id>.mp3`, `tts_phr_front_<id>.mp3`. Слово безопасно для имени файла.
  - `escapeHtml(text): string`.

- [ ] **Step 1: Write failing tests:**
  - `prompts verbatim`: начало и одна характерная строка каждого промпта совпадают с YAML @ `a62faa63e`.
  - `escapes model html`: синонимы и переводы с `<script>` в EnglishWords и ExpressionTranslate экранированы, `<br>` и `🔸` — наш разделитель.
  - `reverse data schema`: `{front, englishWords:[{word, partOfSpeech, synonyms, audio:[{selected:true, file}]}], examples:[en, ru, …]}` из items (HTML снят), иначе из eu/eut.
  - `blank`: target_form → слово → нет формы → `null`; регистр и пунктуация.
  - `syn formats`: строка `"word,pos,перевод"` и объект `{word|w, pos, tr|translation}`.
  - `tts text`: `' Livé '` → NFC без пробелов; `frontSpeechText`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(enrich): prompts and pure helpers copied from Flibooster`.

### Task 3: Клиент шлюза — chat JSON и TTS

**Files:**

- Modify: `ext/js/comm/flib-gateway-client.js` — `chatJson(body)`, `synthesizeSpeech(text)`; `detectPartOfSpeech` переходит на `chatJson`.
- Modify: `types/ext/flib-gateway.d.ts` — `SpeechResult = {base64: string, cached: boolean}`.
- Test: `test/flib-gateway-client.test.js`

**Interfaces:**

- Produces:

  - `chatJson(body: object, {signal}?): Promise<string>` — content первого choice. Ошибки как у `_mapLlmError`.
  - `synthesizeSpeech(text: string, {signal}?): Promise<{base64: string, cached: boolean}>`. Коды: `tts_quota_exhausted` (429 `service: elevenlabs_tts`), `flib_key_invalid` (401, 403), `flib_rate_limited`, `flib_service_unavailable`, `tts_failed` (прочие 4xx и пустой звук).

- [ ] **Step 1: Write failing tests** `speech ok` (тело ровно `{"text":"live","model_id":"eleven_multilingual_v2"}`, путь без query, `X-TTS-Cache: hit` → `cached: true`), `speech quota`, `speech 403`, `speech 400 → tts_failed`, `speech empty body → tts_failed`, `chat content`. Существующие тесты `detectPartOfSpeech` остаются зелёными.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Звук читается через `response.arrayBuffer()` и переводится в base64 тем же `encodeBase64Chunked`, что у клипов. Общий `_createHttpError` не меняется.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(enrich): gateway chat JSON and text-to-speech`.

### Task 4: Обёртки AnkiConnect

**Files:**

- Modify: `ext/js/comm/anki-connect.js` — `createModel(model)`, `createDeck(name)`, `removeTags(noteIds, tags)`, `addTags(noteIds, tags)`.
- Modify: `ext/js/comm/anki-route.js` — `createDeck` в `RETRYABLE_ACTIONS` (идемпотентен); `createModel` — нет.
- Test: `test/anki-connect-flib.test.js`

**Interfaces:**

- Produces: `AnkiConnect.createModel({name, fields, css, isCloze, cardTemplates}): Promise<void>` (параметры AnkiConnect `modelName`, `inOrderFields`, `css`, `isCloze`, `cardTemplates`); `createDeck(name): Promise<number>`; `removeTags(ids: number[], tags: string): Promise<void>`.

- [ ] **Step 1: Write failing tests**: тела запросов `createModel`, `createDeck`, `removeTags` (теги через пробел) через фейковый fetch.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(enrich): AnkiConnect createModel, createDeck and tag helpers`.

### Task 5: Установка типов заметок и колоды

**Files:**

- Create: `ext/js/background/flib-anki-setup.js` — `ensureFlibAnkiSetup(anki): Promise<{created: string[], fieldsAdded: string[], deckOk: boolean}>`
- Test: `test/flib-anki-setup.test.js`

**Interfaces:**

- Consumes: `FLIB_ANKI_MODELS`, `FLIB_PRODUCT_DECK` (Task 1); `createModel`, `createDeck`, `getModelNames`, `getModelFieldNames`, `modelFieldAdd` (Task 4 и существующие).
- Produces: `ensureFlibAnkiSetup`; ошибка `anki_model_failed` (ExtensionError с `data.code`), если `createModel` упал не из-за «already exists».

- [ ] **Step 1: Write failing tests:**
  - `creates missing models and the deck`;
  - `existing model is never recreated` — только `modelFieldAdd` для недостающих полей, без `createModel`;
  - `already exists race is not an error`;
  - `deck failure is not fatal`;
  - `createModel failure → anki_model_failed`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** по образцу `BootstrapInstall`. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(enrich): install the Flibooster deck and note types when missing`.

### Task 6: Оркестратор обогащения

**Files:**

- Create: `ext/js/background/flib-card-enricher.js` — `class FlibCardEnricher { constructor({anki, gateway, budgetMs}); enrich(request): Promise<EnrichReport> }`
- Modify: `types/ext/flib-gateway.d.ts` — `EnrichRequest = {noteId: number, userTags: string[]}`, `EnrichReport = {enrich: StepResult, audio: StepResult, reverse: StepResult, phrases: StepResult}`, `StepResult = {status: 'done'|'skipped'|'failed', code?: string}`.
- Test: `test/flib-card-enricher.test.js`

**Interfaces:**

- Consumes:
  - Tasks 2, 3, 4, 5;
  - существующие `notesInfo`, `findNotes`, `findCards`, `cardsInfo`, `updateNoteFields`, `storeMediaFile`, `addNote`.
- Produces: `FlibCardEnricher.enrich`. Читает заметку сам через `notesInfo` (`Word`, `Example`, `Translate`, `Audio`, `modelName`) — данные popup не нужны, кроме `noteId` и пользовательских тегов.

- [ ] **Step 1: Write failing tests** с фейковым Anki (in-memory: заметки, теги, медиа, колоды) и фейковым шлюзом:
  - `all steps done` — три заметки, поля и теги по spec, звук записан;
  - `each step failing alone` (enrichment quota, TTS quota, phrases bad answer, Anki error посреди шагов) — остальные шаги `done`, у упавшего `failed` с кодом;
  - `second call for the same note creates nothing` (параллельно и последовательно);
  - `not Yomitan Card Type → everything skipped, no gateway call`;
  - `existing native audio → audio skipped`;
  - `no translation → reverse skipped`;
  - `budget exceeded → remaining steps failed flib_timeout`;
  - `tts quota once: later clips still tried`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**: порядок шагов, словоформы для пропуска — `[target_form, word]`, затем `find_form`. **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(enrich): enrich a new note and create ReverseDeck and Phrases`.

### Task 7: API, настройка и колода по умолчанию

**Files:**

- Modify: `ext/data/schemas/options-schema.json` — `flibService.enrichCards: boolean`, default `true`.
- Modify: `ext/js/data/options-util.js` — `_updateVersion83`: `enrichCards = true`. В список update-функций.
- Modify: `ext/data/provisioning/default-options.json` — колода карточки «Flibooster», `enrichCards: true`.
- Modify: `types/ext/settings.d.ts`, `test/options-util.test.js` (version 83, ожидаемые опции), `test/data/json.json`, если нужно.
- Modify: `types/ext/api.d.ts`, `ext/js/comm/api.js`, `ext/js/background/backend.js` — `flibEnrichNote({noteId, userTags})`: `_requireFlibPageSender`, ключ годен, иначе отчёт со `skipped`; in-flight по noteId; таймаут в оркестраторе.
- Test: `test/flib-enrich-backend.test.js`, `npm run test:unit:options`.

- [ ] **Step 1: Write failing tests**: `forbidden sender`, `no key → all skipped without requests`, `delegates`; опции версии 83 с `enrichCards: true`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm run test:unit -- --exclude '.claude/**' test/flib-enrich-backend.test.js test/options-util.test.js` и `npm run test:unit:options` — PASS.
- [ ] **Step 5: Commit** `feat(enrich): flibEnrichNote API and the enrichCards option`.

### Task 8: Popup и настройки

**Files:**

- Modify: `ext/js/display/display-anki.js` — перед `addAnkiNote` в `_addNewAnkiNote`: если модель «Yomitan Card Type», `enrichCards` и есть ключ (`flibGatewayStatus`) — тег `flib_enriched`; после успеха — `api.flibEnrichNote` и строка состояния.
- Create: `ext/js/display/flib-enrich-status.js` — `renderEnrichStatus(report|'pending'): HTMLElement`, тексты по кодам.
- Modify: `ext/settings.html` — галочка в разделе «Личный ключ» с `data-setting="flibService.enrichCards"` и `data-i18n`.
- Modify: `ext/js/i18n/messages-ru.js`, `messages-en.js` — `enrich.*`, `settings.enrichCards*`.
- Modify: `ext/css/flib-card.css` — `.fc-enrich-status`.
- Test: `test/flib-enrich-status.test.js`, `test/display-anki-enrich.test.js`.

- [ ] **Step 1: Write failing tests:**
  - статус для `pending`, всех `done`, квоты переводов, квоты озвучки, ключа, сервера;
  - `disabled sends nothing` — галочка выключена, нет тега и вызова;
  - `other model sends nothing`;
  - `tag added before addNote`;
  - `report after content change is dropped`;
  - `enrich call failed entirely → removeTags flib_enriched` через API `flibEnrichNote` с ошибкой.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the test files, `npx html-validate ext/settings.html`, `npm run test:css`, eslint — PASS.
- [ ] **Step 5: Commit** `feat(enrich): tag, enrich and report in the card; settings checkbox`.

### Task 9: Проверка целиком и выпуск

- [ ] **Step 1:** Чистый экспорт: build, js, ts, html, css, md, unit, `test:unit:options` — зелёные.
- [ ] **Step 2:** Живая проверка в Chromium с заглушками AnkiConnect (in-memory, записывает вызовы) и шлюза:
  - «+» на «live» → `createModel` трёх типов и `createDeck`;
  - базовая заметка с `flib_enriched`, ExampleLLM, Translate, Audio;
  - ReverseDeck и Phrases с тегами и звуками;
  - строка «✓…»;
  - повтор → дублей нет.
- [ ] **Step 3:** Финальный адверсариальный обзор (Opus) с главными утверждениями:
  - нет дублей производных при повторном и параллельном вызове;
  - сбой шага не роняет остальные;
  - существующие модели не пересоздаются.
- [ ] **Step 4:** PR, слияние и тег `v0.5.1` — по слову владельца.
