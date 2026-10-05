# Рецензия учебника `docs/system-design.html` — точность по коду

Рецензент: независимая проверка (измерение: «соответствие коду» карточек C2/C3/C4, потоков
«Как идёт запрос», «Находок и рисков», словаря). Дата: 2026-10-05. Ветка `main @ 23cd7c27`.

Проверено чтением (без запуска сборок, без обращения к `~/.config`, `~/dict-enrich-20260828`,
`builds/`, без правок `ext/`): `ext/js/display/translation-pairing.js`, `display-translation.js`,
`display.js`, `display-anki.js`, `popup-main.js`, `search-main.js`; `ext/js/dictionary/dictionary-importer.js`,
`dictionary-database.js`, `dictionary-worker.js`; `ext/js/pages/settings/dictionary-import-controller.js`,
`dictionary-controller.js`, `backup-controller.js`; `ext/js/background/backend.js`, `offscreen.js`,
`offscreen-proxy.js`, `background-main.js`; `ext/sw.js`; `ext/js/app/frontend.js`, `popup.js`,
`content-script-main.js`, `content-script-wrapper.js`; `ext/js/language/text-scanner.js`, `translator.js`;
`ext/js/comm/api.js`, `anki-connect.js`, `anki-conf-client.js`, `mecab.js`, `cross-frame-api.js`;
`ext/js/data/options-util.js`, `flib-host.js`, `flib-events-database.js`, `flib-event-envelope.js`,
`flib-secrets.js`, `provisioning-options.js`; `ext/data/schemas/options-schema.json`,
`dictionary-term-bank-v3-schema.json`, `ext/data/recommended-dictionaries.json`,
`ext/data/provisioning/{default-options,dictionaries}.json`; `ext/settings.html`, `welcome.html`,
`templates-modals.html`, `templates-settings.html`; `ext/manifest.json`, `dev/data/manifest-variants.json`,
`dev/manifest-util.js`, `dev/bin/build.js`, `dev/bin/build-dictionaries.js`,
`dev/bin/check-dictionary-parity.js`, `dev/dictionary-pair/*.js`, `scripts/build-all.sh`,
`package.json`, `eslint.config.js`, `.gitignore`, `test/playwright/global.setup.js`, `test/dictionary-pair/`.

Шкала серьёзности **ошибки учебника**: CRIT — учебник учит опасному/ложному действию;
HIGH — утверждение или «как исправить» неверны по существу; MED — искажение, вводящее в
заблуждение; LOW — неточность (номера строк, формулировка).

---

## 0. Сводка

| Серьёзность | Кол-во |
| ----------- | ------ |
| CRIT        | 0      |
| HIGH        | 0      |
| MED         | 1      |
| LOW         | 9      |

Пять несущих утверждений — **все подтверждены кодом дословно**:

| #   | Утверждение учебника                                                                            | Вердикт                      | Доказательство                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1а  | Строгий паринг только при равных непустых `revision` у `wty-en-en` и `flibooster-en-ru`         | ВЕРНО                        | `translation-pairing.js:37-52`: оба найдены по title, `host.revision.length > 0 && host.revision === translation.revision`. Иначе `display-translation.js:245-248` → `log.warn('flib: dictionary build fingerprints differ…')`, `pairDefinitions` с `strict=false` → все переводы — сироты (`translation-pairing.js:100`, `_appendOrphanRow` `display-translation.js:581-595`, чип «только перевод»). Учебник правильно оговаривает, что при разных ревизиях перевод **виден**, но без пары — формулировка «показывает русский только при равных ревизиях» в учебнике отсутствует, там точное «ставит под английскую статью». |
| 1б  | Словарь с занятым title пропускается                                                            | ВЕРНО                        | `dictionary-importer.js:117-123`: `dictionaryExists(title)` → `Dictionary ${title} is already imported, skipped it.`, `result: null`. Обхода (замены поверх) в ручном импорте нет; ветка «обновления» (`dictionary-import-controller.js:647`) работает только через Check for Updates для `isUpdatable`, а у пары этих полей намеренно нет (`pair-builder.js:138-141`, проверка `pair-verify.js:112-114`).                                                                                                                                                                                                                    |
| 1в  | «Get recommended dictionaries…» предлагает апстримный `wty-en-en`, title совпадает, ломает пару | ВЕРНО (с уточнением, см. M1) | `recommended-dictionaries.json:142-145` (`"en".terms`: name `wty-en-en`, HuggingFace `latest`). Показ — по `general.language` (`dictionary-import-controller.js:166-178`); посев ставит `"language": "en"` (`default-options.json:11`). Импорт пойдёт тем же `DictionaryImporter` → занятое название → наш `wty-en-en.zip` будет пропущен (1б), а `flibooster-en-ru` встанет с чужой ревизией хозяина → сироты + предупреждение (1а).                                                                                                                                                                                         |
| 2   | В Chrome база и переводчик в offscreen; база — не Dexie                                         | ВЕРНО                        | `backend.js:80-101`: `if (!chrome.offscreen)` — `DictionaryDatabase`/`Translator` локально, иначе `DictionaryDatabaseProxy`/`TranslatorProxy(new OffscreenProxy)`. `dictionary-database.js:25` импортирует `Database` из `../data/database.js`, `:32` `_dbName = 'dict'`. Единственное упоминание Dexie в `ext/js` — `pages/settings/backup-controller.js`.                                                                                                                                                                                                                                                                   |
| 3   | MeCab выключен: миграция v77, отзыв nativeMessaging                                             | ВЕРНО                        | `options-util.js:1882-1887` `_updateVersion77`: `enableMecabParser = false`, `enableYomitanApi = false` во всех профилях. `backend.js:329-341`: при наличии `nativeMessaging` — `chrome.permissions.remove`. В `manifest-variants.json:66-77` и `ext/manifest.json:65-76` `nativeMessaging` нет ни в `permissions`, ни в `optional_permissions` (только `clipboardRead`) — включить обратно нельзя; `mecab.js:359` `connectNative` без разрешения не сработает.                                                                                                                                                               |
| 4   | Anki по умолчанию через Core `http://127.0.0.1:8777`; `flibService.gatewayUrl` без читателя     | ВЕРНО (с уточнением L7)      | `options-schema.json:1015-1017` default `http://127.0.0.1:8777`; `default-options.json:198`; `settings.html:1899-1911` («Anki service URL», placeholder и текст про 8777/8765); `anki-conf-client.js:21` `DEFAULT_BASE`. `backend.js:1703-1715`: `this._anki.server = options.anki.server`, `\_ankiConf.setBaseUrl(confServer                                                                                                                                                                                                                                                                                                 |     | server)`. `grep gatewayUrl`по`ext/js`: только запись `options-util.js:1908`и тип`types/ext/settings.d.ts:116` — читателя нет. |
| 5   | `npm run build` без `--version` пишет 0.0.0.0                                                   | ВЕРНО                        | `build.js:249-252` `version` default `'0.0.0.0'`; `build.js:282-288` в `finally` манифест варианта `defaultVariant` = `base` (`manifest-variants.json:122`, `manifest-util.js:57-61`) пишется с `$YOMITAN_VERSION` → `yomitanVersion` (плейсхолдер — `manifest-variants.json:6`). `scripts/build-all.sh:96-100` без версии вызывает `npm run build` без `--version`. `npm test` (`test:build`) идёт с `--dryRun` — запись пропускается (`build.js:287`).                                                                                                                                                                      |

Выборочная проверка номеров строк: **74 ссылки `файл:строка`** из карточек C3/C4, потоков,
симптомов и находок сверены построчно; **расхождений 0** (полный список — §6). Это
необычно высокая точность: каждая проверенная строка указывает ровно на названный
символ/выражение.

---

## 1. Ошибки в карточках (`N` — уровни context/container/component)

### M1. `hf` (контекст) + FINDINGS «Get recommended dictionaries… ломает пару» — не названо главное место ловушки и окно, когда она открыта

- **Где:** `hf.simple` «Кнопка «Get recommended dictionaries…» предлагает скачать апстримный wty-en-en…»; `hf.kind` «…по кнопке в настройках»; FINDINGS (med) `where: ext/data/recommended-dictionaries.json:142-145`; IMPORT шаг 4.
- **На самом деле:** механизм описан верно, но (а) та же кнопка стоит на **странице первого запуска** `welcome.html:110-112` — новая установка открывает именно её, а посев ставит язык `en` (`default-options.json:11`), поэтому `wty-en-en` будет предложен первым делом, до импорта нашей пары; (б) кнопка импорта рекомендованного словаря **заблокирована**, пока установлен словарь с тем же названием (`dictionary-import-controller.js:231-235`: `button.disabled = installedDictionaryNames.has(dictionary.name) || …`). То есть опасное окно — первый запуск и промежуток между «удали старую пару» и «импортируй новую» в шаге 4 инструкции. Учебник ведёт читателя ровно через это окно, не предупредив.
- **Серьёзность:** MED (верное утверждение, но читатель не узнает, где именно наступит на грабли — на welcome-странице, а не «в настройках»).
- **Исправление:** в `hf.simple` дописать: «Кнопка есть и на странице первого запуска welcome.html (welcome.html:110), и в настройках (settings.html:312). Посев ставит язык en, поэтому wty-en-en предлагается сразу. Пока установлен наш wty-en-en, кнопка его импорта неактивна (dictionary-import-controller.js:231-235) — опасны первый запуск и момент между удалением старой пары и импортом новой». В IMPORT шаг 4 добавить: «Между удалением и импортом не нажимай Get recommended dictionaries…». В FINDINGS `where` добавить `ext/welcome.html:110`.

### L7. `anki`, `c-anki`, `core`, `k-backend` — «по умолчанию 8777» без оговорки о профилях, где остаётся 8765

- **Где:** `anki.simple` «Расширение по умолчанию говорит … с Core anki_conf на :8777»; `k-backend.code` «backend.js:1703-1715 anki.server → AnkiConnect и AnkiConfClient (единый адрес)».
- **На самом деле:** для новой установки верно. Но (1) профиль, перешедший с апстримного Yomitan, сохраняет своё `anki.server` (исторический default `http://127.0.0.1:8765`, `options-util.js:386`; ни одна миграция его не переписывает); (2) импорт настроек с не-localhost адресом сбрасывает его на **8765** (`backup-controller.js:389-393`); (3) «единый адрес» не строгий: если у профиля непустой устаревший `anki.confServer`, Core-клиент пойдёт на него, а AnkiConnect — на `anki.server` (`backend.js:1712-1715`, то же в попапе `display-anki.js:300-302`). Миграция v76 обнуляет `confServer` (`options-util.js:1866-1869`), и в UI поля нет, так что на практике адрес один.
- **Серьёзность:** LOW.
- **Исправление:** в `core.facts` «Адрес в настройках» дописать: «…по умолчанию для новой установки. Профили со старым адресом 8765 (перешедшие с Yomitan, или после импорта настроек — backup-controller.js:392) ходят мимо Core: CheckWords и видео-примеры работать не будут».

### L8. `k-anki` / ребро `sw → core` — попап тоже ходит в Core напрямую

- **Где:** ребро container `sw → core` «AnkiConnect-протокол и lexicon API»; `k-anki.simple`.
- **На самом деле:** API-вызовы lexicon идут через бэкенд (`api.js:245-273` `lexicon*` → `_invoke`), но файлы клипов (mp4/vtt) попап берёт по прямому URL Core: `display-anki.js:1055-1057` `_buildClipsFileUrl` → `${confServer}/api/v1/lexicon/clips/file/…`; адрес Core пишется и в поле заметки (`display-anki.js:1995`).
- **Серьёзность:** LOW (пробел, не ошибка).
- **Исправление:** добавить ребро `popup → core` «файлы видео-примеров (clips/file) по прямой ссылке», порт `http://127.0.0.1:8777`.

### L3. Ребро container `cs → popup`, порт «postMessage»

- **Где:** `{ from: "cs", to: "popup", label: "создаёт iframe и передаёт статьи", port: "postMessage" }`.
- **На самом деле:** статьи передаются через `CrossFrameAPI`: `popup.js:361` `_invokeSafe('displaySetContent', …)` → `popup.js:853` `this._application.crossFrame.invoke(…)`; транспорт — порт `chrome.runtime`, который соединяет бэкенд (`backend.js:1216-1241` `_onApiOpenCrossFramePort`, `chrome.tabs.connect`). `window.postMessage` используется только для `displayExtensionUnloaded` (`popup.js:880-894`). Слово «postMessage» читатель поймёт как `window.postMessage`.
- **Серьёзность:** LOW.
- **Исправление:** port: «CrossFrameAPI (порт chrome.runtime через бэкенд)».

---

## 2. Потоки FLOWS

### L2. FLOW `import`, шаг 4 — порядок действий переставлен

- **Где:** «После импорта страница сообщает бэкенду triggerDatabaseUpdated; словарь включается в текущем профиле.» (`dictionary-import-controller.js:645, :678-698`).
- **На самом деле:** сначала `_addDictionarySettings` (включение в текущем профиле, выключено в остальных — `:643`, `:698`), потом `triggerDatabaseUpdated` (`:645`). Порядок важен для понимания: бэкенд получает сигнал, когда настройки уже записаны.
- **Серьёзность:** LOW.
- **Исправление:** «Словарь добавляется в настройки всех профилей (включён только в текущем, :698), затем страница сообщает бэкенду triggerDatabaseUpdated (:645)».

### L4. FLOW `events`, шаг 3 — уборка не входит в транзакцию

- **Где:** «Одна транзакция: проверка ключей дубля…, запись ключей и события; при превышении 10 000 — уборка старых.»
- **На самом деле:** транзакция `events+dedup` — только проверка и запись (`flib-events-database.js:113-191`). Ротация `_rotate()` вызывается **после** завершения записи, отдельно, и её отказ лишь логируется (`flib-events-database.js:192-201`, `_rotate` на `:289`).
- **Серьёзность:** LOW.
- **Исправление:** «…запись ключей и события. После успешной записи отдельно — уборка сверх 10 000 (\_rotate, :198); её ошибка не отменяет запись».

### L1. FLOW `pipeline` шаг 4 и GLOSS «Сторож (G1–G11)» — сторожей не одиннадцать

- **Где:** «Проверяются сторожа G1–G11 и G5h»; GLOSS «Сторож (G1–G11)»; `d-builder.simple` «проверяет сторожей G1–G11».
- **На самом деле:** определено восемь: G1, G2, G3, G4, G5, G7, G9, G11 (`pair-builder.js:180-187`) плюс G5h (`:308`). G6, G8, G10 нет. Карточка `d-builder.code` («checkPairGuards: G1, G2, G3, G4, G5, G7, G9, G11 (+ G5h на :308)») — верна; расходятся только сводные формулировки.
- **Серьёзность:** LOW (диапазон «G1–G11» читается как 11 проверок).
- **Исправление:** «сторожа G1–G5, G7, G9, G11 и G5h (номера с пропусками — по контракту)».

---

## 3. FINDINGS — проверка каждой

| #   | Находка                                         | Вердикт                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | «Нигде не написано, где лежат zip…»             | Суть верна (`provisioning/dictionaries.json` — пустой массив; коммит `54500dad fix(welcome): drop auto-provisioning of bundled wty-en-en.zip` существует). **L5:** fix «печатать путь каталога … в конце вывода» частично уже сделан: путь каталога печатается в stdout (`build-dictionaries.js:72`, поле `directory`) и в stderr в строке о списках (`:74-77`). Не хватает только подсказки об импорте. Исправить fix: «добавить в конец stderr подсказку: какие два zip и куда импортировать». |
| 2   | Нет доставки                                    | Не проверяемо кодом (нет кода — подтверждено отсутствием). OK.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3   | Замена пары только руками                       | ВЕРНО (`dictionary-importer.js:117-123`).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4   | Get recommended ломает пару                     | ВЕРНО, см. M1 (дополнить `welcome.html:110` и окно уязвимости).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | ~4.8 ГБ                                         | Код: банки и zip целиком в памяти (`pair-builder.js:351-358`, `generateAsync` в `nodebuffer`; `package.json:16` `--max-old-space-size=8192`). Цифра — из handoff, учебник это честно помечает. OK.                                                                                                                                                                                                                                                                                               |
| 6   | 755 сочинённых без русского                     | Механизм верен: `isStaleAuthored` `enrich-transform.js:391`, `listUntranslatedAuthored` `:417`, фатальная ошибка `:619`. Счётчики 336/419 — из каталога пары, не проверялись (запрет на `builds/`).                                                                                                                                                                                                                                                                                              |
| 7   | Очередь без отправщика; gatewayUrl без читателя | ВЕРНО: `gatewayUrl` пишется только в `options-util.js:1908`; `personalKey` читается только в `flib-secrets.js:55-66` (вырезание при экспорте) и как поле `settings.html:2537`. `listEvents`/`deleteEvents` (`flib-events-database.js:219, 231`) — вызывающих в `ext/js` нет.                                                                                                                                                                                                                     |
| 8   | Включённость не диагностируется                 | ВЕРНО: `_onApiGetDictionaryInfo` → весь список (`backend.js:1045-1047`); поиск — `_getTranslatorEnabledDictionaryMap` (`:2993`); импорт включает только в текущем профиле (`dictionary-import-controller.js:698`).                                                                                                                                                                                                                                                                               |
| 9   | Тесты красные из-за worktree                    | Код: `eslint.config.js:73` ignores без `.claude` — ВЕРНО. Результат прогона не перепроверялся (вне измерения).                                                                                                                                                                                                                                                                                                                                                                                   |
| 10  | build без --version                             | ВЕРНО (несущее утверждение 5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 11  | Playwright подменяет манифест                   | ВЕРНО: `global.setup.js:30-31` `renameSync(manifest.json → manifest-old.json)` и запись варианта `chrome-playwright` с версией 0.0.0.0.                                                                                                                                                                                                                                                                                                                                                          |
| 12  | CLAUDE.md неточен в трёх местах                 | Все три пункта ВЕРНЫ: Dexie только в `backup-controller.js`; MeCab выключен; `package.json:24` `test:ts` = main+dev+test, без bench. **L6 (дополнение):** есть и четвёртая неточность — CLAUDE.md называет `ext/manifest.json` «committed», а он в `.gitignore:14` и не отслеживается git (`git ls-files ext/manifest.json` пусто). Сам учебник это пишет верно (`flib.facts`).                                                                                                                  |
| 13  | Core слушает все интерфейсы                     | Комментарий `anki-conf-client.js:37` «listens on plaintext 127.0.0.1 and does not require auth» — цитата верна. Состояние сокета — живой факт, не проверялся.                                                                                                                                                                                                                                                                                                                                    |
| 14  | Замена dict_base.db выполнена                   | Вне измерения (живые файлы, запрет на `~/.config`).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 15  | Go -export падает, мы пропускаем                | ВЕРНО по коду: `buildJson.staleAuthoredTranslations` с комментарием о решении владельца (`pair-builder.js:438-440`).                                                                                                                                                                                                                                                                                                                                                                             |
| 16  | MED-1 hasAuthored                               | ВЕРНО: `enrich-transform.js:584` — проверка «есть ли хоть одна строка flibooster-en» на всю базу; при `true` любое исчезнувшее легаси-выражение → `staleAuthored` (`:624-631`), иначе → `missing` и фатальная ошибка (`:734-736`). (Проверил отдельно: `typeof …get(…) !== 'undefined'` — приоритет корректный, `typeof` применяется к результату вызова.)                                                                                                                                       |

---

## 4. Словарь GLOSS

Проверено на соответствие коду: «Offscreen-документ», «IndexedDB», «chrome.storage.local»,
«Профиль», «index.json», «title», «revision», «Банк», «sequence», «Строгий паринг», «Сирота»,
«Режим group», «Деинфлексия», «Core», «Снимок журнала», «mode=ro», «busy_timeout», «Детерминированный
zip», «ID расширения», «Событие обучения».

- «sequence (штамп) — 6-е поле строки банка (номер с нуля)» — верно: в схеме v3 строка ровно из 8 элементов (`minItems`=`maxItems`=8), индекс 6 — `integer` (`dictionary-term-bank-v3-schema.json`); в переводчике отрицательный штамп → -1 (`translator.js:1777-1778`), поиск хозяина берёт только `> 0` (`translation-pairing.js:120`).
- «Банк — … по 10 000 статей» — `BANK_SIZE = 10000` (`pair-builder.js:55`). Верно.
- «Детерминированный zip» — `ZIP_DATE` 1980-01-01 UTC, DEFLATE уровень 6 (`pair-builder.js:64-65`). Верно.
- «busy_timeout … 5 с» — `sources.js:42, :88`. Верно.
- «ID расширения … у распакованного вычисляется из пути» — в манифесте нет поля `key` (проверено `grep`), значит верно.
- «Сторож (G1–G11)» — см. L1.

Остальные определения — без замечаний.

---

## 5. Прочее (не ошибки, мелкие уточнения)

### L9. IMPORT шаг 4 — «ревизия вида 2026.08.29» у апстримного wty-en-en

- Из кода это не выводится: `recommended-dictionaries.json:145` ссылается на `…/latest/…`, ревизия станет известна только после скачивания. Формат «дата через точки» правдоподобен (у `wty-en-en` в `dict_base.db` ревизия 2026.03.05 — по учебнику), но конкретное значение — пример.
- **Серьёзность:** LOW. **Исправление:** «с ревизией-датой (например 2026.08.29 — у апстрима она меняется с каждым выпуском)».

---

## 6. Сверенные ссылки `файл:строка` (все совпали)

| Ссылка учебника                                                                                                 | Что там на самом деле                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| translation-pairing.js:37-52                                                                                    | `isStrictPairingAvailable` целиком                                                                              |
| translation-pairing.js:67-108, 116-137                                                                          | `pairDefinitions`, `findHost` целиком                                                                           |
| dictionary-importer.js:117-123                                                                                  | проверка `dictionaryExists` + текст ошибки                                                                      |
| dictionary-importer.js:381-383                                                                                  | `if (… !title \|\| !revision) throw 'Unrecognized dictionary format'`                                           |
| backend.js:68-70                                                                                                | `new AnkiConnect()`, `new AnkiConfClient()`                                                                     |
| backend.js:80-101                                                                                               | выбор offscreen / локально                                                                                      |
| backend.js:176 / 207 / 227                                                                                      | `termsFind` / `getDictionaryInfo` / `flibRecordEvent` в карте API                                               |
| backend.js:329-341                                                                                              | отзыв `nativeMessaging`                                                                                         |
| backend.js:605-612                                                                                              | `_onApiTermsFind` → `findTerms`, `splice(maxResults)`                                                           |
| backend.js:671                                                                                                  | `_onApiAddAnkiNote` → `this._anki.addNote`                                                                      |
| backend.js:1045                                                                                                 | `_onApiGetDictionaryInfo`                                                                                       |
| backend.js:1300-1320, :1315                                                                                     | `_onApiFlibRecordEvent`, проверка `isFlibHost`                                                                  |
| backend.js:1347                                                                                                 | `_getFlibEventsDatabase`                                                                                        |
| backend.js:1703-1715                                                                                            | `anki.server` → AnkiConnect; `setBaseUrl(confServer \|\| server)`                                               |
| backend.js:2993                                                                                                 | `_getTranslatorEnabledDictionaryMap`                                                                            |
| options-util.js:160                                                                                             | `chrome.storage.local.set({options: …})`                                                                        |
| options-util.js:1882                                                                                            | `_updateVersion77`                                                                                              |
| options-util.js:1901-1909                                                                                       | `_updateVersion78`                                                                                              |
| options-schema.json:1015-1017                                                                                   | `server` default 8777                                                                                           |
| options-schema.json:1393-1411                                                                                   | `flibTranslation`, `flibService`                                                                                |
| offscreen-proxy.js:80-82                                                                                        | `chrome.offscreen.createDocument({url: 'offscreen.html'…`                                                       |
| offscreen.js:52-66                                                                                              | карта API offscreen (перечисленные имена есть)                                                                  |
| background-main.js:28-29                                                                                        | `new Backend`, `prepare()`                                                                                      |
| content-script-main.js:28-31                                                                                    | `PopupFactory`, `Frontend`                                                                                      |
| popup.js:583                                                                                                    | `chrome.runtime.getURL('/popup.html')`                                                                          |
| popup-main.js:45-46                                                                                             | `new DisplayTranslation(display).prepare()`                                                                     |
| search-main.js:55                                                                                               | то же                                                                                                           |
| text-scanner.js:33 / 1318 / 1259-1264                                                                           | `class TextScanner` / `_searchAt` / `getTextSourceContent` → `termsFind`                                        |
| frontend.js:35 / 112 / 1038-1075 / 1083                                                                         | `class Frontend` / `new TextScanner` / `_showContent` / `_showPopupContent`                                     |
| api.js:527                                                                                                      | `flibRecordEvent` → `_invoke`                                                                                   |
| translator.js:80 / 255 / 464                                                                                    | `findTerms` / `_getDictionaryEntries` / `findTermsBulk(…)`                                                      |
| dictionary-database.js:32 / 92-160 / 288 / 493                                                                  | `'dict'` / версии 20–60 / `findTermsBulk` / `getDictionaryInfo`                                                 |
| dictionary-import-controller.js:572 / 636-645 / 678 / 698                                                       | вызов `_importDictionaryFromZip` / тело / `_addDictionarySettings` / `enabled = profileIndex === i`             |
| dictionary-worker.js:76                                                                                         | `new Worker('/js/dictionary/dictionary-worker-main.js')`                                                        |
| dictionary-controller.js:92                                                                                     | `rev.${revision}`                                                                                               |
| templates-modals.html:58 / 72 / 77-98                                                                           | `input type=file multiple` / кнопка Import / модалка Import Dictionaries                                        |
| settings.html:1899-1911                                                                                         | «Anki service URL»                                                                                              |
| display.js:1340 / 1428-1432                                                                                     | `_findDictionaryEntries` / `content.dictionaryEntries` или поиск                                                |
| display-translation.js:28 / 196-214 / 241 / 245-248 / 259-290 / 371 / 421 / 493 / 581-593 / 616-620             | все совпадают с описанием                                                                                       |
| display-anki.js:1349 / 1384 / 1548 / 1847 / 1926-1934                                                           | `_savePhraseNote` / событие фразы / `'CheckWords'` / `_saveAnkiNote` / событие `word_added_to_dict`             |
| anki-connect.js:122 / 483                                                                                       | `addNote` / `_invoke`                                                                                           |
| anki-conf-client.js:21                                                                                          | `DEFAULT_BASE`                                                                                                  |
| flib-host.js:25-38 / 50                                                                                         | `isFlibHost` / `pickSenderUrl`                                                                                  |
| flib-event-envelope.js:90 / 128                                                                                 | `dedupKey` / `buildEvent`                                                                                       |
| flib-events-database.js:23-27 / 80-91 / 111 / 219 / 231                                                         | имя/версия/10000 / хранилища / `recordEvent` / `listEvents` / `deleteEvents`                                    |
| flib-secrets.js:47; backup-controller.js:160                                                                    | `redactFlibSecrets`; его вызов при экспорте                                                                     |
| provisioning-options.js:23                                                                                      | путь посева                                                                                                     |
| default-options.json:81-84                                                                                      | `scanning.inputs` с `include: "shift"`                                                                          |
| recommended-dictionaries.json:142-145                                                                           | запись `wty-en-en`                                                                                              |
| build.js:251, 283-288                                                                                           | default `0.0.0.0`; восстановление манифеста                                                                     |
| build-dictionaries.js:52-59 / 60-63 / 64-66 / 72 / 80-85                                                        | флаги / --verify / пути+stderr / stdout JSON / ошибка+exitCode 1                                                |
| sources.js:33,35 / 37,39 / 42 / 56-61 / 70-90 / 76 / 83 / 113-153 / 192-228                                     | умолчания / env / таймаут / приоритет путей / ro-открытие / текст ошибки / `?mode=ro` / снимок / уборка снимков |
| enrich-transform.js:46-50 / 391 / 417 / 471 / 484 / 511 / 541 / 571 / 584 / 619                                 | все совпадают                                                                                                   |
| pair-builder.js:51 / 55 / 135-147 / 174-213 / 224-312 / 308 / 314 / 389-478 / 410-417 / 447-474 / 458-471 / 463 | все совпадают                                                                                                   |
| pair-verify.js:107-115 / 122-176 / 131-133 / 165                                                                | все совпадают                                                                                                   |
| check-dictionary-parity.js:34-43 / 62-68; parity.js:77, 120                                                     | все совпадают                                                                                                   |
| build-all.sh:38-60 / 96-100 / 102-112 / 127-141                                                                 | все совпадают                                                                                                   |
| eslint.config.js:73                                                                                             | `ignores` без `.claude`                                                                                         |
| global.setup.js:24-33                                                                                           | подмена манифеста                                                                                               |

Прочие факты из карточек, сверенные с кодом: разрешения манифеста (`manifest.json:65-79`), `content_scripts` (`run_at document_idle`, `all_frames`, http/https/file), `options_ui` `open_in_tab`, `sw.js:17` импорт `background-main.js`, ключи `flibTranslationColumnOpen` (`display-translation.js:28`) и `provisioningDone` (`provisioning-controller.js:61`, `backend.js:3051`), схема `flib-events` (events: `event_id`, индексы `ts`, `host`; dedup: `key`, индекс `ts`), `FlibEventType` (`types/ext/flib-events.d.ts:19`), подписи UI («Configure installed and enabled dictionaries…», «Delete All», «Confirm Dictionary Deletion», «Result grouping mode» / «Group term-reading pairs» в «Result Display», «Scan modifier key», «Flib personal key» в Security под `advanced-only`), строгий `parseArgs` сборщика без `allowPositionals` (`--help` → ошибка), `dict_base.db` открывается напрямую `mode=ro`, журнал — через снимок (`pair-builder.js:391, 396`), `TMPDIR` учитывается через `os.tmpdir()`.

---

## 7. Итоговый список ошибок учебника по id

| ID  | Элемент                                                                                                                                                                                 | Серьёзность |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| M1  | `hf` + FINDINGS#4 + IMPORT шаг 4: ловушка «Get recommended» есть и на welcome.html; кнопка неактивна, пока наш wty-en-en стоит → опасны первый запуск и окно между удалением и импортом | MED         |
| L1  | FLOW pipeline шаг 4, `d-builder.simple`, GLOSS: «G1–G11» — на деле 8 сторожей + G5h                                                                                                     | LOW         |
| L2  | FLOW import шаг 4: порядок `_addDictionarySettings` → `triggerDatabaseUpdated`                                                                                                          | LOW         |
| L3  | EDGE `cs → popup` port «postMessage» → CrossFrameAPI (порт chrome.runtime)                                                                                                              | LOW         |
| L4  | FLOW events шаг 3: ротация вне транзакции                                                                                                                                               | LOW         |
| L5  | FINDINGS#1 fix: путь каталога уже печатается                                                                                                                                            | LOW         |
| L6  | FINDINGS#12: пропущена 4-я неточность CLAUDE.md («committed manifest.json»)                                                                                                             | LOW         |
| L7  | `anki`/`core`/`k-backend`: «по умолчанию 8777» без оговорки о 8765 у старых/импортированных профилей и о `confServer`                                                                   | LOW         |
| L8  | Нет ребра `popup → core` (файлы клипов по прямому URL)                                                                                                                                  | LOW         |
| L9  | IMPORT шаг 4: «2026.08.29» — пример, не факт кода                                                                                                                                       | LOW         |

Итого: CRIT 0, HIGH 0, MED 1, LOW 9. Все пять несущих утверждений подтверждены дословно;
74 сверенные ссылки `файл:строка` — без единого расхождения.
