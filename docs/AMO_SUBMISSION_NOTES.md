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
  из YouTube и с небольшим месячным лимитом ИИ (выдаёт Telegram-бот) или платный.
  Для фильмов нужен ключ с доступом к ним. Словарь работает бесплатно и без ключа.
• У примеров YouTube кнопка «Открыть в плеере» открывает ролик на flib.club.
  «С учётом моих знаний» и «Понятные» показывают на превью, сколько процентов
  вам понятно (нужен маршрут на сайте Flib; для «Понятных» — полный ключ).
• «В Anki» — карточка с переводом, примером, озвучкой и выбранными видео в
  один клик (нужны Anki и дополнение AnkiConnect).
• «?» — какая это часть речи именно в этом предложении и перевод всего
  предложения на русский: карточка сама прокручивается к нужным значениям, а
  перевод запоминается в расширении на вашем компьютере, и другие слова той же
  фразы показывают его сразу (нужен личный ключ).
• Окно фразы (Alt+Shift+A на выделенном тексте): видео с этой фразой, перевод по
  кнопке «?» и карточка Anki с отмеченными видео. Выделенный в окне кусок
  становится пропуском. Для видео и перевода нужен личный ключ, для сохранения
  Anki должна быть открыта.
• Права ключа, расход ИИ и озвучки видны в настройках, раздел «Ключ и права».
• «Проверить текст» — отметьте знакомые слова в скопированном тексте, чтобы
  видеть только новые (нужна программа Flibooster).
• Размытый перевод: сначала подумайте сами, потом щёлкните.

Словари (английский и англо-русский, ~180 МБ) скачиваются автоматически при
первом запуске. Расширение основано на открытом проекте Yomitan.
```

**Form choices:**

- Experimental: no.
- Payment or non-free services: yes. «Понятные», YouTube examples beyond the 50
  requests of the free test key, and AI features beyond the small monthly limit of
  that key need a paid key; film examples need a key that has access to films.
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
  time, a random event id, a constant source mark, the id of the current route
  and the key. At most 300 unsent events are kept locally; events older than 7
  days are deleted when a new one is recorded and before each send attempt. See
  PRIVACY.md «Route events». Firefox categories for these events:
  websiteActivity (the event type and time), browsingActivity (the route video
  id), websiteContent (the word), authenticationInfo (the key).
- Compatibility: Firefox for desktop only. Untick Firefox for Android if it is
  ticked (the manifest has `gecko_android`) until that build is tested.

## Notes for reviewers

Replace `<TEST KEY>` in the form only. Do not commit a real key.

```text
Fork of Yomitan (GPL-3.0). Repository: https://github.com/xxxvita/yomitan_anki_conf
Build instructions: BUILDING.md in the source archive. Node 24 needs no extra setup; tested on x86-64.

TEST
No login is needed. Install, wait for the two dictionaries (~180 MB) to download on the welcome page, open any English page, hold Shift and hover a word.
Video examples need a personal Flib key. Enter this free test key (50 YouTube example requests and a small monthly AI limit) in Settings → Key and access: <TEST KEY>
The same section then shows what the key allows and its AI and audio usage. «?» (part of speech, sentence and phrase translation) works with this key until its AI limit is used up.
«Понятные» needs a full key and a route on the Flib site; with this test key it shows a message. «С учётом моих знаний» shows the percent rings only with a route; without one it shows examples without rings and a message that a route is needed. The checkbox and «Открыть в плеере» are on every YouTube example.
Anki features need local Anki with AnkiConnect. The optional local Flibooster app adds word checking and is used when it is running: «Проверить текст» (Check text) is disabled without it. With Anki closed the button «В Anki» (To Anki) stays in the phrase window, and a press asks to open Anki.

DATA
Declared in data_collection_permissions: websiteContent (the looked-up word, its sentence and the text of the phrase window), websiteActivity (on the Flib route player page only: that a word's card was shown or its translation was opened, as route events), browsingActivity (page site and path, as tags on a saved Anki card; the route video id from the address of the Flib route player page) and authenticationInfo (the personal Flib key; the AnkiConnect key, if the user set one, to the user's Anki service). PRIVACY.md describes the requests.
- Dictionaries, downloaded as data: pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev
- Video examples, when the user presses «Примеры» (Examples), «С учётом моих знаний» (examples ranked by known words) or «Понятные» (understandable whole videos): cache.flib.club, sends the word and the key. In the phrase window (Alt+Shift+A) the word is the selected English text, or the whole text if nothing is selected, at most 200 characters. «Понятные» also sends the ids of the YouTube videos already shown in the panel (at most 1000), then polls the job by its id and cancels it (DELETE) when the user presses «Отменить», closes the panel or the 75-second client limit passes. The server takes the known words from the route profile of this key on its own side; the extension does not send them. For film examples the word list (words and language, no key) is uploaded to a temporary storage link the server returns; the film clips are then downloaded from cache.flib.club
- Key rights and usage, only with a personal key: GET /v1/me/access at the configured Flib server (default cache.flib.club), sends only the key, in the Authorization header. When the settings page opens, on «Refresh» («Обновить»), after the key or the address is saved, and when the user returns to the settings tab or window and the key or the address has changed meanwhile. No timer, the answer is not stored. The server counts it as activity of the key
- Part of speech and sentence translation, when the user presses «?» in the card: cache.flib.club, sends the word, its sentence and the key; the server asks OpenAI. The sentence and its Russian translation are stored locally in the extension's IndexedDB (last 2000 texts, nothing for private windows), removed with the extension or its data
- Phrase translation, when the user presses «?» in the phrase window (Alt+Shift+A): the same server, sends the whole English text of the window (at most 1000 characters, a longer one is not sent) and the key; the server asks OpenAI. The phrase and its translation go to the same local store, but not from private windows, nested cards or the extension's own pages
- Card enrichment, when the user adds a new word card (note type «Yomitan Card Type») with «В Anki», there is a key and the option is on (default): cache.flib.club, sends the word, the example sentence, the translation and the generated sentences (for audio) and the key; the server asks OpenAI (examples, synonyms, the phrase card) and ElevenLabs (audio); results go into the user's Anki (the note and, if enabled, a ReverseDeck and a Phrases note)
- Phrase saving, when the user presses «В Anki» in the phrase window, a new note is added, the same option is on and there is a key: the same server, sends the phrase (for audio), the phrase with a pause instead of its blank if there is one (for audio), and the phrase once more if its translation is empty and not in the local store, with the key; the server asks ElevenLabs and OpenAI; results go into that note, the translation also into the local store as above. Nothing is sent for a phrase longer than 1000 characters
- Route events, recorded only on the route player page of flib.club / flibooster.ru (https, /player with an rp parameter), never in private windows; queued ones may be sent later, only with a personal key: the configured Flib server (default cache.flib.club), GET /v1/route/state then POST /v1/route/external-events. Sends the route video id (rp) of the tab at the moment of the event, the looked-up word in dictionary form, the event type (hint_requested when the card shows a word, translation_opened when the user opens a blurred translation), the event time and the key; the event also carries a random event_id and the constant subs_source, and the batch carries the route_id from /v1/route/state. Not the page address, title or text, and nothing about the page open when a queued event is sent. Nested cards record nothing. Purpose: the user's route counts the looked-up words. Local queue in IndexedDB: at most 300 unsent events, events older than 7 days deleted when a new one is recorded and before each send attempt, the same word/type/video recorded at most once in 12 hours. Without a key the events stay local. A local log of looked-up words with page addresses from versions before this one is deleted when the extension starts; it never left the computer.
- Local service on the user's computer: 127.0.0.1:8777 and 127.0.0.1:8765. When a card is shown it receives the first field of the card that would be created (the word by default), the tags from the settings, the deck and the note type; on a save, the card fields (the word, its definitions and sentence and so on) and page-address tags; for «Проверить текст», the copied text or phrase and the words marked as known. The AnkiConnect key, if the user set one, goes with every AnkiConnect request. The extension also checks who answers at these addresses: at start, when settings change and during use
- Changes in Anki without a save, only while Anki itself is open: when a word card is shown or the phrase window is opened and the card settings use the type «Yomitan Card Type» (default), once per Anki address, the extension reads the note types, creates the deck «Flibooster» and the types «Yomitan Card Type», «ReverseDeck» and «Phrases» if they are missing and adds missing fields to the first two. At start, after settings change, when Anki is found again and when examples are requested through Flibooster it adds the missing fields data and flib_media to «Yomitan Card Type» or corrects the letter case of flib_media. AnkiWeb asks for a full sync after a field is added or renamed. Templates and CSS of existing types are not changed by this. With Anki closed nothing of this is written: the requests carry X-Anki-No-Fallback: 1 (Flibooster older than 1.0.108 may ignore it)
- Phrase window and Anki: the phrase window asks the same local service whether the phrase is there (when it opens and when its text or selection changes) and reads the notes found. «В Anki» there reads the fields, template and CSS of the note type Phrases and writes a Phrases note (phrase, blank, translation, ticked videos with their files, audio, tags); it creates the type and the deck if they are missing, adds the field flib_media to an older type (AnkiWeb then asks once for a full sync) and replaces its template and CSS only when they are unedited versions of ours or were left without working templates by Flibooster. These requests carry X-Anki-No-Fallback: 1, so that nothing is saved with Anki closed (the press then asks the user to open Anki); Flibooster older than 1.0.108 may ignore it and write to the local collection itself. Word cards do not carry it: with Anki closed a running Flibooster writes them to the local collection
- Pronunciation, when the user plays or saves audio or has turned on automatic playback: englishclass101.com, wikimedia.org; audio sources that the user adds get the word, its reading and the language, as their address asks
- Dictionaries that the user imports or updates: the address the user chose or typed, a plain download
- Google Fonts, requested by Anki and not by the extension: the CSS of the note types that the extension installs («Yomitan Card Type», «ReverseDeck», «Phrases») has @import of fonts.googleapis.com, which names the font host. Google gets the IP address when Anki, or any program, shows such a card
- YouTube thumbnails and embedded player for examples: i.ytimg.com, youtube-nocookie.com (and the other Google servers its player uses), youtube.com (links, on a click); the extension sets the Referer https://flib.club/ on its own embedded player (declarativeNetRequest)
- A YouTube example the user ticks and saves to Anki (also from «Понятные») is stored in the Anki field flib_media as an iframe https://www.youtube-nocookie.com/embed/<id>?start=<s>[&end=<s>]&rel=0 (lazy, no autoplay) with a plain https://www.youtube.com/watch link under it. Anki, or any program that shows the note, and not the extension, contacts YouTube (youtube-nocookie.com and the other Google servers its player uses) when it shows the side of the card with that field (the answer side in the Flib template) or opens the note in its editor or preview: YouTube gets the video id, the start/end second and the IP address, the video plays after a click, and the referrer is at most the origin of the page that shows the card (referrerpolicy strict-origin-when-cross-origin; desktop Anki: its local http://127.0.0.1:<port>/). None of this happens for examples that were not saved
- «Открыть в плеере»: a link https://flib.club/player?v=<video id>[&t=<start second>], opened in a new tab only on a click (noopener noreferrer); no key in the link; flib.club gets the IP address and its own cookies, as on any visit
- What the Flib server may keep: the search texts of «Понятные» with the job; for «Примеры» that failed or found nothing that can be shown, the word or text (and the first characters of the key) in its log; the audio made for cards with the first 120 characters of its text
No analytics, no remote code. Route events are a feature of the user's Flib route, not analytics: they are recorded only on the route player page; queued ones may be sent later, only with the user's key.
A page that opens popup.html in its own frame cannot fill it: content in the address is ignored, the popup accepts content only from the extension, and nothing in it can be pressed before that.

LINT WARNINGS (addons-linter)
- lib/handlebars.js, lib/linkedom.js, lib/z-worker.js: third-party libraries.
- handlebars Function constructor: the extension CSP has no 'unsafe-eval'.
- js/app/content-script-wrapper.js, js/comm/yomitan-api.js, js/background/offscreen-proxy.js: code from Yomitan. offscreen-proxy.js does not use the offscreen API in the Firefox build.
- js/display/video-examples-modal.js win.document.write: added by this fork. The HTML is a static string plus one clip URL that is HTML-escaped before insertion. Captions are added later through DOM methods.
```

## Version notes

AMO has 0.4.2, so its form gets the whole text. The Chrome Web Store has 0.5.2: there
the part «0.6.0–0.6.2» is used alone.

```text
0.6.0–0.6.2

Настройки и ключ
• Наши пункты собраны в группе «Flib-club», теги тоже там. В разделе «Ключ и права» видно, что даёт ключ и сколько потрачено ИИ и озвучки.
• Если ключ введён, при открытии настроек он отправляется на сервер Flib, чтобы показать права и расход.

«?»
• Переводит предложение на русский. Перевод хранится в расширении на вашем компьютере.

Видео
• «С учётом моих знаний» и «Понятные»: примеры и целые ролики с учётом знакомых слов. Кольцо на превью показывает, сколько процентов вам понятно. Нужен маршрут на сайте Flib.
• «Открыть в плеере»: ролик YouTube открывается на flib.club.
• Сохранённые примеры YouTube играют прямо в карточке. Для этого Anki обращается к YouTube.
• Сохранение с видео идёт до конца, даже если открыть другое слово. Уже сохранённые видео не пропадают.

Окно фразы (Alt+Shift+A)
• Ищет видео по выделенному тексту, переводит фразу по кнопке «?».
• «В Anki» сохраняет карточку Phrases с отмеченными видео. Выделенный кусок становится пропуском, без выделения — вся фраза. Если фраза уже в Anki, новой карточки нет, добавляются только видео.
• Если обогащение включено и есть ключ, к новой фразе добавляются озвучка и, если он пуст, перевод. Строка под полями показывает, что вышло.
• При первом сохранении прежний тип Phrases получает поле flib_media, и AnkiWeb один раз попросит полную синхронизацию. Если вы правили шаблон, добавится только поле.
• Фразы сохраняются только при открытой Anki; если она закрыта, нажатие об этом скажет. Если установлен Flibooster, нужен 1.0.108 или новее.

Anki
• Наши типы заметок ставятся, только пока Anki открыта.
• Обновление карточки меняет только карточки вашей колоды.

Маршрут Flib
• Только на странице плеера маршрута flib.club и flibooster.ru: если есть ключ, на сервер Flib уходят слово, ролик, время и то, показано определение или открыт перевод. Не в приватных окнах. В Firefox для этого новая категория данных websiteActivity.
• Старый журнал слов, который хранился только у вас, удаляется.

Исправления
• После видео во весь экран карточка остаётся на прежнем месте и прежнего размера. Угол для изменения размера больше.
• Безопасность: окно карточки не берёт содержимое из адреса, который задала страница.

0.4.3–0.5.2
• Обогащение карточек: примеры, синонимы, озвучка, обратная карточка и карточка-фраза. Включено по умолчанию, нужен личный ключ: текст карточки уходит через сервер Flib в OpenAI и ElevenLabs. Отключается в настройках, доп. карточки — отдельно.
• Колода «Flibooster» и типы заметок создаются в Anki, если их нет.
• «?» находит часть речи слова в предложении.
• Интерфейс на русском и английском.
• Личный ключ можно ввести прямо в карточке; там же ссылка, где его взять или купить.
• Импорт настроек сохраняет галочки обогащения.
• Новая иконка; ссылка на YouTube под цитатой из субтитров; у словарей указан источник, Wiktionary. Поддержка: help@flib.club.
```

## Earlier versions

Before v0.4.2 the add-on was self-distributed (unlisted) and updated through
`update_url`. Existing copies move to AMO as described in
[releasing.md](development/releasing.md#firefox-xpi).
