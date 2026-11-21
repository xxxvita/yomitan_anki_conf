# AMO Submission Notes — Flib-club

Texts for the AMO form. Flib-club is listed on AMO since v0.4.2. The steps are in
[releasing.md](development/releasing.md#firefox-xpi).

Before each submission, check these texts against `PRIVACY.md` and the lint
result below.

## Listing

**Summary:**

> Словарь в браузере: перевод слова при наведении, примеры из YouTube и фильмов,
> карточки Anki в один клик.

**Description:**

```text
Flib-club — словарь английского прямо на странице, которую вы читаете.

• Наведите мышь на слово с зажатым Shift — появится карточка: значения из
  Wiktionary и перевод каждого значения на русский.
• Фразы и идиомы находятся целиком: «call it a day», «a penny for your
  thoughts», «such as».
• Щелчок по любому слову внутри карточки открывает вложенную карточку — можно
  разбираться в определениях, не теряя исходного слова.
• «Примеры» — короткие фрагменты из YouTube и фильмов, где это слово звучит в
  живой речи. Нужен личный ключ: бесплатный тестовый на 50 запросов к примерам
  из YouTube (выдаёт Telegram-бот) или платный. Словарь работает бесплатно и без ключа.
• «В Anki» — карточка с переводом, примером, озвучкой и выбранными видео в
  один клик (нужны Anki и дополнение AnkiConnect).
• «?» — какая это часть речи именно в этом предложении и перевод всего
  предложения на русский: карточка сама прокручивается к нужным значениям, а
  перевод запоминается в расширении на вашем компьютере, и другие слова той же
  фразы показывают его сразу (нужен личный ключ).
• «Проверить текст» — отметьте знакомые слова в скопированном тексте, чтобы
  видеть только новые.
• Размытый перевод: сначала подумайте сами, потом щёлкните.

Словари (английский и англо-русский, ~180 МБ) скачиваются автоматически при
первом запуске. Расширение основано на открытом проекте Yomitan.
```

**Form choices:**

- Experimental: no.
- Payment or non-free services: yes. Film examples, and YouTube examples beyond
  the 50 requests of the free test key, need a paid key.
- Category: Language Support.
- Support website: <https://flib.club>
- Support email: `help@flib.club`
- License: GNU General Public License v3.0 only. The form has no or-later option,
  and GPL-3.0-or-later allows distribution under GPL v3.
- Privacy policy: `https://xxxvita.github.io/yomitan_anki_conf/PRIVACY`
- Data notes for the listing: besides the requests the user starts, route events
  are recorded only on the route player page of flib.club / flibooster.ru (never
  in private windows); queued ones may be sent later, only with a personal key,
  to the Flib server: the route video id, the looked-up word in dictionary form,
  the event type (definition shown or Russian translation opened), the event
  time and the key. At most 300 unsent events are kept locally; events older
  than 7 days are deleted when a new one is recorded and before each send
  attempt. See PRIVACY.md «Route events».
- Compatibility: Firefox for desktop only. Untick Firefox for Android if it is
  ticked (the manifest has `gecko_android`) until that build is tested.

## Notes for reviewers

Replace `<TEST KEY>` in the form only. Do not commit a real key.

```text
Fork of Yomitan (GPL-3.0). Repository: https://github.com/xxxvita/yomitan_anki_conf
Build instructions: BUILDING.md in the source archive. Node 24 needs no extra setup; tested on x86-64.

TEST
No login is needed. Install, wait for the two dictionaries (~180 MB) to download on the welcome page, open any English page, hold Shift and hover a word.
Video examples need a personal Flib key. Enter this free test key (50 YouTube example requests, no film examples) in Settings → Personal key: <TEST KEY>
Anki features need local Anki with AnkiConnect. The optional local Flibooster app adds word checking and is used when it is running.

DATA
Declared in data_collection_permissions: websiteContent (the looked-up word and its sentence), browsingActivity (page site and path, as tags on a saved Anki card; the route video id from the address of the Flib route player page) and authenticationInfo (the personal Flib key). PRIVACY.md lists every request.
- Dictionaries, downloaded as data: pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev
- Video examples, when the user presses «Примеры» (Examples), «С учётом моих знаний» (examples ranked by known words) or «Понятные» (understandable whole videos): cache.flib.club, sends the word and the key. In the phrase window (Alt+Shift+A) the word is the selected English text, or the whole text if nothing is selected, at most 200 characters. «Понятные» also sends the ids of the YouTube videos already shown in the panel (at most 1000), then polls the job by its id and cancels it (DELETE) when the user presses «Отменить», closes the panel or the 75-second client limit passes. The server takes the known words from the route profile of this key on its own side; the extension does not send them
- Part of speech and sentence translation, when the user presses «?» in the card: cache.flib.club, sends the word, its sentence and the key; the server asks OpenAI. The sentence and its Russian translation are stored locally in the extension's IndexedDB (last 2000 sentences, nothing for private windows), removed with the extension or its data
- Card enrichment, when the user saves a card with «+» and the option is on (default): cache.flib.club, sends the word, the example sentence, the translation and the key; the server asks OpenAI (examples, synonyms) and ElevenLabs (audio); results go into the user's Anki
- Route events, recorded only on the route player page of flib.club / flibooster.ru (https, /player with an rp parameter), never in private windows; queued ones may be sent later, only with a personal key: the configured Flib server (default cache.flib.club), GET /v1/route/state then POST /v1/route/external-events. Sends the route video id (rp) of the tab at the moment of the event, the looked-up word in dictionary form, the event type (hint_requested when the card shows a word, translation_opened when the user opens a blurred translation), the event time and the key. Not the page address, title or text, and nothing about the page open when a queued event is sent. Nested cards record nothing. Purpose: the user's route counts the looked-up words. Local queue in IndexedDB: at most 300 unsent events, events older than 7 days deleted when a new one is recorded and before each send attempt, the same word/type/video recorded at most once in 12 hours. Without a key the events stay local. A local log of looked-up words with page addresses from versions before this one is deleted when the extension starts; it never left the computer.
- Local service on the user's computer: 127.0.0.1:8777 and 127.0.0.1:8765, receives the word, the sentence, card fields and page-address tags
- Pronunciation, when the user plays or saves audio: englishclass101.com, wikimedia.org
- YouTube thumbnails and embedded player for examples: i.ytimg.com, youtube-nocookie.com, youtube.com
No analytics, no remote code. Route events are a feature of the user's Flib route, not analytics: they are recorded only on the route player page; queued ones may be sent later, only with the user's key.

LINT WARNINGS (addons-linter)
- lib/handlebars.js, lib/linkedom.js, lib/z-worker.js: third-party libraries.
- handlebars Function constructor: the extension CSP has no 'unsafe-eval'.
- js/app/content-script-wrapper.js, js/comm/yomitan-api.js, js/background/offscreen-proxy.js: code from Yomitan. offscreen-proxy.js does not use the offscreen API in the Firefox build.
- js/display/video-examples-modal.js win.document.write: added by this fork. The HTML is a static string plus one clip URL that is HTML-escaped before insertion. Captions are added later through DOM methods.
```

## Version notes

```text
Первая версия в каталоге Firefox: обновления теперь приходят через addons.mozilla.org. Нужен Firefox 140 или новее.
```

## Earlier versions

Before v0.4.2 the add-on was self-distributed (unlisted) and updated through
`update_url`. Existing copies move to AMO as described in
[releasing.md](development/releasing.md#firefox-xpi).
