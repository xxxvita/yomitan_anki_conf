# Video Examples Feature — Handoff Doc

**Что**: Yomitan plugin (форк → Flib-club) показывает видео-нарезки слов из Anki-Conf Core и сохраняет выбранные клипы в Anki note.

**Где**: `/home/xxxvita/Work/yomitan_phrases/src/` (НЕ путать с cwd текущей сессии Claude Code, которая может быть `/home/xxxvita/Work/English/services/anki_conf_yomitan` — это другой репо, Core).

**Команды**:

```bash
cd /home/xxxvita/Work/yomitan_phrases/src
npm run test:js && npm run test:ts:main && npm run test:css && npm run test:build
./scripts/build-all.sh
```

Reload extension в `chrome://extensions` → закрыть старые табы → новый таб → ховер слова → `Ex`.

---

## Архитектура высокого уровня

**Два процесса:**

- **Anki-Conf Core** (отдельный repo, Go-сервис на `127.0.0.1:8777`) — режет видео из demon-нарезок, проксирует AnkiConnect.
- **Flib-club plugin** (этот repo, Yomitan-форк) — UI, рендер клипов, запись в `data` поле Anki note.

**Транспорт:** поллинг (не SSE). Плагин ходит через background-context (`backend.js` → `AnkiConfClient`), bypassing page CSP/CORS.

**Anki note type:** "Yomitan Card Type" с новым полем `data` (lowercase, mirrors ReverseDeck precedent). Поле создаётся бутстрапом через `modelFieldAdd`.

---

## Статус коммитов

| #   | Branch                      | Status      | Описание                                                                                                                                      |
| --- | --------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `feat/data-field-bootstrap` | ✅ DONE     | `modelFieldAdd` wrapper + `apiReflect` capability-probe + post-verify в `_applyOptions` с signature-dedup                                     |
| P2  | `feat/ex-button-skeleton`   | ✅ DONE     | `Ex` кнопка в term/kanji/phrase entries рядом с `+`                                                                                           |
| P3  | `feat/clips-client`         | ✅ DONE     | 6 методов в `AnkiConfClient`: `startCollectExamples`, `pollCollectExamplesStatus`, `persistClips`, `recutClip`, `getClipsStats`, `pruneClips` |
| P4  | `feat/poll-orchestrator`    | ✅ DONE     | `CollectExamplesJob`, per-entry registry, batch 250ms, 1.5s→3s после 15s, hard timeout 120s                                                   |
| P5  | `feat/clip-cards`           | ✅ DONE     | Inline `.entry-video-examples` секция, skeletons, cards, empty/error states                                                                   |
| P6  | `feat/clip-player-modal`    | ✅ DONE     | Fullscreen modal с `<video>` + `<track>` через Blob URL (SRT→VTT in-place)                                                                    |
| P7  | `feat/persist-on-save`      | ✅ DONE     | Hook в `_saveAnkiNote` перед `addNote` → persist → build `data.videos[]` JSON                                                                 |
| P8  | `feat/known-word-replay`    | ✅ DONE     | F2: парс `data` из `noteInfos`, render read-only клипы из cache                                                                               |
| P9  | `feat/cache-stats-ui`       | ⏳ DEFERRED | Settings page с prune buttons — отложено, post-MVP                                                                                            |

**Доп. UX iterations поверх P1-P8** (не в исходном плане):

- Popup widening через `frontendEnsurePopupWidth` cross-frame API (popup растёт до 820px или 96vw при открытии Ex)
- `:has()` grid layout: видео-панель справа от слова в entry, а не под всей выдачей
- Density toggle (Large/Compact) в `popup-toolbar-actions` слева от CheckWords. Compact (default) — row-cards с чекбоксом слева. Large — vertical с overlay. `localStorage` ключ `yomitan-video-examples-density`. Hot-switch через `panel.setDensity()` без потери selection.
- Thumbnail fallback: если Core не прислал `thumb_data_url` → рендерим `<video preload="metadata" muted>` тем же URL'ом, браузер показывает первый кадр.
- Чекбоксы 1.5em + dark backdrop + green selected border + counter `N selected` в header панели.
- Bootstrap retry на каждый Ex-клик (idempotent, для случая «Anki-Conf включили после старта SW»).
- Stale "Queued..." на ошибке обнуляется. Повторный клик Ex на упавшей панели = чистый retry.

---

## Файлы

**Новые** (`ext/`):

- `js/data/video-examples-bootstrap.js` — модель/поле bootstrap, signature-dedup, status enum
- `js/data/video-examples-data-field.js` — `serializeVideosForData` / `parseVideosFromData`, NFC + U+2028/U+2029 escape, `_owner: "flib-club-video-examples"` marker
- `js/display/video-examples-modal.js` — fullscreen video modal, SRT→VTT in-place converter
- `js/display/video-examples-orchestrator.js` — `CollectExamplesJob`, polling, batch buffer, abort
- `js/display/video-examples-panel.js` — inline card panel, density modes (compact/large)

**Модифицированные**:

- `css/display.css` — `.entry-video-examples*` styles + modal + `:has()` grid + density modes + popup-toolbar-density toggle
- `js/background/backend.js` — bootstrap hook в `_applyOptions` с signature-dedup, 6 API handlers `_onApiLexiconClips*`
- `js/comm/anki-conf-client.js` — 6 новых методов через shared `_postJson`/`_getJson` хелперы с per-op timeouts (start 30s, status 10s, persist/recut 60s, stats 5s, prune 30s)
- `js/comm/anki-connect.js` — `modelFieldAdd(modelName, fieldName, index?)` обёртка (БЕЗ index = append; -1 = НЕ конец!)
- `js/comm/api.js` — 6 фронтенд-обёрток + `lexiconClipsStart/Status/Persist/Recut/Stats/Prune`
- `js/display/display-anki.js` — orchestrator + panel registry + modal + density toggle + replay path
- `js/app/frontend.js` — `frontendEnsurePopupWidth(minWidth)` action для расширения iframe popup'а
- `templates-display.html` — `Ex` кнопка в term/kanji/phrase entry templates
- `types/ext/anki-conf.d.ts` — clip типы (snake_case намеренно — match wire + data-field format)
- `types/ext/api.d.ts` — 6 новых API entries
- `types/ext/cross-frame-api.d.ts` — `frontendEnsurePopupWidth` action type

---

## Wire contract (то, что плагин ожидает от Core)

### `POST /api/v1/lexicon/collect-examples/start`

```json
{ "words": ["word"], "filters": { "cefr": [...], ... } }
→ { "job_id": "cex_...", "words": [...], "started_at": "..." }
```

### `GET /api/v1/lexicon/collect-examples/status/{job_id}`

```json
{ "job_id", "state": "pending|partial|ready|failed",
  "started_at", "updated_at",
  "words": [{
    "word", "lemma", "forms", "stage", "empty_reason",
    "clips": [{
      "clip_id", "order_index",
      "clip_url",      // ⚠️ Core ставит через videoFileURL() — НЕ /clip-url?path=
      "subtitle_url",  // на лету SRT→VTT (или плагин конвертит сам, fallback есть)
      "thumb_data_url", // ⚠️ Core ДОЛЖЕН слать. Без него плагин fallback на <video metadata>
      "subtitle_text", "duration_ms", "year", "cefr", "difficulty",
      "recut": { "token": "<opaque §7>", "order_index": 0 }
    }]
  }]
}
```

### `POST /api/v1/lexicon/clips/persist`

```json
{ "job_id", "clips": [{"clip_id"}] }
→ { "persisted": [{
    "clip_id", "cache_key", "clip_url", "subtitle_url",
    "duration_ms", "subtitle_text",
    "recut": {"token", "order_index"},
    "meta": {"lemma", "forms", "year", "cefr", "difficulty"}
  }], "failed": [{"clip_id", "error"}] }
```

### `POST /api/v1/lexicon/clips/recut`

```json
{ "recut": {"token", "order_index"} }
→ { "persisted": {...same shape as persist...} }
```

### `GET /api/v1/lexicon/clips/file/{cache_key}.{mp4|vtt}`

Durable serve route, port/restart-стабильный, Range support.

### `GET /api/v1/lexicon/clips/stats`

```json
→ { "cache_bytes", "cache_count", "scratch_bytes", "scratch_count",
    "service": "anki-conf-core", "version": "..." }
```

### `POST /api/v1/lexicon/clips/prune`

```json
{ "scope": "scratch"|"unreferenced", "keep_cache_keys": [...] }
→ { "removed", "freed_bytes" }
```

---

## `data` поле schema (Anki note)

```json
{
  "_owner": "flib-club-video-examples",
  "v": 1,
  "videos": [
    {
      "cache_key": "9f2a...c1",
      "duration_ms": 6250,
      "subtitle_text": "...",
      "recut": { "token": "<opaque>", "order_index": 0 },
      "lemma": "serendipity",
      "forms": ["serendipity", "serendipitous"],
      "year": 2014,
      "cefr": "B2",
      "difficulty": 3,
      "selected_at": "2026-06-19T14:01:00Z",
      "server_origin": "http://127.0.0.1:8777"
    }
  ]
}
```

- URL'ы НЕ хранятся — строятся runtime из `${confServer}/api/v1/lexicon/clips/file/${cache_key}.{mp4|vtt}`
- `_owner` marker — F2-parser отказывается читать чужой формат (collision-safe против других плагинов)
- `server_origin` — для F2 warning при `confServer change post-save`
- `subtitle_text` нормализован NFC + escape U+2028/U+2029

**Critical:** в `card_grading.json` для Yomitan Card Type поле `data` ДОЛЖНО быть в `reference_only_fields`, иначе грейдер давится JSON. Это правка **Core-side**, не плагин.

---

## Live test setup (user environment)

- **User's AnkiConnect URL**: `http://127.0.0.1:8777/` (НЕ 8765 — Anki-Conf Core проксирует AnkiConnect на том же порту 8777)
- **User's Anki-Conf Core URL**: `http://127.0.0.1:8777` (тот же сервер, разные ручки)
- Соответственно в Yomitan settings → Anki:
  - `Anki server (AnkiConnect)`: `http://127.0.0.1:8777/`
  - `Anki-Conf Core server address`: `http://127.0.0.1:8777`
- Anki Connect addon должен быть ≥ 2022-08 (для `modelFieldAdd` action)
- Минимум Anki ≥ 23.10 (требование текущего AnkiConnect addon)

---

## Локкнутые решения

1. **Поле name = `data`** (lowercase, mirrors ReverseDeck precedent). Yomitan AnkiConnect case-insensitive matching защищает от `Data`/`data` collision.
2. **snake_case в clip типах** (НЕ camelCase) — данные через всю цепочку (wire → плагин → data поле) идут как есть. Меньше mapping-боли. Trade-off vs Yomitan convention.
3. **Three-tier re-cut fallback в F2**:
   - Tier 0: durable cache (`/clips/file/{cache_key}.mp4`)
   - Tier 1: `POST /clips/recut` с opaque token (gateway-side TTL — дни max)
   - Tier 2: fresh `startJob([lemma], filtersFromMeta)` с warning
4. **Polling cadence**: 1.5s × 10 (15s), backoff до 3s, hard timeout 120s. Registry TTL 10 минут после terminal state.
5. **Batch dedup**: плагин буферизует 250ms, дедупит по word, отправляет одним `start` (cap 10 слов per spec).
6. **Per-entry-DOM-node polling registry** — `Map<HTMLElement, JobEntry>`. Двойной клик на entry = no-op. Клик на разных entry = независимые job'ы.
7. **Persistence = Core-side durable cache** (НЕ Anki media). Anki media раздувается на видео, AnkiWeb sync limits, Check Media эвиктит.
8. **No `thumb_data_url` в data.videos[]** — слишком большой (50-200KB base64). На F2 replay тамбнейл подгружается через `<video preload="metadata">` fallback.
9. **CSP/CORS bypassed** — все fetch к Core идут через background-context Yomitan (`backend.js`).
10. **Density default = compact** — Yomitan popup-колонка ~280px, compact (row-cards с боковым checkbox) помещает больше клипов чем large (vertical с overlay).

---

## Известные edge cases (зафиксированы в коде)

- `state=partial` → render готовых clips, не ждём `ready`
- `subtitle_url=null` → only `subtitle_text`, no `<track>`
- `duration_ms=0` → no timeline overlay (видео сам определит через `<video duration>`)
- 404 `job_not_found` → terminal `expired` state, UI: «Session expired — click Ex again»
- `recut.token=""` → tier 1 unavailable, skip to tier 2
- durable URL 404 → tier 1 → tier 2 → warn «оригинал недоступен»
- F2 → no `start`/`status` поллинг, только парс `data` поля + lazy HEAD на cache_key при кликe клипа
- VTT-конверсия в плагине если Core отдаёт SRT (заголовок `WEBVTT` + comma→dot в timestamps)
- AnkiConnect offline на `+` → блокировать save с retry (по spec) — сейчас просто error popup
- Double-click Ex на терминальной панели → fresh retry (cancelEntry + destroy + re-mount)
- `data.value=""` или malformed JSON → treat as empty, не падать
- `confServer` change post-save → F2 строит URL из current confServer, на durable 404 → tier 1/2 fallback

---

## Open / Next steps

### Готово к коммиту/PR

- P1-P8 — feature-complete, all linters/types/CSS/build/4116 unit tests green.
- Density toggle UX — done.
- Thumbnail `<video>` fallback — done.

### НЕ закоммичено в git (на момент handoff)

Все изменения локально в working tree. Бранч стратегия не решена. Возможно:

- Один umbrella коммит на `feat/video-examples`
- Или 9 коммитов по P1-P9 пунктам (P9 отдельно)

### Запросы к Core team (НЕ Yomitan-side)

1. Гарантировать non-empty `recut.token` в `persist` response (иначе clip → `failed[]`)
2. Добавить `thumb_data_url` в `word_done.clips[]` — сейчас плагин fallback на `<video>` first frame, но это HEAD-fetch на каждом клипе, медленно
3. Добавить `service: "anki-conf-core"` в `/clips/stats` для plugin auto-detect
4. Добавить `POST /api/v1/lexicon/collect-examples/cancel/{job_id}` для explicit abandon
5. Добавить `data` в `reference_only_fields` для Yomitan Card Type в `card_grading.json` (грейдер игнорирует JSON-блоб)

### P9 (отложено)

- Settings UI section "Clip cache" с stats + prune buttons
- Plugin собирает `cache_key` со всех Yomitan note'ов через `findNotes "note:Yomitan Card Type"` + `notesInfo` + parse `data.videos[].cache_key`
- Передаёт в `clips/prune {scope: "unreferenced", keep_cache_keys}` для Core
- Требует: `findNotes` API exposure (сейчас не выставлен в api.js), новая settings.html секция

### Возможные refinements (по фидбеку user'а)

- Counter bottom-bar `[Selected N] [Combine clip]` в стиле anki_conf (сейчас counter только в header)
- "Watch" кнопка в compact card (сейчас только thumb click → modal)
- "+ Add more" в F2 replay (append к существующему `data.videos[]` через `updateNoteFields`)
- Polling retry с exponential backoff вместо linear backoff
- Persist failure recovery: pending queue в `chrome.storage.local` для случая «persist 200 → addNote fail»

### Outstanding bugs (наблюдались, не закрыты)

- `ERR_INTERNET_DISCONNECTED` на POST к 127.0.0.1:8777. Hypothesis: DevTools Network throttle = "Offline" в SW DevTools. User должен проверить и поставить «No throttling».
- Bootstrap retry на каждый Ex-клик — реализован, но в случае persistent connect_failed (Anki выключен надолго) лога будет много. Можно добавить debounce по таймеру.

---

## Test checklist (manual smoke)

После build + reload extension + закрытия старых табов:

1. **Bootstrap**: открыть SW DevTools (chrome://extensions → service worker link). В console должен быть `[video-examples] added "data" field` или `ready` или `bootstrap skipped (connect failed)` (если Anki off).
2. **Popup width**: ховер слова → popup появляется ~400px → клик `Ex` → popup расширяется до ~820px (или 96vw на узком экране).
3. **Density toggle**: в popup-toolbar появляются кнопки `[Large][Compact]` слева от CheckWords. Default = Compact (row-cards с боковым checkbox).
4. **Compact mode**: cards в одну колонку, чекбокс слева, мелкий thumb 100px, duration справа.
5. **Large mode (клик «Large»)**: cards вертикальные, чекбокс overlay top-left на thumbnail, subtitle поверх thumb.
6. **Thumbnail fallback**: если Core не шлёт `thumb_data_url` → видно первый кадр клипа через `<video preload="metadata">`.
7. **Selection**: чекни 1-2 клипа → видно зелёную обводку + counter `N selected · click + to save`.
8. **Save**: жми `+` → addNote → проверь в Anki Browse → поле `data` содержит JSON с `_owner: "flib-club-video-examples"` и только отмеченные клипы.
9. **F2 replay**: повторный ховер того же слова → клик `Ex` → read-only панель «Saved examples — word» с сохранёнными клипами (без чекбоксов).
10. **Modal**: клик thumbnail → fullscreen модал с `<video controls autoplay>` + subtitle через `<track>` blob URL.
11. **Density persist**: переключи density, F5 страницы → density должна сохраниться.

---

## Команды-шорткаты для debug

```bash
# Lint chain
cd /home/xxxvita/Work/yomitan_phrases/src
npm run test:js && npm run test:ts:main && npm run test:css && npm run test:build

# Full build
./scripts/build-all.sh

# Grep по моим модулям
grep -rn "video-examples" ext/js/ types/

# Проверить что бутстрап в бандле
unzip -p builds/yomitan-chrome-dev.zip js/background/backend.js | grep -c "_maybeBootstrap"

# Версия в manifest
unzip -p builds/yomitan-chrome-dev.zip manifest.json | grep version
```

---

## Ключевые места кода для следующего раза

- **Bootstrap логика**: `ext/js/data/video-examples-bootstrap.js`. Вызывается из `ext/js/background/backend.js:_maybeBootstrapVideoExamplesField` через `_applyOptions`.
- **Data field schema**: `ext/js/data/video-examples-data-field.js` — `serializeVideosForData()`, `parseVideosFromData()`. Owner marker, NFC normalize, U+2028/U+2029 escape.
- **Polling orchestrator**: `ext/js/display/video-examples-orchestrator.js` — `CollectExamplesJob`, `_jobs: Map<HTMLElement, JobEntry>`, `_batchBuffer`, `_pollJob()`.
- **Panel UI**: `ext/js/display/video-examples-panel.js` — `VideoExamplesPanel` class, `setDensity()`, `getSelectedClipIds()`, `_buildClipCard()`.
- **Modal player**: `ext/js/display/video-examples-modal.js` — Blob URL subtitles, `srtToVtt()`, `isVttDocument()`.
- **Display integration**: `ext/js/display/display-anki.js`:
  - `_onShowExamples()` — Ex button click handler
  - `_showVideoExamplesForEntry()` — F2 first, F1 fallback
  - `_buildReplayClipsForEntry()` — F2 parse `noteInfos[*].fields.data`
  - `_applySelectedClipsToNote()` — Hook в save flow перед addNote
  - `_setVideoExamplesDensity()` + `_ensureVideoExamplesDensityToggle()` — density UX
  - `_loadVideoExamplesDensity()` — localStorage read
- **Cross-frame popup widening**: `ext/js/app/frontend.js:_onApiEnsurePopupWidth` + `types/ext/cross-frame-api.d.ts`

---

## Файлы, которые **НЕ** нужно перечитывать в новой сессии

В новой сессии заходи в `/home/xxxvita/Work/yomitan_phrases/src/`. Этот handoff + grep -rn 'video-examples' + чтение конкретных файлов из списка выше = достаточно для продолжения работы.

Не читай:

- Bracketed длинную историю iteration в старом диалоге
- Логи build/test (они zero-bug)
- Скриншоты CSS вариантов

Читай при необходимости:

- Тексты от user в новой сессии (то что попросит сделать)
- Конкретные файлы по `grep` + `Read`
- Этот handoff
- `CLAUDE.md` в корне `/home/xxxvita/.claude/` и в plugin repo (если есть)
