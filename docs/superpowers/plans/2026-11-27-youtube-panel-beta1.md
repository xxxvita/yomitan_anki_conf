# Бета 1: плеер flib.club на youtube.com — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** на странице ролика youtube.com под плеером работает плеер сайта flib.club, перенесённый дословно, включаемый бетой и кнопкой «C».

**Architecture:** код сайта (замыкание импортов `PlayerPage.tsx` на коммите `8799b6c`) копируется байт в байт в `vendor/flib-site/`, собирается esbuild вместе с React в `ext/lib/flib-youtube/`. Слой окружения `flib-youtube/` даёт этому коду имитацию YouTube IFrame API (через мост в мире страницы к `#movie_player`), синхронное хранилище, сеть через фоновую часть, цель порталов и CSS, ограниченный контейнером. Фоновая часть регистрирует сценарии при включённой бете и проксирует `/api` на flib.club.

**Tech Stack:** esbuild 0.25, React 18 (версии из `package-lock.json` сайта), TypeScript только в `vendor/` и `flib-youtube/`, vitest + jsdom, Playwright (Chromium) в `bwrap --unshare-net`.

**Spec:** `docs/superpowers/specs/2026-11-27-youtube-panel-beta1-design.md` (ветка `docs/youtube-panel-beta1`, коммит `ffb24ac8`). Опись кода сайта: `/tmp/claude-1000/-home-xxxvita-Work-yomitan-phrases-src/ce328f48-b46b-4a25-85d6-c6044c40712a/scratchpad/site-panel/INVENTORY.md`, проверка строителя: `.../site-panel/BUILDER-CHECK.md` (§«Claim 2» — полный список членов YT API). Выгрузка сайта: `.../scratchpad/site-main/` (только чтение; источник истины — `git archive` коммита).

## Global Constraints

- Источник: репозиторий `/home/xxxvita/Work/English/services/flib.club`, коммит `8799b6c6f30a155f6af8ee1251a8fb156ea6d8ab`, только через `git archive`/`git show`. Рабочую копию владельца не трогать и не читать как истину (она на старой ветке).
- **Ни один файл в `vendor/flib-site/` не правится руками.** Менять копию может только `dev/flib-site-sync.js`. Ни один модуль сайта не подменяется `alias` — подменяются только окружение: `window.YT`, `localStorage`/`sessionStorage`, `fetch`/`navigator.sendBeacon`, `react-dom` (цель `createPortal`), текст CSS при сборке, `requestFullscreen` у `.fs-root`.
- **Без Shadow DOM.** Контейнер — обычный DOM.
- Кадры `site/img/clip-zootopia.png`, `site/img/clip-phm.png` — заглушки PNG тех же размеров, однотонные.
- `define`: `import.meta.env.DEV=false`, `import.meta.env.PROD=true`, `import.meta.env.VITE_SHADOW_REALTIME=undefined`, `process.env.NODE_ENV="production"`.
- `/api/telemetry/events` и `sendBeacon` — ответ `204`, в сеть ничего (аналитика — после беты 1, по слову владельца). `/api/video/*` — `404` без сети. Белый список прокси: `/api/youtube/subtitles`, `/api/youtube/subtitles/translate`, `/api/examples`, `/api/feedback/video`, `/api/session`; прочее — `403` без сети. `credentials: 'omit'`. Принимать только от вкладок `https://www.youtube.com/`.
- Адреса flib.club — только из `ext/js/data/flib-host.js` (`FLIB_SITE_URL`); слой импортирует его оттуда.
- Русский текст интерфейса в `ext/js` — только в `ext/js/i18n/messages-ru.js` и `messages-en.js`, одинаковые ключи.
- Бета выключена → на youtube.com не грузится ни байта нового кода.
- Темы: `site` (по умолчанию), `refined`, `indigo`, `mono`; ключ кода сайта `flib:dusk-variant`.
- Живые проверки — только в `bwrap --unshare-net`; к 127.0.0.1:8765/8777 не обращаться; `pkill` по широкому шаблону запрещён; временное — только в `scratchpad/` сессии.
- Коммиты: без `Co-Authored-By`, последняя строка `Claude-Session: https://claude.ai/code/session_01SB7EQ7SYtfvh46DQa89BsG`. Стейджить по имени; не трогать `HANDOFF*.md`, `.claude/`, `dev/card-shot/`, `docs/HANDOFF.md`.
- Не менять `cleanModelText`, `_createHttpError`, `FLIB_POS_SYSTEM_PROMPT`, `FLIB_POS_TRANSLATE_SYSTEM_PROMPT`; в публичных текстах нет «Chad» и «LingQ».

## Review Focus

1. **Смена режима YouTube (обычный ↔ кинотеатр, ресайз окна, прокрутка)** — сцена с плашками должна оставаться точно над видео. Тест — задача 7.
2. **Выключение панели кнопкой «C» во время обратного отсчёта A-B** — после размонтирования ни один таймер копии не зовёт `play()`/`seek()` у YouTube. Тест — задача 7 (размонтирование посреди отсчёта, затем 4 с ожидания, моста не касались).
3. **Громкость/скорость/mute, изменённые в интерфейсе YouTube**, видны копии (снимок моста), а изменённые копией — видны в интерфейсе YouTube. Тест — задача 6.
4. **Переход на другой ролик во время рекламы** — новая панель не засевается длительностью рекламы и не стартует до `onReady` нужного id. Тест — задача 6.
5. **Две вкладки YouTube одновременно** — запись хранилища одной вкладки не затирает ключи другого ролика в другой (`flib:ws:<id>`), предзагрузка видит последнее записанное. Тест — задача 4.

---

### Task 1: Копия сайта, синхронизация, тест дословности

**Files:**

- Create: `dev/flib-site-sync.js`, `dev/lib/flib-site-verify.js`
- Create (генерирует скрипт): `vendor/flib-site/**`, `vendor/flib-site/SOURCE.json`, `vendor/flib-site/TEST-BASELINE.json`
- Create: `vendor/flib-site/README.md` (единственный файл, который пишется руками; в `SOURCE.json` не входит)
- Modify: `eslint.config.js` (ignores `vendor/`), `jsconfig.json` (exclude `vendor`, `flib-youtube`), `vitest.config.js` (exclude `vendor/**`, `flib-youtube/**` — у них свои конфиги)
- Test: `test/flib-site-verbatim.test.js`

**Interfaces:**

- Produces: `verifyVendor(vendorDir: string, source: SourceManifest) => {missing: string[], changed: string[], extra: string[]}` в `dev/lib/flib-site-verify.js`; `SourceManifest = {repo, commit, date, files: Array<{path, sha256, replaced?: 'placeholder', originalSha256?}>}`.

- [ ] **Step 1: тест `verifyVendor` на временных каталогах.** Случаи: всё совпадает → три пустых списка; изменён один байт → `changed`; удалён файл → `missing`; лишний файл → `extra`; `README.md` и `SOURCE.json` не считаются лишними; заглушка с `replaced:'placeholder'` сверяется по `sha256` заглушки. Плюс тест на настоящую копию: `verifyVendor('vendor/flib-site', SOURCE.json)` → три пустых списка.
- [ ] **Step 2: запустить, убедиться, что падает** (`npx vitest run test/flib-site-verbatim.test.js` — модуля нет).
- [ ] **Step 3: `dev/flib-site-sync.js --site <repo> --commit <sha> [--check]`.** Алгоритм: `git archive <sha> web` во временный каталог scratchpad → esbuild `bundle:true, metafile:true, write:false, platform:'browser'` от `web/src/pages/PlayerPage.tsx` с внешними npm-пакетами и загрузчиками для `.css`, `.png`, `.webp`, `.woff2` → множество входов metafile под `web/` = замыкание. Добавить: все `web/src/**/*.test.ts(x)` и файлы в `__tests__/`, которые импортируют хоть один файл замыкания (по тому же metafile от каждого теста), и замыкания этих тестов; `web/vitest.setup.ts` и его замыкание; фиксированный список из спеки §1 (`vitest.config.ts`, `tsconfig.json`, `package.json`, `package-lock.json`, `vite.config.ts`, `public/fonts/**`, `public/pcm16-worklet.js`, `src/fonts.css`, `src/dusk-tokens.css`, `src/app.css`, `src/site/site-theme.css`, `src/site/site-fonts.ts`, `src/site/lora.css`, `src/main.tsx` — как образец монтирования, в сборку не входит). Для двух кадров записать заглушку PNG тех же ширины и высоты (прочитать IHDR), один цвет `#2b2b2b`, без текста. Разложить в `vendor/flib-site/web/...`, удалить файлы, которых больше нет, записать `SOURCE.json` (пути отсортированы). `--check`: ничего не пишет, выходит с кодом 1 и печатает расхождения.
- [ ] **Step 4: снять базовую линию тестов сайта.** В выгрузке коммита: `npm ci` (сеть нужна только для установки), затем внутри `bwrap --unshare-net` `npx vitest run --reporter=json --outputFile=<scratchpad>/site-baseline.json`. Скрипт `--baseline <json>` пишет `vendor/flib-site/TEST-BASELINE.json`: `{commit, passed: string[], failed: string[], skipped: string[]}` (идентификатор — `файл › полное имя теста`), только для тестовых файлов, попавших в копию.
- [ ] **Step 5: прогнать синхронизацию и тест.** `node dev/flib-site-sync.js --site /home/xxxvita/Work/English/services/flib.club --commit 8799b6c6f30a155f6af8ee1251a8fb156ea6d8ab`, затем `--check` (код 0), `npx vitest run test/flib-site-verbatim.test.js` — PASS. Ожидаемо около 206 файлов замыкания плюс тесты; число записать в отчёт.
- [ ] **Step 6: README копии** — откуда, коммит, «не править руками, обновлять только `dev/flib-site-sync.js`», лицензия в составе расширения GPL-3.0-or-later, кадры заменены заглушками.
- [ ] **Step 7: Commit** — `feat(flib-site): verbatim copy of the flib.club player at 8799b6c`.

### Task 2: Тесты копии сайта в этом репозитории

**Files:**

- Modify: `package.json` (dependencies `react`, `react-dom`, `react-router-dom`, `lucide-react`; devDependencies `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@vitejs/plugin-react`, `typescript` если нужен копии — **точные версии из `vendor/flib-site/web/package-lock.json`**), `package-lock.json`, script `"test:flib-site": "node dev/flib-site-test.js"`, и `npm test` вызывает его
- Create: `dev/flib-site-test.js`
- Test: сам скрипт + `test/flib-site-test-compare.test.js`

**Interfaces:**

- Produces: `compareWithBaseline(baseline, results) => {newlyFailing: string[], newlyPassing: string[], missing: string[]}`.

- [ ] **Step 1: тест `compareWithBaseline`**: прошедший на сайте и упавший здесь → `newlyFailing`; упавший на сайте и прошедший здесь → `newlyPassing` (не ошибка, печатается); тест из базовой линии не запускался → `missing`.
- [ ] **Step 2: запустить — FAIL.**
- [ ] **Step 3: `dev/flib-site-test.js`**: `vitest run --root vendor/flib-site/web --config vendor/flib-site/web/vitest.config.ts --reporter=json` (vitest нашего репозитория; если конфиг копии требует плагин, он ставится зависимостью, конфиг не правится), сравнение с `TEST-BASELINE.json`, код выхода 1 при `newlyFailing` или `missing`.
- [ ] **Step 4: `npm run test:flib-site`** — PASS (ноль новых падений). Если версия vitest нашего репозитория (3.x) против сайта (2.x) роняет тесты — поставить vitest сайта отдельным пакетом-алиасом (`vitest-site@npm:vitest@<версия из lock>`) и звать его; конфиг копии не трогать.
- [ ] **Step 5: Commit** — `test(flib-site): run the site's own tests against the copy`.

### Task 3: Сборка `ext/lib/flib-youtube/` и переписывание CSS

**Files:**

- Create: `dev/build-flib-youtube.js`, `dev/lib/flib-css-scope.js`
- Create: `flib-youtube/src/entry.tsx` (пока: импорт `PlayerPage` и пустой `mount`, чтобы сборка шла), `flib-youtube/src/bridge/main-world.ts` (пока пустой), `flib-youtube/tsconfig.json`, `flib-youtube/vitest.config.ts`
- Modify: `dev/build-libs.js` (`buildLibs()` зовёт `buildFlibYoutube()`)
- Test: `test/flib-css-scope.test.js`, `test/flib-youtube-build.test.js`

**Interfaces:**

- Produces: `scopeCss(css: string, opts: {scope: string, portal: string, fontUrl: (u: string) => string}) => string`; `buildFlibYoutube({outdir?: string}) => Promise<void>` → `ext/lib/flib-youtube/{panel.js, panel.css, bridge.js, fonts/*, assets/*}`.
- Константы слоя (используются в задачах 4–8): контейнер `#flib-yt-root`, узел порталов `#flib-yt-portals`, префикс хранилища `flibYt:`.

- [ ] **Step 1: тесты `scopeCss`** (точные ожидания строкой):
  - `* { box-sizing: border-box }` → `:where(#flib-yt-root, #flib-yt-portals) *, :where(#flib-yt-root, #flib-yt-portals) { box-sizing: border-box }`;
  - `html, body, #root { height:100% }` и `:root { --fg: #fff }` → селектор `:where(#flib-yt-root, #flib-yt-portals)`;
  - `a { color: red }`, `.player-stage iframe {…}` → с префиксом `:where(#flib-yt-root, #flib-yt-portals) `;
  - правила внутри `@media`/`@supports` префиксуются, `@keyframes` и проценты внутри не трогаются;
  - `1.5rem` → `24px`, `0.25rem` → `4px` (база 16);
  - `@font-face { src: url(/fonts/X.woff2) }` и `url('@fontsource/lora/files/a.woff2')` → `url(<fontUrl(...)>)`; `@font-face` не префиксуется;
  - селектор, уже начинающийся с `:where(#flib-yt-root`, не префиксуется повторно.
- [ ] **Step 2: запустить — FAIL.**
- [ ] **Step 3: реализовать `scopeCss`** (парсер — `postcss`, если он уже есть в дереве зависимостей через stylelint; иначе добавить `postcss` в devDependencies). Решение по спеке §3.5 в части `@keyframes`: имена **не** префиксуются — `WorkspacePanel.tsx:16-19,162` вставляет `@keyframes slideUp` инлайн-элементом `<style>`, и инлайн-ссылки на имена в TSX сборкой не переписать; префикс сломал бы анимации. (Ruling, записать в ledger.)
- [ ] **Step 4: `buildFlibYoutube`**: два входа — `flib-youtube/src/entry.tsx` → `panel.js` (`format:'iife'`, `bundle`, `minify:false`, `sourcemap:false`, `jsx:'automatic'`, `define` из Global Constraints + `localStorage`/`window.localStorage`/`sessionStorage`/`window.sessionStorage`/`fetch`/`navigator.sendBeacon` → глобальные имена слоя `__flibYtLocalStorage`, `__flibYtSessionStorage`, `__flibYtFetch`, `__flibYtSendBeacon`, `alias: {'react-dom': 'flib-youtube/src/env/react-dom.ts'}` с выходом на настоящий `react-dom` изнутри обёртки); `bridge/main-world.ts` → `bridge.js`. CSS всех импортов собирается в `panel.css` и пропускается через `scopeCss`; `@font-face` выносится в `fonts.css`. Картинки и шрифты — файлами в `assets/`, `fonts/`, в коде адрес `chrome.runtime.getURL('lib/flib-youtube/assets/…')` (загрузчик `file` + `publicPath`, переписанный на `getURL` банером). Порядок CSS — как в `main.tsx:5-9`, потом CSS модулей в порядке импортов.
- [ ] **Step 5: тест сборки**: собрать дважды в два каталога scratchpad → байт в байт равны; в `panel.js` нет идентификаторов `localStorage`, `sessionStorage`, нет `import.meta`, нет строки `iframe_api` вне кода `IFrameAdapter` (проверка: строка есть ровно в одном месте — у копии), нет `/fonts/` абсолютных адресов в `panel.css`; в `panel.css` нет правила, чей селектор не начинается с `:where(#flib-yt-root, #flib-yt-portals)` (кроме `@keyframes`).
- [ ] **Step 6:** `npm run build:libs`, тесты PASS, `npm run test:fast` PASS.
- [ ] **Step 7: Commit** — `build(flib-youtube): bundle the copied player with scoped CSS`.

### Task 4: Синхронное хранилище

**Files:**

- Create: `flib-youtube/src/env/storage.ts`
- Test: `flib-youtube/src/env/__tests__/storage.test.ts`

**Interfaces:**

- Produces: `createSyncStorage(opts: {backend: StorageBackend | null, prefix: string}) => Storage`; `StorageBackend = {getAll(prefix): Promise<Record<string,string>>, set(items: Record<string,string|null>): Promise<void>, onChanged(cb: (changes: Record<string,string|null>) => void): void}`; `preloadSyncStorage(storage, backend) => Promise<void>`; `chromeStorageBackend()` поверх `chrome.storage.local`.

- [ ] **Step 1: тесты**: полный интерфейс `Storage` (`getItem` нет ключа → `null`, `setItem` приводит к строке, `removeItem`, `clear` чистит только свой префикс, `key(i)` и `length` после вставок/удалений); после `preloadSyncStorage` значения доступны синхронно; `setItem` уходит в `backend.set` с префиксом `flibYt:`; **Review Focus 5**: изменение из другой вкладки (`onChanged`) обновляет память, но не затирает ключ, записанный здесь позже (порядок — по времени записи: последняя запись побеждает), и запись `flib:ws:A` здесь не трогает `flib:ws:B`; `backend: null` (sessionStorage) — только память.
- [ ] **Step 2: FAIL. Step 3: реализация. Step 4: PASS** (`npx vitest run --config flib-youtube/vitest.config.ts flib-youtube/src/env/__tests__/storage.test.ts`).
- [ ] **Step 5: Commit** — `feat(flib-youtube): synchronous storage backed by chrome.storage`.

### Task 5: Сеть: fetch и sendBeacon через фоновую часть

**Files:**

- Create: `flib-youtube/src/env/net.ts`, `ext/js/background/flib-youtube-proxy.js`
- Test: `flib-youtube/src/env/__tests__/net.test.ts`, `test/flib-youtube-proxy.test.js`

**Interfaces:**

- Produces (слой): `createFlibFetch(send: (msg: ProxyRequest) => Promise<ProxyResponse>, realFetch: typeof fetch) => typeof fetch`; `createFlibSendBeacon() => (url, data) => boolean`.
- Produces (фон): `handleFlibYoutubeProxy(msg: ProxyRequest, sender: {url?: string}, fetchImpl) => Promise<ProxyResponse>`; `ProxyRequest = {action: 'flibYoutubeFetch', path: string, method: string, headers: Record<string,string>, body: string|null}`; `ProxyResponse = {status: number, statusText: string, headers: Array<[string,string]>, body: string}` (тело — текст; двоичных ответов в белом списке нет).

- [ ] **Step 1: тесты слоя**: `fetch('/api/youtube/subtitles?v=x')` → сообщение с `path`, ответ — настоящий `Response`: `status`, `headers.get('Retry-After')`, `headers.get('X-Subtitle-Source')`, `.json()`; `fetch('https://i.ytimg.com/...')` → `realFetch`; `/api/telemetry/events` → `204` без сообщения; `sendBeacon('/api/telemetry/events', blob)` → `true` без сообщения; `keepalive` и `signal` не ломают вызов (signal: abort до ответа → `AbortError`).
- [ ] **Step 2: тесты фона**: отправитель не `https://www.youtube.com/` → `403`, `fetchImpl` не вызван; путь вне белого списка → `403`; `/api/video/abc` и `/api/video/abc?probe=1` → `404`, не вызван; `/api/telemetry/events` → `204`, не вызван; разрешённый путь → `fetchImpl(FLIB_SITE_URL + path, {method, headers, body, credentials:'omit'})`, заголовки ответа переданы все; `path` с `..`, `//`, схемой или `@` → `403`.
- [ ] **Step 3: FAIL. Step 4: реализация. Step 5: PASS.**
- [ ] **Step 6: Commit** — `feat(flib-youtube): /api through the background with an allowlist`.

### Task 6: Имитация YouTube IFrame API и мост в мире страницы

**Files:**

- Create: `flib-youtube/src/env/yt-fake.ts`, `flib-youtube/src/bridge/main-world.ts`, `flib-youtube/src/bridge/protocol.ts`
- Test: `flib-youtube/src/env/__tests__/yt-fake.test.ts`, `flib-youtube/src/bridge/__tests__/main-world.test.ts`, `flib-youtube/src/env/__tests__/iframe-adapter-over-fake.test.ts`

**Interfaces:**

- Consumes: полный список членов YT из `BUILDER-CHECK.md` «Claim 2» (перенести таблицу в комментарий модуля).
- Produces: `installFakeYT(win: Window, bridge: BridgeClient) => void` (кладёт `win.YT = {Player, PlayerState}` с кодами `UNSTARTED -1, ENDED 0, PLAYING 1, PAUSED 2, BUFFERING 3, CUED 5`); `BridgeClient = {snapshot(): Snapshot, command(c: Command): void, onEvent(cb): () => void}`; `Snapshot = {videoId, currentTime, duration, state, rate, rates, muted, volume, loadedFraction, adShowing: boolean, t: number}`; протокол `window.postMessage({source:'flib-yt-bridge', v:1, kind:'snapshot'|'event'|'command', ...}, location.origin)`.

- [ ] **Step 1: тесты имитации (фальшивый `BridgeClient`)**: `new YT.Player('yt-player', {videoId, events})` не вызывает колбэки синхронно, `onReady` — после microtask и только когда `snapshot().videoId === videoId`; геттеры `getCurrentTime/getDuration/getPlayerState/getPlaybackRate/getAvailablePlaybackRates/isMuted/getVolume/getVideoLoadedFraction` отдают снимок; `getDuration` при `NaN`/`Infinity`/`undefined` → `0`; `seekTo(t, true)`, `playVideo`, `pauseVideo`, `setPlaybackRate`, `mute`, `unMute`, `setVolume`, `loadModule/unloadModule('captions'|'cc')` → `command`; `cueVideoById({videoId: тот же, startSeconds: 12})` → `seekTo 12` без смены ролика, другой id → ничего; события `onStateChange`/`onPlaybackRateChange`/`onError` приходят из событий моста асинхронно; событие `error` элемента `<video>` (без ошибки API плеера) не даёт `onError`; `adShowing: true` → `getCurrentTime` = последнее время ролика до рекламы, `getDuration` = длительность ролика (или 0), `getPlayerState` = `BUFFERING`, команды не уходят; после рекламы — фактические значения; `destroy()` снимает подписку и не шлёт команд; `getIframe()` → `null`.
- [ ] **Step 2: тест «копия поверх имитации»**: импортировать `vendor/flib-site/web/src/adapter/IFrameAdapter.ts` (как есть), `installFakeYT` на `window` jsdom с фальшивым мостом, `createIFrameAdapter('yt-player', 'vid1', {}, () => false)` резолвится; `currentTime()` растёт между опросами 150 мс при `PLAYING` (сглаживание `clock-shim`), `seek(30)` → команда `seekTo 30`; `iframe_api` не вставлен в `document.head`. **Review Focus 4**: снимок с `adShowing:true, videoId:'vid2'` во время перехода → `onReady` для `vid2` не приходит, пока реклама; после — приходит с длительностью ролика.
- [ ] **Step 3: тесты моста (jsdom, фальшивый `#movie_player` с методами API)**: на `requestAnimationFrame` и на `onStateChange` плеера уходит снимок формы `Snapshot`; `adShowing` = класс `ad-showing` у `#movie_player`; команда чужой формы (нет `source`, `v !== 1`, неизвестный `kind`/имя) игнорируется; `unloadModule('captions')` вызывается на плеере, а при `restoreCaptions` — `loadModule('captions')`, только если субтитры были включены до выгрузки. **Review Focus 3**: изменение громкости/скорости в «интерфейсе YouTube» (метод фальшивого плеера) попадает в следующий снимок; `setVolume`/`setPlaybackRate` от копии вызывают методы плеера, а не пишут в `<video>`.
- [ ] **Step 4: FAIL. Step 5: реализация. Step 6: PASS.**
- [ ] **Step 7: Commit** — `feat(flib-youtube): YouTube IFrame API emulation over the page player`.

### Task 7: Монтирование, маршрутизатор, порталы, сцена, переходы

**Files:**

- Create: `flib-youtube/src/entry.tsx` (полностью), `flib-youtube/src/mount.ts`, `flib-youtube/src/env/react-dom.ts`, `flib-youtube/src/env/lang-guard.ts`, `flib-youtube/src/env/fullscreen.ts`, `flib-youtube/src/stage.ts`, `flib-youtube/src/OpenOnSite.tsx`, `flib-youtube/src/layer.css`
- Test: `flib-youtube/src/__tests__/mount.test.tsx`, `flib-youtube/src/__tests__/stage.test.ts`

**Interfaces:**

- Consumes: задачи 3–6 (`installFakeYT`, `createSyncStorage`, `createFlibFetch`).
- Produces: `startFlibYoutube(win: Window) => Promise<FlibYoutubeHandle>`; `FlibYoutubeHandle = {show(): void, hide(): void, remount(): void, stop(): void}`; сообщения контент-сценарию от фона: `{action:'flibYoutubeSetVisible', visible: boolean}`, `{action:'flibYoutubeRemount'}`, `{action:'flibYoutubeStop'}`.

- [ ] **Step 1: тесты монтирования (jsdom, разметка-стенд `ytd-watch-flexy > #player #movie_player video` + `#below`, фальшивый мост, фальшивая сеть с телами ответов сайта из теста копии)**:
  - `show()` → `#flib-yt-root` вставлен перед `#below`, внутри отрисованы таймлайн (`WorkspacePanelThemed`) и плашка EN для текущего времени; `#flib-yt-portals` — последний ребёнок `body`;
  - `createPortal(x, document.body)` из копии (открыть меню перевода правым щелчком по плашке) рендерит в `#flib-yt-portals`, щелчок по пункту меню срабатывает;
  - `document.documentElement.lang` до и после монтирования и после `setLocale('en')` в копии — прежний;
  - щелчок по `<a href="/route">` внутри контейнера → `window.open('<FLIB_SITE_URL>/route', '_blank')`, `location` вкладки не меняется; маршрут `*` в `MemoryRouter` делает то же и возвращает `/player?v=<id>`;
  - смена `v` в адресе + событие `yt-navigate-finish` → дерево перемонтировано с новым id; уход на `/results` → панель размонтирована;
  - **Review Focus 2**: включить петлю A-B с паузой в Б 2 с, довести время до Б (снимок моста), во время отсчёта `hide()`; продвинуть фальшивые таймеры на 4 с → мост не получил ни `playVideo`, ни `seekTo`;
  - `requestFullscreen` у `.fs-root` → вызван у `#movie_player`;
  - время начала (спека §3.17): адрес `watch?v=x&t=90` → `MemoryRouter` получает `/player?v=x&t=90`; `t=90s`, `t=1m30s`, `t=0`, `t=1000000` → `t` не передаётся.
- [ ] **Step 2: тесты сцены**: `syncStage(stageEl, playerEl)` ставит `.player-stage` в прямоугольник `#movie_player` (`position:fixed`, `left/top/width/height` из `getBoundingClientRect`); **Review Focus 1**: изменение размера `#movie_player` (ResizeObserver) и прокрутка обновляют прямоугольник; класс кинотеатра у `ytd-watch-flexy` (`theater`) — тоже.
- [ ] **Step 3: FAIL. Step 4: реализация.** Порядок в `entry.tsx`: (1) `installFakeYT`, хранилище с предзагрузкой и глобальные имена из задачи 3 (`globalThis.__flibYtLocalStorage`, `__flibYtSessionStorage`, `__flibYtFetch`, `__flibYtSendBeacon`) — до импорта копии (динамический `import()` модуля, который тянет `PlayerPage`); (2) `lang-guard`; (3) монтирование по сообщению `flibYoutubeSetVisible`. `StrictMode` как в `main.tsx:27-31`. `layer.css`: сброс наследуемых свойств у `#flib-yt-root`, раскладка (высота `.player-shell` — по содержимому, а не `100vh`), сцена прозрачная, `pointer-events` только у плашек; ничего из копии не прячется.
- [ ] **Step 5: PASS. Step 6: Commit** — `feat(flib-youtube): mount the copied player under the YouTube player`.

### Task 8: Горячие клавиши

**Files:**

- Create: `flib-youtube/src/env/hotkeys.ts`
- Test: `flib-youtube/src/env/__tests__/hotkeys.test.ts`

**Interfaces:**

- Produces: `installHotkeyArbiter(win: Window, isPanelActive: () => boolean) => () => void`.

- [ ] **Step 1: тесты** (в jsdom заранее навесить «слушатель YouTube» на `document` и на `window` в фазе всплытия и захвата, и слушатель копии — смонтированный `PlayerPage`): при показанной панели `Space`, `ArrowLeft`, `ArrowRight`, `Ctrl+ArrowLeft/Right`, `b`, `m`, `z`, `g`, `Escape`, `Delete` — копия срабатывает ровно один раз, ни один слушатель YouTube не вызван; `f` — у YouTube (не перехватывается); фокус в `input`/`textarea`/`contenteditable` (в том числе поле поиска копии) → не перехватывается; панель скрыта → не перехватывается; `S`/`R` — как на сайте (заперто, YouTube не получает, если панель показана).
- [ ] **Step 2: FAIL. Step 3: реализация** (способ — на выбор исполнителя; критерий — тест). **Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(flib-youtube): player hotkeys win over YouTube while the panel is shown`.

### Task 9: Фоновая часть, настройки, миграция

**Files:**

- Create: `ext/js/background/flib-youtube-beta.js`
- Modify: `ext/js/background/backend.js` (подключить модуль и обработчики сообщений `flibYoutubeFetch`, `flibYoutubeGetState`, `flibYoutubeSetPanelVisible`), `ext/data/schemas/options-schema.json` (`global.flibYoutube = {beta: false, theme: 'site'}`, `theme` ∈ `site|refined|indigo|mono`), `ext/js/data/options-util.js` (`_updateVersion85`), `types/ext/settings.d.ts`
- Test: `test/flib-youtube-beta.test.js`, тест миграции в `test/options-util.test.js`

**Interfaces:**

- Produces: `FlibYoutubeBeta` с методами `prepare()`, `applyOptions(globalOptions)`, `setPanelVisible(visible: boolean)`, `getState() => {beta: boolean, panelVisible: boolean, theme: string}`; ключ `chrome.storage.local` `flibYoutube.panelVisible` (по умолчанию `false`); тема пишется в `flibYt:flib:dusk-variant` хранилища слоя.

- [ ] **Step 1: тесты** (фальшивый `chrome.scripting`/`chrome.tabs`/`chrome.storage`): `beta:false` → `registerContentScripts` не вызван, зарегистрированные сценарии `flib-youtube-panel`, `flib-youtube-bridge` сняты; `beta:true` → зарегистрированы два: `{id:'flib-youtube-bridge', matches:['https://www.youtube.com/*'], js:['lib/flib-youtube/bridge.js'], world:'MAIN', runAt:'document_start'}` и `{id:'flib-youtube-panel', matches:['https://www.youtube.com/*'], js:['lib/flib-youtube/panel.js'], css:['lib/flib-youtube/fonts.css','lib/flib-youtube/panel.css'], runAt:'document_idle'}`, и в открытые вкладки `https://www.youtube.com/*` внедрены оба; повторный `applyOptions` с тем же значением регистрацию не дублирует; `beta` true→false → вкладкам ушло `flibYoutubeStop`; `setPanelVisible(true)` → запомнено, вкладкам YouTube ушло `flibYoutubeSetVisible`; смена `theme` → `flibYt:flib:dusk-variant` записан, вкладкам ушло `flibYoutubeRemount`.
- [ ] **Step 2: тест миграции v85**: старые настройки без `global.flibYoutube` → `{beta:false, theme:'site'}`; `npm run test:unit:options` PASS.
- [ ] **Step 3: FAIL. Step 4: реализация. Step 5: PASS**, `npm run test:fast` PASS.
- [ ] **Step 6: Commit** — `feat(flib-youtube): beta switch registers the YouTube scripts`.

### Task 10: Интерфейс: настройки, кнопка «C», манифест, тексты

**Files:**

- Modify: `ext/settings.html` (в группе Flib-club пункт `advanced-only`: переключатель `data-setting="global.flibYoutube.beta"` и выбор темы `data-setting="global.flibYoutube.theme"` с четырьмя вариантами), `ext/action-popup.html` (кнопка `.action-flib-youtube` рядом с `.action-open-settings`, иконка — буква C в кружке, SVG), `ext/css/action-popup.css`, `ext/js/pages/action-popup-main.js`, `ext/js/i18n/messages-ru.js`, `ext/js/i18n/messages-en.js`, `dev/data/manifest-variants.json` (`web_accessible_resources`: `lib/flib-youtube/assets/*`, `lib/flib-youtube/fonts/*` для `https://www.youtube.com/*`), затем `npm run build` для `ext/manifest.json`
- Test: `test/action-popup-flib-youtube.test.js`, `npm run test:html`, `npm run test:css`

**Interfaces:**

- Consumes: `flibYoutubeGetState`, `flibYoutubeSetPanelVisible` (задача 9).
- Produces: ключи i18n `settings.flibYoutubeBeta`, `settings.flibYoutubeBetaHint`, `settings.flibYoutubeTheme`, `settings.flibYoutubeThemeSite/Refined/Indigo/Mono`, `popup.flibYoutubeShow`, `popup.flibYoutubeHide`, `popup.flibYoutubeNotWatch` — одинаковые в ru и en.

- [ ] **Step 1: тест логики кнопки** (`computeFlibButtonState({beta, panelVisible, tabUrl}) => {hidden, disabled, pressed, titleKey}`): `beta:false` → `hidden`; `beta:true`, вкладка `https://www.youtube.com/watch?v=x` → активна, `pressed = panelVisible`; вкладка не ролик (`/`, `/results`, `/shorts/x`, не YouTube) → видна, `disabled`, подсказка `popup.flibYoutubeNotWatch`; щелчок переключает `panelVisible`.
- [ ] **Step 2: FAIL. Step 3: реализация. Step 4: PASS**; `npm run test:html`, `npm run test:css`, `npm run test:fast` PASS; в `ext/js` нет русских строк вне `messages-*.js` (существующий тест/линт).
- [ ] **Step 5: Commit** — `feat(flib-youtube): beta toggle, theme choice and the C button`.

### Task 11: Стенд без сети (Playwright)

**Files:**

- Create: `test/flib-youtube/stand/watch.html` (разметка YouTube: `ytd-watch-flexy`, `#player`, `#movie_player` с `<video src="clip.webm">`, `#below`; фальшивый API `#movie_player` в мире страницы поверх этого `<video>`, умеющий `ad-showing` и смену `v`), `test/flib-youtube/stand/clip.webm` (сгенерировать ffmpeg: 60 с, цветные кадры, без звука), `test/flib-youtube/stand/fixtures/*.json` (ответы `/api` в формате сайта), `test/playwright/flib-youtube.spec.js`, `playwright.flib-youtube.config.js` (свой конфиг: локальный HTTP-сервер стенда, отдающий страницу как `https://www.youtube.com/watch` через `route` Playwright; ответы flib.club — через `route` на `FLIB_SITE_URL`)
- Test: сам спек

- [ ] **Step 1: сценарии из спеки §6.6**, каждый — отдельный тест, запуск `bwrap --unshare-net … npx playwright test -c playwright.flib-youtube.config.js`:
  - бета выключена → в странице нет `#flib-yt-root`, в сети нет запросов к `lib/flib-youtube/`;
  - бета и «C» включены → `#flib-yt-root` под плеером, плашка EN над видео меняется по ходу видео;
  - щелчок по боксу субтитров, A-B с паузой в Б 1 с → у видео пауза, отсчёт, продолжение с A;
  - `Space` один раз ставит паузу и один раз продолжает (`video.paused` чередуется, фальшивый API YouTube не получил свою клавишу);
  - pre-roll (`ad-showing` + видео рекламы 5 с) → длина таймлайна = длине ролика; реклама посередине → строка, петля и playhead стоят; после — продолжают;
  - смена ролика без перезагрузки → панель нового ролика;
  - щелчок по слову → окно слова сайта; Shift+наведение → карточка Yomitan;
  - тема `indigo` в настройках → `data-dusk="indigo"` у открытой панели.
- [ ] **Step 2: прогнать — PASS. Step 3: Commit** — `test(flib-youtube): offline YouTube stand`.

### Task 12: Сверка «ничего не потеряно»

**Files:**

- Create: `test/flib-youtube/parity/site-harness.tsx` (монтирует копию `PlayerPage` под `MemoryRouter` — как `pages/__tests__/PlayerPage.test.tsx`, с теми же `installFakeYT`, хранилищем и сетью, но в обычной странице без расширения и без `scopeCss`), сборка харнеса в `dev/build-flib-youtube.js` под флагом `--parity`, `test/playwright/flib-youtube-parity.spec.js`
- Test: сам спек

- [ ] **Step 1: сценарий** (одинаковый для обеих сторон): субтитры из фикстуры; время видео 0 → 12,3 → 47 → щелчок по 5-му боксу → Ctrl+колесо (масштаб) → перетаскивание ручки Б → включение A-B → режим «EN+RU» → «Скрыть» → правый щелчок по дорожке AUD → `m` (область mute) → `z` → `z`. После каждого шага снимать `outerHTML` поддерева `.player-page` и нормализовать: адреса ресурсов → `<asset>`, значения CSS-переменной `--php` округлить до 0,1 %.
- [ ] **Step 2: сравнение** — строки равны на каждом шаге; при расхождении тест печатает первый отличающийся фрагмент.
- [ ] **Step 3: PASS. Step 4: Commit** — `test(flib-youtube): DOM parity with the site's player`.

### Task 13: Документы и выпуск беты в ветку

**Files:**

- Modify: `BUILDING.md` (шаг `npm run build:libs` собирает плеер из `vendor/flib-site`; Node и esbuild те же), `PRIVACY.md` (бета на youtube.com: при включённой бете на flib.club уходят id ролика, окно времени для перевода, оценка ролика по нажатию; аналитика не отправляется), `docs/AMO_SUBMISSION_NOTES.md` (новый код в `lib/flib-youtube/`, исходники в `vendor/flib-site` и `flib-youtube/`, сценарий в мире страницы — зачем)
- Create: чек-лист живой проверки владельцем в описании PR (те же сценарии, что в задаче 11, на настоящем youtube.com: обычный и кинотеатр, реклама, живой чат печатает, клавиши YouTube при скрытой панели, тема)

- [ ] **Step 1:** правки документов; `npm run test:md` PASS.
- [ ] **Step 2: полный прогон** `npm test` и `npm run test:flib-site` — PASS; `node dev/flib-site-sync.js --site … --commit 8799b6c… --check` — код 0.
- [ ] **Step 3: Commit** — `docs(flib-youtube): building, privacy and review notes`.
