# Рецензия: команды учебника docs/system-design.html

Дата проверки: 2026-10-05 (~18:00 +05), хост xxxvita-pc, репозиторий `/home/xxxvita/Work/yomitan_phrases/src` (HEAD 23cd7c27).
Режим: только чтение. Учебник и код не правились; записан только этот отчёт.

Метод. Данные страницы извлечены из `<script>` (строки 224–1173) через `node` + `new Function` — строки команд
ровно те, что видит браузер: 48 команд `C`, RUNBOOK (7 этапов), IMPORT (7 шагов), SYMPTOMS (19 строк), поле
`cmds` и `start` у элементов `N`. Флаги сверены с `package.json`, `dev/bin/build.js`, `dev/build-libs.js`,
`dev/manifest-util.js`, `dev/data/manifest-variants.json`, `scripts/build-all.sh`, `dev/bin/build-dictionaries.js`,
`dev/bin/check-dictionary-parity.js`, `dev/dictionary-pair/{sources,pair-builder,pair-verify}.js`,
`test/playwright/global.{setup,teardown}.js`, `playwright.config.js`, а для Go — с
`~/Work/English/services/anki_conf/cmd/lexicon-dict-enrich/{main,export,source}.go` и
`internal/modules/yomitan/base_unpack.go`.

Выполнены дословно (read-only): c-ext-path, c-manifest, c-build-all-help, c-dict-procs, c-snapshots, c-journal-counts,
c-author-counts, c-dict-counts (sqlite3 -readonly), c-pick-pair, c-pair-json, c-pair-rev, c-pair-sha, c-pair-fresh,
c-pair-lists, c-sample-ru, c-fuser, c-core-port, c-anki-version, c-ankiconnect-version, c-idb-size, c-worktree,
c-test-dictpair. НЕ запускались: npm run build\*, build:dictionaries (в т.ч. --verify), npm test / test:fast /
test:unit, playwright, c-go-export, c-parity, c-swap, c-npm-ci. Процесс core (pid 2386619) не трогался; секреты не
выводились; `pkill`/`pgrep -f` не использовались. Поведение `git worktree add` на занятой ветке проверено на
игрушечном репозитории в scratchpad.

**Load-bearing утверждение** «каждая команда страницы безопасна для не-админа в написанном виде, и описание того,
что она пишет/меняет, полное» — **ЛОЖНО**. Части, которые выполняются: sudo нигде нет; `pkill -f`/`pgrep -f` с голым
шаблоном нигде нет (только `pgrep -x`); `.stamp` не трогается ни одной командой; c-build, c-build-all, IFNOT-ы и
симптомы везде дают `--version 0.3.1.0`. Нарушения — CMD-01…CMD-03 ниже.

Итого: **CRIT 3, HIGH 4, MED 9, LOW 8.**

---

## CRIT

### CMD-01 — c-swap: без `dict_base.db.new` команда оставляет приложение без словаря и затирает сегодняшний резерв; IFNOT утверждает «ничего не произошло»

- **Поле:** `cmd`, `ifnot`, `writes` команды c-swap (карточка dictbase).
- **Цитата:** `cd ~/.config/anki-connect-desktop/data/yomitan && test -z "$(fuser dict_base.db 2>/dev/null)" && mv dict_base.db dict_base.db.bak-$(date +%Y%m%d) && mv dict_base.db.new dict_base.db`; IFNOT: «Ничего не произошло и код 1 — файл занят (приложение открыто) или нет .new».
- **На самом деле:**
  1. Наличие `.new` нигде не проверяется. Первый `mv` выполняется ДО второго: если `.new` нет, `dict_base.db` уже переименован в `.bak-…`, второй `mv` падает (код 1), и в каталоге **не остаётся `dict_base.db`**. «Ничего не произошло» — неверно.
  2. Что дальше сделает приложение: `base_unpack.go:42-45` — если `dbPath` отсутствует, `EnsureBaseDB` распаковывает поставляемый gz заново (`decompressGz` → rename → новый `.stamp`). То есть при следующем запуске core молча поставит стоковую базу вместо выгрузки с 786 одобренными статьями.
  3. `mv` без `-n` молча перезаписывает цель. Сейчас в каталоге уже есть `dict_base.db.bak-20261005` (1 594 712 064 байт, mtime сен 19 — единственная копия базы ДО замены, `ls -la` выше). Любой запуск c-swap сегодня (2026-10-05) перезапишет этот резерв текущей базой. На момент проверки `dict_base.db.new` в каталоге нет — то есть сегодняшний запуск по рецепту даёт ровно сценарий 1+3: резерв затёрт, словаря нет.
  4. `test -z "$(fuser … 2>/dev/null)"`: если `fuser` не установлен (пакет psmisc), подстановка пуста, проверка «файл свободен» проходит и `mv` выполняется под работающим приложением. Здесь fuser есть (`/usr/bin/fuser`, psmisc 23.7-2), но на другой машине защита молча исчезает.
- `.stamp` команда не трогает — это верно и важно (`base_unpack.go:39-45`: stamp описывает gz, поэтому сохранённый stamp и делает подложенный файл «актуальным»; удаление stamp заставило бы core перераспаковать gz поверх). Стоит написать это «почему» в params.
- **Серьёзность:** CRIT (команда разрушительна в описанном «безопасном» сценарии, описание последствий ложно).
- **Исправление:**
  ```
  cd ~/.config/anki-connect-desktop/data/yomitan && command -v fuser >/dev/null && test -f dict_base.db.new && B=dict_base.db.bak-$(date +%Y%m%d-%H%M%S) && test ! -e "$B" && test -z "$(fuser dict_base.db dict_base.db.new 2>/dev/null)" && mv -n dict_base.db "$B" && mv -n dict_base.db.new dict_base.db; echo "exit $?"
  ```
  params: «`command -v fuser` — без fuser проверка занятости невозможна; `test -f …new` — без нового файла ничего не трогать; имя резерва с временем + `test ! -e` + `mv -n` — никогда не перезаписывать старый резерв; `.stamp` не трогать: он описывает поставляемый gz, по нему core решает НЕ распаковывать базу заново». IFNOT: «exit 1 и dict_base.db на месте — файл занят, нет .new или нет fuser. Если после ошибки dict_base.db исчез — вернуть: `mv -n "$B" dict_base.db` ДО запуска приложения, иначе core распакует стоковую базу».

### CMD-02 — Карточка «Исходники и сборка» (src.start) учит голому `npm run build`, не говоря, что он ставит ext/manifest.json версию 0.0.0.0

- **Поле:** `start` элемента `src` (строка 365 HTML), также `simple` того же элемента.
- **Цитата:** «npm ci — один раз после checkout. npm run build — собрать все варианты (chrome, …, edge) в builds/.»
- **На самом деле:** `build.js:249-252` — `version` по умолчанию `'0.0.0.0'`; `build.js:282-289` — в `finally` ext/manifest.json перезаписывается из варианта base с этой версией. Загруженное из ext/ расширение после Reload покажет 0.0.0.0. Сама же страница это знает (c-build params, SYMPTOMS «Версия … стала 0.0.0.0», FINDINGS), но именно в карточке-«как запустить» команда дана без флага и без предупреждения, а описание «в builds/» неполное — пишется и ext/manifest.json, и ext/lib.
- **Серьёзность:** CRIT по правилу load-bearing (описание записи неполное, команда в написанном виде меняет живое расширение). Практический ущерб обратим: повторная сборка с `--version`.
- **Исправление:** «npm ci — один раз после checkout. Собрать все варианты: `npm run build -- --all --version 0.3.1.0` (без `--version` ext/manifest.json получит 0.0.0.0). Пишет builds/\*.zip, ext/manifest.json и ext/lib».

### CMD-03 — c-test-full помечена «только чтение» и утверждает «test:build … ничего не пишет», но перезаписывает ext/lib

- **Поле:** `safe: "read"`, `params`, `writes` команды c-test-full; тот же тезис в params c-build («--dryRun — ничего не писать»).
- **Цитата:** «npm test :: цепочка … test:build = build.js --dryRun --all (ничего не пишет)»; «WRITES: Ничего значимого».
- **На самом деле:** `build.js:272-273` — `await buildLibs()` вызывается безусловно, ДО проверки `dryRun`; `dev/build-libs.js:55, 95, 97` пишут `ext/lib/*.js`, `ext/lib/validate-schemas.js`, `ext/lib/resvg.wasm`. Флаг `--dryRun` отключает только zip и manifest (`build.js:190, 206, 287`). ext/lib — каталог, который Chrome грузит вживую. Обычно результат побайтно тот же (собирается из node_modules), поэтому вред мал, но «только чтение» неверно.
- **Серьёзность:** CRIT по правилу load-bearing («команда, описанная как read-only, не должна писать»); по фактическому ущербу — MED.
- **Исправление:** c-test-full: `safe: "change"`, writes «ext/lib/\* пересобирается из node_modules (buildLibs выполняется и при --dryRun, build.js:273); кэш vitest». В params c-build: «--dryRun — не писать zip и manifest (ext/lib всё равно пересобирается)».

---

## HIGH

### CMD-04 — c-test-fast IFNOT: `git worktree add /tmp/flib-clean main` всегда падает

- **Поле:** `ifnot` c-test-fast.
- **Цитата:** «Запускать в чистой копии: git worktree add /tmp/flib-clean main && cd /tmp/flib-clean && npm ci && npm run test:fast.»
- **На самом деле:** ветка main уже выписана в основной копии (`git worktree list` → `…/src 23cd7c27 [main]`). git отказывается выписать ту же ветку второй раз. Проверено на игрушечном репозитории (git 2.54.0): `fatal: 'main' is already used by worktree at '…/r'`, код 128; `&&` обрывает цепочку, тесты не запускаются.
- **Серьёзность:** HIGH (команда не делает того, что описано).
- **Исправление:** `git -C /home/xxxvita/Work/yomitan_phrases/src worktree add --detach /tmp/flib-clean main && cd /tmp/flib-clean && npm ci && npm run test:fast` и в конце «убрать: `git -C /home/xxxvita/Work/yomitan_phrases/src worktree remove /tmp/flib-clean`». Добавить: копия лежит в /tmp = tmpfs (ОЗУ), node_modules ≈ сотни МБ. Учесть, что `npm ci` в новой копии выполнит `prepare: husky`, а husky меняет `core.hooksPath` в ОБЩЕМ `.git/config`.

### CMD-05 — c-playwright: повторный запуск после прерванного прогона затирает настоящий манифест; это не сказано

- **Поле:** `writes`, `ifnot` c-playwright.
- **Цитата:** «Временно ПЕРЕИМЕНОВЫВАЕТ ext/manifest.json → ext/manifest-old.json … Если прогон прервался: mv ext/manifest-old.json ext/manifest.json.»
- **На самом деле:** `global.setup.js:30` — `fs.renameSync(manifestPath, copyManifestPath)` без проверки, что `manifest-old.json` уже есть. После прерванного прогона ext/manifest.json = тестовый (вариант chrome-playwright, версия 0.0.0.0, `global.setup.js:31`), ext/manifest-old.json = настоящий. Если запустить playwright снова, не выполнив `mv`, setup переименует ТЕСТОВЫЙ манифест поверх `manifest-old.json` — настоящий потерян, teardown (`global.teardown.js:27`) вернёт тестовый. Восстановить можно только сборкой `npm run build -- --all --version 0.3.1.0`.
  Плюс: в `playwright.config.js:50` репортёр `html` вне CI; при упавших тестах (а visual-тесты, по самой странице, упадут) он поднимает сервер отчёта и ждёт Ctrl+C — команда «не возвращается».
- **Серьёзность:** HIGH (неполное описание изменений; неверное ожидание завершения).
- **Исправление:** writes: «…Если прерванный прогон не починить и запустить снова — настоящий манифест будет потерян». IFNOT: «Прогон прервался — ДО любого повторного запуска: `test -f ext/manifest-old.json && mv ext/manifest-old.json ext/manifest.json`. Если уже потерян — `npm run build -- --all --version 0.3.1.0`». cmd: `npx playwright test --reporter=list`, либо в expect «при падениях открывается HTML-отчёт и команда ждёт Ctrl+C».

### CMD-06 — c-build: прерывание Ctrl+C оставляет в ext/ манифест чужого варианта

- **Поле:** `writes`, `ifnot` c-build (и c-build-all).
- **Цитата:** «ext/manifest.json (перезаписывается из варианта base, build.js:283-288)».
- **На самом деле:** во время сборки ext/manifest.json перезаписывается манифестом КАЖДОГО варианта по очереди (`build.js:190-191`: chrome, chrome-dev, chrome-playwright, firefox, …). Восстановление base стоит в `finally` (`build.js:282-289`), но по SIGINT/SIGTERM Node завершается без выполнения `finally`. Прерванная сборка оставит, например, манифест firefox — после Reload расширение в Chrome сломается. Это не сказано ни в c-build, ни в симптомах.
- **Серьёзность:** HIGH (неполное описание того, что меняется; реальный путь к сломанному расширению).
- **Исправление:** writes: «…во время сборки ext/manifest.json по очереди становится манифестом каждого варианта; прерванная (Ctrl+C) сборка оставит чужой манифест — запусти сборку заново до конца». В SYMPTOMS добавить строку «После прерванной сборки/playwright расширение не грузится или версия 0.0.0.0 → повторить `npm run build -- --all --version 0.3.1.0`».

### CMD-07 — RUNBOOK (б) «Собрать пару (только если журнал изменился)» стоит ДО проверки, изменился ли журнал

- **Поле:** RUNBOOK, этапы (б) и (в).
- **Цитата:** этап (б) «Собрать пару (только если журнал изменился)»: c-dict-procs, c-snapshots, c-journal-counts, c-dict-counts, c-build-dict; c-pair-fresh — в этапе (в).
- **На самом деле:** единственная команда, отвечающая на вопрос «изменился ли журнал», — c-pair-fresh — стоит в следующем этапе. Читатель, идущий по порядку, либо собирает пару без нужды (4.8 ГБ ОЗУ), либо пропускает этап наугад. Кроме того, повторная сборка при неизменных данных («up-to-date») ПЕРЕПИСЫВАЕТ build.json (`pair-builder.js:466-470`), включая `finishedAt` и `sources.*` — после этапа (б) ожидания этапа (в) («finishedAt 2026-10-05T04:19:16.606Z» в c-pick-pair/c-pair-json) уже не совпадут, и читатель решит, что что-то сломалось.
- **Серьёзность:** HIGH (порядок шагов не соответствует плану применения).
- **Исправление:** первым шагом этапа (б) поставить c-pair-fresh: «строки совпали — этап (б) пропусти». В expect c-build-dict дописать: «даже при "up-to-date" build.json и два списка перезаписываются: finishedAt и sources станут текущими». В expect c-pick-pair/c-pair-json — «finishedAt — время последней сборки (на 2026-10-05 …)».

---

## MED

### CMD-08 — c-pair-sha: суммы печатаются в разном порядке, построчное сравнение «не совпадает»

- **Цитата:** `sha256sum …/*.zip; jq -r '.host.sha256, .translation.sha256' …`
- **Выполнено:** sha256sum печатает по алфавиту — `8eec…b604 flibooster-en-ru.zip`, затем `f693…80f7 wty-en-en.zip`; jq — сначала host (`f693…`), потом translation (`8eec…`). Первая строка первого блока ≠ первой строке второго. Новичок, сравнивающий «строка к строке», увидит расхождение. (Время: 0.19 с на прогретом кэше, а не «несколько секунд» — мелочь.)
- **Исправление:** `cd …/2125428-2008035-f45589d9b800 && jq -r '"\(.host.sha256)  wty-en-en.zip\n\(.translation.sha256)  flibooster-en-ru.zip"' build.json | sha256sum -c` → expect `wty-en-en.zip: OK`, `flibooster-en-ru.zip: OK`; ifnot `FAILED`.

### CMD-09 — c-build-all: список записей неполный

- **Цитата:** «WRITES: builds/\*.zip, builds/unpacked/yomitan-<вариант>/, ext/manifest.json.»
- **На самом деле:** ещё `ext/lib/*` (buildLibs, см. CMD-03); при отсутствии node_modules скрипт сам запускает `npm ci` (`build-all.sh:72-75`) → node_modules + husky `core.hooksPath`. Встроенная справка скрипта («Writes only inside the repo's builds/», строка 20) ложна, и c-build-all-help показывает её читателю без оговорки.
- **Исправление:** writes «…, ext/manifest.json, ext/lib/\*; если нет node_modules — сначала npm ci». В expect c-build-all-help: «Строка “Writes only inside the repo's builds/” неверна: пишутся и ext/manifest.json, ext/lib».

### CMD-10 — c-build-all expect: порядок «список путей, Done.» перепутан

- **На самом деле:** `build-all.sh:143-152` — сначала `Done.`, потом `Load-unpacked paths:` и список; перед ними строки `==> Unpacking zips into …/` и `  - chrome: …`.
- **Исправление:** «…«==> Unpacking zips into …/builds/unpacked/», «Done.», затем «Load-unpacked paths:» с пятью путями (chrome, chrome-dev, edge, firefox, firefox-dev), код 0».

### CMD-11 — c-go-export: записи вне $T и объём в ОЗУ не указаны

- **Цитата:** «WRITES: $T/ (исходники, бинарник, reference.db ~1.8 ГБ).»
- **На самом деле:** `mktemp -d` создаёт папку в /tmp, а /tmp — tmpfs (`findmnt` → `tmpfs 15,2G`): reference.db — копия dict_base.db (1 595 400 192 байт, `export.go:456-459` copyFile) — живёт в ОЗУ до `rm -rf "$T"`. `go build` пишет модульный кэш (`~/go/pkg/mod`, при первой сборке — загрузка из сети) и `~/.cache/go-build`. Команда оставляет оболочку внутри `$T/cmd/lexicon-dict-enrich`. Флаги `-export`, `-export-revision`, `-dict`, `-work` подтверждены (`main.go:28,32,52,53`); журнал открывается `?mode=ro` (`export.go:367`), словарь — `mode=ro&immutable=1` (`source.go:60`) — описание верно; формат строки ожидания совпадает с `main.go:150-153`.
- **Исправление:** writes «…$T в /tmp (tmpfs, то есть ~1.6 ГБ ОЗУ до удаления); кэш Go в ~/go/pkg/mod и ~/.cache/go-build». IFNOT убрать «код anki_conf не перечитывался» — флаги сверены.

### CMD-12 — c-parity: помечена read, но пишет и удаляет в /tmp; запуск без увеличенной кучи

- **На самом деле:** `check-dictionary-parity.js:46` → `openDatabaseSnapshot` → `sweepStaleSnapshots()` (удаляет чужие снимки с мёртвым pid, `sources.js:115,192`) + VACUUM INTO ~167 МБ в tmpfs. Скрипт `check:dictionary-parity` запускается без `--max-old-space-size` (package.json), хотя строит те же 162 тыс. русских строк, что и сборщик (которому нужно 8 ГБ кучи); риск OOM не проверен. Также `$T` существует только в той оболочке, где выполнялся c-go-export — в новом терминале `--reference "/reference.db"`.
- **Исправление:** `safe: "change"` или writes «снимок журнала в /tmp (удаляется) и чистка чужих мёртвых снимков»; params `$T`: «та же оболочка, что и в c-go-export; иначе подставь путь вручную»; пометка «память не замерялась; при `JavaScript heap out of memory` — `node --max-old-space-size=8192 dev/bin/check-dictionary-parity.js …`».

### CMD-13 — c-manifest / SYMPTOMS «Версия 0.0.0.0»: названа только одна причина

- **Цитата:** «Версия 0.0.0.0 — кто-то запускал npm run build без --version»; SYMPTOMS: «Кто-то запустил npm run build без --version».
- **На самом деле:** то же даёт прерванный playwright (`global.setup.js:31` пишет тестовый манифест с `0.0.0.0`) и прерванная сборка (CMD-06). Читатель будет искать не там.
- **Исправление:** «…или прерванный `npx playwright test` (в ext/ лежит ext/manifest-old.json — верни его `mv`) или прерванная сборка».

### CMD-14 — c-build expect/params: список вариантов неполон (safari)

- **На самом деле:** `manifest-variants.json` — у safari `buildable` не `false`, поэтому `--all` его перебирает и печатает `Building safari...` (fileName нет — файл не пишется, `build.js:180-188`). Также в карточке src.start тот же список из 7.
- **Исправление:** «…и safari (только строка в выводе, файла нет)».

### CMD-15 — c-snapshots / c-dict-procs: проверка «сборка не идёт» ловит не всё

- **Цитата:** IFNOT c-snapshots «Есть каталоги и сборка точно не идёт (команда выше пуста) — можно удалить: rm -rf …».
- **На самом деле:** `pgrep -x node` пуст и тогда, когда сборка/паритет запущены в ДРУГОЙ временной папке (другой `TMPDIR`) — тогда снимок не виден вовсе, это безопасно; но и наоборот: любой посторонний node (IDE, language-server) даст непустой вывод — ложное «идёт сборка». Плюс точнее проверять сам pid: в каждом снимке лежит `owner.pid` (`sources.js:121`).
- **Исправление:** вместо «команда выше пуста» дать проверку по pid: `for d in "${TMPDIR:-/tmp}"/flib-dict-snapshot-*/; do p=$(cat "$d/owner.pid"); kill -0 "$p" 2>/dev/null && echo "живой $p: $d" || echo "мёртвый $p: $d"; done` и удалять только «мёртвые» (это же правило применяет сборщик). В c-dict-procs expect: «строки посторонних node (редактор и т.п.) — не сборка; смотри командную строку».

### CMD-16 — c-test-unit-excl, c-test-unit, c-test-fast, c-test-full: не перепроверены, но одна оговорка про eslint верна

- Не запускались (по условиям). Подтверждено по коду: `vitest --help` содержит `--exclude <glob> Additional file globs to be excluded` (флаг добавляет, а не заменяет `vitest.config.js` exclude); `eslint.config.js:73` не исключает `.claude/`; `test:fast` = `test:js && test:ts && test:unit && test:json:format` — совпадает. Отдельной ошибки нет; учтено только CMD-03/04.

---

## LOW

- **CMD-17 c-npm-ci writes:** кроме node*modules, `npm ci` выполняет `prepare: husky` → `.husky/*`и`git config core.hooksPath .husky/\_` (сейчас установлено). Дописать.
- **CMD-18 c-manifest IFNOT:** на свежем checkout перед `npm run build` нужен `npm ci` (buildLibs берёт файлы из node_modules). Дописать «сначала npm ci».
- **CMD-19 c-dict-counts:** «Около секунды» — измерено 2.7 с (холодный кэш), страница сама пишет 1.2 с. Писать «1–3 с».
- **CMD-20 c-verify expect:** вывод — JSON с отступами в 2 пробела на ~15 строк (`build-dictionaries.js:47`), а не одна строка; значения совпадают с `artifactVerification` в build.json (проверено). Ссылка `pair-verify.js:171-175` верна.
- **CMD-21 c-journal-counts:** sqlite3 CLI по умолчанию не ждёт блокировку; предложить `sqlite3 -readonly -cmd '.timeout 5000' …` вместо «повтори через пару секунд». Журнал в режиме `delete` (rollback) — проверено `pragma journal_mode`.
- **CMD-22 c-dict-procs params:** «шаблон -f … находит заодно твою же оболочку» — pgrep исключает сам себя; оболочку он находит, только когда команда запущена через обёртку (`bash -c '…'`, ssh, агент), чья командная строка содержит шаблон. Уточнить.
- **CMD-23 c-fuser expect:** при нескольких PID fuser печатает их через пробелы с ведущими пробелами — конвейер `tr | sed` это обрабатывает (проверено: `fuser … 2>/dev/null | od -c` → `  2386619`). Для пустого случая ps выводит `error: list of process IDs must follow -p` (rc 1) — IFNOT это допускает; можно процитировать дословно.
- **CMD-24 c-playwright:** не сказано, что нужен браузер Playwright (`npx playwright install chromium`); здесь он есть (`~/.cache/ms-playwright/chromium-1228`).

---

## Проверка выполнением (дословно по полю `cmd`)

| Команда               | Результат                                                                                                                                                                         | Совпадает                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| c-ext-path            | `/home/xxxvita/Work/yomitan_phrases/src/ext`                                                                                                                                      | да                                         |
| c-manifest            | `Flib-club 0.3.1.0`                                                                                                                                                               | да                                         |
| c-build-all-help      | текст строк 2–24, rc=0                                                                                                                                                            | да (но см. CMD-09 о ложной строке справки) |
| c-dict-procs          | пусто, rc=1 / пусто, rc=1                                                                                                                                                         | да                                         |
| c-snapshots           | `снимков нет` (TMPDIR не задан)                                                                                                                                                   | да                                         |
| c-journal-counts      | `394714\|394717`, `done\|390484`, `failed\|4230`, meta 5 строк — дословно                                                                                                         | да                                         |
| c-author-counts       | `done\|manual\|98`, `done\|ok\|786`, `failed\|\|309`, `failed\|fix\|15`, `failed\|reject\|33`                                                                                     | да                                         |
| c-dict-counts         | `flibooster-en\|874`, `flibooster-en-ru\|44530`, `wty-en-en\|1962075`; ревизии — дословно; 2.7 с                                                                                  | да (время — LOW)                           |
| c-pick-pair           | две строки — дословно                                                                                                                                                             | да                                         |
| c-pair-json           | revision/en/ru/stale 336/untranslated 419/guardsFailed []/finishedAt — дословно                                                                                                   | да                                         |
| c-pair-rev            | две строки `2125428-2008035-f45589d9b800`                                                                                                                                         | да                                         |
| c-pair-sha            | суммы совпадают с build.json, но в обратном порядке строк                                                                                                                         | частично (CMD-08)                          |
| c-pair-fresh          | обе строки `168841216 2026-10-05T04:17:15.526Z`                                                                                                                                   | да                                         |
| c-pair-lists          | `336 / 419 / 755 total`                                                                                                                                                           | да                                         |
| c-sample-ru           | `["house","n",8376]`, `["house","n",8377]`, `["house","v",8378]`; глосса 8376 начинается «Строение, построенное как жилище человека или служащее им.»; house только в term_bank_7 | да                                         |
| c-fuser               | `…dict_base.db: 2386619`; ps → `core /home/xxxvita/Work/English/services/anki_conf/bin/core`                                                                                      | да                                         |
| c-core-port           | `127.0.0.1:8765 … ("anki",pid=4133794)`, `*:8777 … ("core",pid=2386619)`                                                                                                          | да                                         |
| c-anki-version        | `{"result": 6, "error": null}`                                                                                                                                                    | да                                         |
| c-ankiconnect-version | `{"result": 6, "error": null}`                                                                                                                                                    | да                                         |
| c-idb-size            | `1017M`                                                                                                                                                                           | да                                         |
| c-worktree            | две строки, main + feat-russian-translation-column                                                                                                                                | да                                         |
| c-test-dictpair       | Test Files 5 passed (5), Tests 87 passed (87), 1.16 с                                                                                                                             | да                                         |

UI-команды (u-\*): подписи сверены с HTML — «Configure installed and enabled dictionaries…» (settings.html:302),
«Import Dictionaries», «Drag and drop dictionaries (.zip) / or click here to upload» (templates-modals.html:78,83-84),
`multiple` (templates-modals.html:58), «Import»/«Delete All»/«Check for Updates» (:69-72), «Confirm Dictionary Deletion»
(:102), меню Details…/Rename…/Move to…/Delete (templates-settings.html:104-109), «rev.» (dictionary-controller.js:92),
«is already imported, skipped it.» (dictionary-importer.js:120), Result Display / Result grouping mode / Group
term-reading pairs (settings.html:1164,1170,1185), «Connected» (anki-controller.js:499), resultOutputMode group в
посеве (ext/data/provisioning/default-options.json:12). Расхождений не найдено.

---

## Сводная таблица

| №         | Команда / место                  | Уровень                          | Суть                                                                                                                                                             |
| --------- | -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CMD-01    | c-swap                           | **CRIT**                         | без .new удаляет dict_base.db (core распакует стоковую базу), затирает существующий bak-20261005; без fuser проверка проходит; IFNOT «ничего не произошло» ложен |
| CMD-02    | src.start (карточка)             | **CRIT**                         | голый `npm run build` → ext/manifest.json 0.0.0.0, не сказано                                                                                                    |
| CMD-03    | c-test-full (+ c-build --dryRun) | **CRIT** (по правилу; ущерб MED) | «только чтение / --dryRun ничего не пишет», но buildLibs пишет ext/lib                                                                                           |
| CMD-04    | c-test-fast IFNOT                | HIGH                             | `git worktree add … main` → fatal, ветка занята; нужен `--detach`                                                                                                |
| CMD-05    | c-playwright                     | HIGH                             | повторный запуск после прерывания затирает настоящий манифест; html-репортёр не даёт команде завершиться                                                         |
| CMD-06    | c-build / c-build-all            | HIGH                             | Ctrl+C оставляет в ext/ манифест чужого варианта (finally не выполняется)                                                                                        |
| CMD-07    | RUNBOOK (б)/(в)                  | HIGH                             | проверка свежести после этапа сборки; up-to-date переписывает build.json и ломает ожидания (в)                                                                   |
| CMD-08    | c-pair-sha                       | MED                              | обратный порядок сумм; заменить на `sha256sum -c`                                                                                                                |
| CMD-09    | c-build-all / -help              | MED                              | не указаны ext/lib и авто-npm ci; справка скрипта ложна                                                                                                          |
| CMD-10    | c-build-all expect               | MED                              | порядок «Done.» и списка путей                                                                                                                                   |
| CMD-11    | c-go-export                      | MED                              | 1.6 ГБ в tmpfs (ОЗУ), кэш Go вне $T                                                                                                                              |
| CMD-12    | c-parity                         | MED                              | «read», но пишет/чистит /tmp; нет увеличенной кучи; $T из другой оболочки                                                                                        |
| CMD-13    | c-manifest, SYMPTOMS             | MED                              | 0.0.0.0 — ещё и от playwright/прерванной сборки                                                                                                                  |
| CMD-14    | c-build, src.start               | MED                              | safari тоже перебирается                                                                                                                                         |
| CMD-15    | c-snapshots, c-dict-procs        | MED                              | проверять owner.pid, а не «нет node»                                                                                                                             |
| CMD-16    | тесты                            | —                                | не запускались; флаги подтверждены                                                                                                                               |
| CMD-17…24 | разные                           | LOW                              | husky в npm ci; npm ci перед build; время; формат JSON; .timeout; pgrep -f; fuser; браузер playwright                                                            |

---

# Повторная проверка

Дата: 2026-10-05 ~18:40 (+05). Режим тот же: только чтение. Учебник и код не правились; дописан только этот раздел.
Данные страницы заново извлечены из `<script>` (строки 232–1855) через `node` + `new Function`: **66 команд** (было 48),
RUNBOOK 8 этапов, IMPORT 8 шагов, SYMPTOMS 22 строки, 116 полей `start` у элементов (включая новые карточки C4
и unit-участки). Висячих ссылок `cmds` → C нет.

Выполнено дословно (read-only): c-ext-path, c-manifest, c-build-all-help, c-dict-procs, c-snapshots (новый цикл),
c-journal-counts и c-author-counts (с `-cmd '.timeout 5000'`), c-dict-counts, c-pick-pair, c-pair-json, c-pair-rev,
c-pair-sha (новый `sha256sum -c`), c-pair-fresh, c-pair-lists, c-sample-ru, c-fuser, c-core-port, c-anki-version,
c-ankiconnect-version, c-idb-size, c-worktree, **новые:** c-anki-installed, c-hf-entry, c-mecab-off, c-gateway-grep,
c-storage-dir, c-test-dictpair, c-test-trans, c-test-events, c-test-flibhost, c-test-options, c-test-popup,
c-test-database, c-test-translator, c-test-unit-excl. Не запускались (по условиям): сборки, build:dictionaries,
npm test/test:fast/test:unit, playwright, c-go-export, c-parity, c-core-start, c-npm-ci; c-swap — только на
пустых файлах в scratchpad. Процесс core не трогался.

## 1. Статус замечаний CMD-01…24

| №                         | Было | Статус      | Доказательство                                                                                                                                                                                        |
| ------------------------- | ---- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CMD-01 c-swap             | CRIT | **ЗАКРЫТО** | Новый cmd прогнан на пустых файлах в scratchpad во всех состояниях (таблица ниже): ни в одном dict_base-файл не потерян и не перезаписан. Остаток — LOW (R-05).                                       |
| CMD-02 src.start          | CRIT | ЗАКРЫТО     | «Сборка всех вариантов: npm run build -- --all --version 0.3.1.0. Без --version … 0.0.0.0»; записи ext/manifest.json и ext/lib названы. **Но тот же класс ошибки появился в другой карточке — R-01.** |
| CMD-03 c-test-full        | CRIT | ЗАКРЫТО     | `safe: change`, writes «ext/lib/\* — пересобирается … даже в --dryRun (build.js:273)»; в c-build: «--dryRun — не писать zip и манифест (ext/lib всё равно пересобирается)».                           |
| CMD-04 worktree           | HIGH | ЗАКРЫТО     | `git -C … worktree add --detach /tmp/flib-clean main`; добавлены «убрать после: worktree remove --force», tmpfs и husky. `--detach` на занятой ветке проверен ранее (rc=0).                           |
| CMD-05 playwright         | HIGH | ЗАКРЫТО     | `--reporter=list`; writes «…настоящий манифест будет ПОТЕРЯН»; IFNOT `test -f ext/manifest-old.json && mv …` ДО повторного запуска; браузер Playwright упомянут.                                      |
| CMD-06 Ctrl+C сборки      | HIGH | ЗАКРЫТО     | c-build/c-build-all writes и IFNOT; новый симптом «Расширение не грузится или версия 0.0.0.0 после сборки или тестов» (build.js:190-191).                                                             |
| CMD-07 RUNBOOK            | HIGH | ЗАКРЫТО     | Этап (б) = только c-pair-fresh («строки совпали — этап (в) пропусти»); (в) сборка; (г) «после сборки время finishedAt станет новым — это нормально»; новый симптом про up-to-date.                    |
| CMD-08 sha                | MED  | ЗАКРЫТО     | Выполнено: `wty-en-en.zip: OK`, `flibooster-en-ru.zip: OK`, rc=0.                                                                                                                                     |
| CMD-09 build-all writes   | MED  | ЗАКРЫТО     | writes «…ext/lib/\*; если нет node_modules — сначала сам выполнит npm ci»; expect c-build-all-help предупреждает о ложной строке справки.                                                             |
| CMD-10 порядок Done       | MED  | ЗАКРЫТО     | Expect совпадает с build-all.sh:127-152.                                                                                                                                                              |
| CMD-11 go-export          | MED  | ЗАКРЫТО     | Записи вне $T, tmpfs, подоболочка `( … )` (текущая папка не меняется), `echo "T=$T"`.                                                                                                                 |
| CMD-12 parity             | MED  | ЗАКРЫТО     | `safe: change`, writes про копию и чистку, пояснение $T, пометка о памяти.                                                                                                                            |
| CMD-13 0.0.0.0            | MED  | ЗАКРЫТО     | c-manifest IFNOT — три причины; симптом переписан.                                                                                                                                                    |
| CMD-14 safari             | MED  | ЗАКРЫТО     | c-build params/expect, src.start.                                                                                                                                                                     |
| CMD-15 снимки             | MED  | ЗАКРЫТО     | Цикл по owner.pid + `kill -0`; выполнено: «снимков нет». При ненайденном шаблоне `[ -d "$d" ]` ложно → печать и break — верно.                                                                        |
| CMD-16 тесты              | —    | ПРОВЕРЕНО   | c-test-unit-excl выполнено: `Test Files 66 passed (66)`, `Tests 4385 passed \| 46 skipped (4431)`, 12.4 с — совпадает.                                                                                |
| CMD-17 husky              | LOW  | ЗАКРЫТО     | c-npm-ci writes.                                                                                                                                                                                      |
| CMD-18 npm ci перед build | LOW  | ЗАКРЫТО     | c-manifest и u-load IFNOT.                                                                                                                                                                            |
| CMD-19 время              | LOW  | ЗАКРЫТО     | «1–3 секунды».                                                                                                                                                                                        |
| CMD-20 формат verify      | LOW  | ЗАКРЫТО     | «JSON с отступами (около 15 строк)».                                                                                                                                                                  |
| CMD-21 .timeout           | LOW  | ЗАКРЫТО     | `-cmd '.timeout 5000'`; выполнено, вывод дословно как в expect.                                                                                                                                       |
| CMD-22 pgrep -f           | LOW  | ЗАКРЫТО     | Формулировка про обёртку.                                                                                                                                                                             |
| CMD-23 fuser пусто        | LOW  | ЗАКРЫТО     | IFNOT цитирует `error: list of process IDs must follow -p`.                                                                                                                                           |
| CMD-24 браузер playwright | LOW  | ЗАКРЫТО     | params «(до первого запуска)».                                                                                                                                                                        |

### c-swap: проверка на пустых файлах (scratchpad, GNU coreutils 9.11)

Команда — дословно поле `cmd` без начального `cd`; в каждом случае каталог заново: `dict_base.db=OLD`,
`dict_base.db.stamp`, `dict_base.db.bak-20261005=BAK`.

| Состояние                                                | Результат                                                                                                                                 | Файлы после                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| нет `.new`                                               | `exit 1`                                                                                                                                  | всё как было                                                                               |
| штатно (`.new`, никто не держит)                         | `exit 0`                                                                                                                                  | `dict_base.db=NEW`, `…bak-20261005-183947=OLD`, старый `bak-20261005=BAK` цел, stamp цел   |
| резерв с тем же именем до секунды уже есть               | `exit 1`                                                                                                                                  | всё как было (`test ! -e "$B"`)                                                            |
| нет fuser (PATH без него)                                | `exit 1`                                                                                                                                  | всё как было (`command -v fuser`)                                                          |
| старый файл открыт (`exec 3<dict_base.db` в подоболочке) | `exit 1`                                                                                                                                  | всё как было                                                                               |
| `.new` открыт                                            | `exit 1`                                                                                                                                  | всё как было                                                                               |
| старого нет, есть только `.new`                          | `mv: cannot stat 'dict_base.db'`, `exit 1`                                                                                                | `.new` на месте, ничего не создано                                                         |
| второй `mv` падает (подмена `mv`, отказ на `.new`)       | `exit 1`; `dict_base.db` отсутствует, OLD — в `$B`, NEW — в `.new`                                                                        | восстановление из IFNOT `mv -n "$B" dict_base.db` → rc=0, всё как было. Данные не потеряны |
| гонка: `dict_base.db` появился между двумя mv (подмена)  | **`exit 0`**, но `.new` не переставлен: `mv -n` при существующей цели молча пропускает с кодом 0 (проверено отдельно: `mv -n a b` → rc=0) | OLD в `$B`, NEW в `.new`, «RECREATED» в dict_base.db — ничего не перезаписано              |

Вывод: **ни в одном состоянии dict_base-файл не теряется и не перезаписывается** — требование выполнено, CRIT нет.
Остаток — R-05 (LOW): в последнем, практически недостижимом случае команда пишет «exit 0», хотя замена не сделана.

## 2. Повторный проход по всем 66 командам

Совпали с expect дословно (результат выполнения): c-ext-path, c-manifest, c-build-all-help, c-dict-procs (пусто,
rc=1 ×2), c-snapshots, c-journal-counts, c-author-counts, c-dict-counts, c-pick-pair, c-pair-json, c-pair-rev,
c-pair-sha, c-pair-fresh, c-pair-lists, c-sample-ru, c-fuser, c-core-port, c-anki-version, c-ankiconnect-version,
c-idb-size (1017M), c-worktree, c-anki-installed (`/usr/local/bin/anki`, `__init__.py`, `collection.anki2` 5 255 168 байт,
rc=0), c-hf-entry (адрес huggingface — дословно), c-mecab-off (`null`), c-gateway-grep (одна строка
`ext/js/data/options-util.js:1908: … {gatewayUrl: '', personalKey: ''}`, затем `exit 1`), c-storage-dir (`128K`),
c-test-dictpair (5/87), c-test-trans (3/43), c-test-events (4/69), c-test-flibhost (1/20), c-test-options (4/37),
c-test-popup (4/32), c-test-database (1/10), c-test-translator (1/49, 2.8 с, строки `addScopeToCssLegacy failed…` есть),
c-test-unit-excl (66/4385/46). `git status` после тестов не изменился.

Новые UI-команды: подписи сверены — «Unrecognized dictionary format» (dictionary-importer.js:383), «Your system is
running low on storage space. Importing dictionaries may fail.» (settings.html:333-334), имя базы `dict`
(dictionary-database.js:32), хранилище `events` в flib-events (flib-events-database.js:113-114), offscreen
в манифесте. Расхождений нет. c-core-start: Taskfile.yml:712-719 и `dev:main` = `tsc … && electron …` — описание верно.

### Новые замечания

#### R-01 — CRIT (по правилу load-bearing; практический ущерб HIGH): карточка «Браузер Chrome» (browserctx.start) учит голому `scripts/build-all.sh`

- **Цитата:** «Firefox (не проверено): собрать варианты (npm run build -- --all --version 0.3.1.0), распаковать (scripts/build-all.sh), затем about:debugging…»
- **На самом деле:** `scripts/build-all.sh` без аргументов — это (а) `npm run build` БЕЗ `--version` (build-all.sh:96-100) → ext/manifest.json получает 0.0.0.0, сводя на нет только что сделанную сборку с версией; (б) БЕЗ `--no-dictionaries` → `npm run build:dictionaries` (build-all.sh:102-108): ~4.8 ГБ ОЗУ, запись в builds/dictionaries, падение при отсутствии данных anki_conf. Ни то, ни другое в карточке не сказано, а слово «распаковать» подсказывает безобидную операцию. Отдельной распаковки build-all.sh не умеет — он всегда пересобирает всё.
- **Исправление:** «Firefox (не проверено): `cd /home/xxxvita/Work/yomitan_phrases/src && scripts/build-all.sh 0.3.1.0 --no-dictionaries` (соберёт все варианты с версией и распакует их в builds/unpacked/), затем about:debugging#/runtime/this-firefox → … builds/unpacked/yomitan-firefox-dev». Либо распаковать вручную: `unzip -q -o builds/yomitan-firefox-dev.zip -d builds/unpacked/yomitan-firefox-dev`.

#### R-02 — MED: c-core-start не защищён от второго экземпляра

- **Цитата:** IFNOT «Уже запущено — второй экземпляр не нужен; «address already in use» на 8777 — старый Core не закрылся (core-manager.ts:117)».
- **На самом деле:** сама команда ничего не проверяет. В anki_conf нет `requestSingleInstanceLock` (grep по electron/main — пусто), а `killStaleCore` работает только на Windows (core-manager.ts:408-409: `if (process.platform !== 'win32') return;`). Запуск при работающем приложении (сейчас так и есть: core pid 2386619) поднимет второй Electron и второй Core; «address already in use» в этом случае значит «приложение уже запущено», а не «старый Core не закрылся». Плюс `task electron:dev` пересобирает bin/core под работающим процессом.
- **Исправление:** cmd `ss -ltn | grep -q ':8777 ' && echo 'Core уже запущен — ничего не делаю' || (cd ~/Work/English/services/anki_conf && task electron:dev)`; IFNOT «address already in use — уже работает другой экземпляр приложения или зависший core: `ss -ltnp | grep 8777` покажет его pid; закрывает его владелец».

#### R-03 — MED: карточка «Anki + AnkiConnect» (anki.start): `task dev:all` описан как «ставит своё дополнение»

- **Цитата:** «anki_conf ставит своё дополнение командой task dev:all (integration/anki_addon/install.sh) — не проверено.»
- **На самом деле:** Taskfile.yml:697-710 — `dev:all` = install.sh + `go build -o ./bin/core` + `cd electron && npm run dev` (запуск второго экземпляра приложения, см. R-02). install.sh:14-16 делает `rm -rf ~/.local/share/Anki2/addons21/anki_voice_input` перед копированием, :82 — `pip install -r … --user` в пользовательский Python. Сейчас в папке дополнения нет meta.json (пользовательских настроек), поэтому потери данных нет, но «ставит дополнение» — неполное описание.
- **Исправление:** «Дополнение anki_conf ставит `cd ~/Work/English/services/anki_conf/integration/anki_addon && ./install.sh` (удаляет и заново копирует addons21/anki_voice_input, ставит зависимости через pip --user; Anki перезапустить). `task dev:all` делает то же И запускает приложение — не использовать, если оно уже открыто».

#### R-04 — LOW: c-test-\* params «имена … совпали бы и там»

Для c-test-dictpair неверно: в `.claude/worktrees/feat-russian-translation-column/test/` нет `dictionary-pair` (ls → No such file). Для остальных наборов верно (translation-pairing, display-translation, flib-host, options-util, database, dictionary-data, popup-size-registry, flib-events-database там есть). Флаг безвреден; поправить формулировку для dictionary-pair («на будущее»).

#### R-05 — LOW: c-swap expect «exit 0» не гарантирует, что замена сделана

GNU coreutils 9.11: `mv -n` при существующей цели пропускает и возвращает 0. Если `dict_base.db` появится между двумя `mv` (гонка с запуском приложения), команда напечатает `exit 0`, а `.new` останется на месте (данные целы — см. таблицу). Исправление: дописать в конец цепочки `&& test ! -e dict_base.db.new` перед `; echo "exit $?"`.

#### R-06 — LOW: c-gateway-grep `exit $?` отражает только второй grep

Код выхода — от последнего `grep -v`; появление новых строк `gatewayUrl` на него не влияет. В expect это учтено словами («Появились другие строки»), но стоит в params уточнить: «exit относится ко второй части».

## 3. Сводная таблица повторной проверки

| №         | Место                                                      | Уровень               | Статус / суть                                                                     |
| --------- | ---------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| CMD-01    | c-swap                                                     | CRIT →                | **закрыто**, проверено на 9 состояниях, потери данных нет                         |
| CMD-02    | src.start                                                  | CRIT →                | закрыто                                                                           |
| CMD-03    | c-test-full / --dryRun                                     | CRIT →                | закрыто                                                                           |
| CMD-04…07 | worktree, playwright, Ctrl+C, RUNBOOK                      | HIGH →                | закрыто                                                                           |
| CMD-08…15 | sha, build-all, go-export, parity, 0.0.0.0, safari, снимки | MED →                 | закрыто                                                                           |
| CMD-16    | тесты                                                      | —                     | выполнено, совпало                                                                |
| CMD-17…24 | разные                                                     | LOW →                 | закрыто                                                                           |
| **R-01**  | browserctx.start: голый `scripts/build-all.sh`             | **CRIT** (по правилу) | новое: 0.0.0.0 + сборка пары 4.8 ГБ, не сказано                                   |
| R-02      | c-core-start                                               | MED                   | новое: нет защиты от второго экземпляра; IFNOT неверно трактует «address in use»  |
| R-03      | anki.start `task dev:all`                                  | MED                   | новое: неполное описание (rm -rf папки дополнения, pip --user, запуск приложения) |
| R-04      | c-test-dictpair params                                     | LOW                   | для dictionary-pair дубля в worktree нет                                          |
| R-05      | c-swap expect                                              | LOW                   | `mv -n` → 0 при пропуске; добавить `test ! -e dict_base.db.new`                   |
| R-06      | c-gateway-grep                                             | LOW                   | код выхода только от второй части                                                 |

Load-bearing утверждение после правок: для всех 66 карточек команд — **выполняется** (sudo нет, `pkill -f`/`pgrep -f`
нет, `.stamp` не трогается, c-swap делает `mv` только при пустом fuser и не теряет файлов, всё, что пишет, помечено
`change` и перечислено). **Не выполняется** в одной текстовой инструкции вне карточек — R-01 (browserctx.start).
