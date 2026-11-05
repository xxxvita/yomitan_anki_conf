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
  живой речи. Нужен личный ключ: бесплатный тестовый с дневным лимитом (выдаёт
  Telegram-бот) или платный. Словарь работает бесплатно и без ключа.
• «В Anki» — карточка с переводом, примером, озвучкой и выбранными видео в
  один клик (нужны Anki и локальное приложение Flibooster).
• «Проверить текст» — отметьте знакомые слова в скопированном тексте, чтобы
  видеть только новые.
• Размытый перевод: сначала подумайте сами, потом щёлкните.

Словари (английский и англо-русский, ~180 МБ) скачиваются автоматически при
первом запуске. Расширение основано на открытом проекте Yomitan.
```

**Form choices:**

- Experimental: no.
- Payment or non-free services: yes. Video examples beyond the daily limit of
  the free test key need a paid key.
- Category: Language Support.
- Support website: <https://flib.club>
- Support email: `god.antigravity@gmail.com`
- License: GPL-3.0-or-later (the nearest GPL v3 option if the form has no exact
  match).
- Privacy policy: `https://xxxvita.github.io/yomitan_anki_conf/PRIVACY`
- Compatibility: Firefox for desktop only. Untick Firefox for Android if it is
  ticked (the manifest has `gecko_android`) until that build is tested.

## Notes for reviewers

Replace `<TEST KEY>` in the form only. Do not commit a real key.

```text
Fork of Yomitan (GPL-3.0). Repository: https://github.com/xxxvita/yomitan_anki_conf
Build instructions: BUILDING.md in the source archive. Node 24 needs no extra setup; tested on x86-64.

TEST
No login is needed. Install, wait for the two dictionaries (~180 MB) to download on the welcome page, open any English page, hold Shift and hover a word.
Video examples need a personal Flib key. Enter this free test key (daily search limit) in Settings → Flib: <TEST KEY>
Anki features need local Anki and Flibooster.

DATA
Declared in data_collection_permissions: websiteContent (the looked-up word and its sentence), browsingActivity (page site and path, as tags on a saved Anki card) and authenticationInfo (the personal Flib key). PRIVACY.md lists every request.
- Dictionaries, downloaded as data: pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev
- Video examples, when the user presses «Примеры»: cache.flib.club, sends the word and the key
- Local service on the user's computer: 127.0.0.1:8777 and 127.0.0.1:8765, receives the word, the sentence, card fields and page-address tags
- Pronunciation, when the user plays or saves audio: englishclass101.com, wikimedia.org
- YouTube thumbnails and embedded player for examples: i.ytimg.com, youtube-nocookie.com, youtube.com
No analytics, no remote code.

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
