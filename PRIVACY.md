# Privacy Policy — Flib-club

_Last updated: 2026-11-26 (version 0.6.2)_

Flib-club is a browser extension for learning English: it shows the meaning
of a word under the mouse, finds video examples with that word, and saves
flashcards to Anki. It is a fork of
[Yomitan](https://github.com/yomidevs/yomitan).

## In short

- Flib-club does **not** collect analytics, does **not** track the pages you
  visit and does **not** sell or share data with advertisers.
- By default, the address of a page leaves the browser only when you save a
  card (for the site name inside the YouTube player, see «YouTube» below): it
  goes to your Anki service as tags on that card. The one exception is the route
  player page of flib.club / flibooster.ru: there the id of the route video,
  taken from the page address, is sent with route events (see below).
- Page text is read **locally** to find the word under the mouse. While you
  just read, nothing from the page is sent to the internet, except route
  events on the Flib route player page: the word shown in the card or whose
  translation you opened, with the route video id. To show whether a
  word is already in your Anki, the first field of its card (the word by
  default) with the tags from your settings, the deck and the note type is passed
  to the Anki service **on your own computer**; for the same reason the
  phrase window passes its phrase there (see below).
- Data goes to the internet only for these features: downloading the
  dictionaries, finding video examples on our server when you press
  «Примеры», «С учётом моих знаний» or «Понятные», finding the part of
  speech and translating the sentence when you press «?», or translating the
  phrase in the phrase window (the text and its translation are then kept on
  your computer), enriching a card or a phrase you save to Anki, showing what
  your personal key allows and how much of it is used when you open Settings,
  route events from the Flib route player
  page (only with a personal key), showing YouTube videos (also by Anki, in
  cards you saved with a YouTube example), fonts of cards with our note types
  (loaded by Anki from Google Fonts), opening a video in the Flib player
  when you press «Открыть в плеере», pronunciation audio, and dictionaries or
  audio sources you add yourself. Other sites open only when you click a link to
  them (for example IMDb under a film clip).

## What is stored on your computer

In the browser's extension storage, local storage and IndexedDB:

- your settings, including server addresses, your AnkiConnect key if you set one,
  and your personal Flib key;
- the imported dictionaries;
- your Anki tags and per-profile preferences;
- route events not sent yet: at most 300, each with the route video id, the
  word, the event type, the time and a random event id (see «Route events»
  below);
- a note of which word, route video and event type were already recorded, so
  the same event is not recorded twice within 12 hours; notes older than 12
  hours are deleted when a new event is recorded and before each attempt to
  send the queue;
- when an answer of the Flib server pauses sending route events, the time the
  pause ends and a short hash of your key (not the key itself);
- the sentences and phrases you pressed «?» on, and the phrases translated when
  you saved them, with their Russian translations (the last 2000; nothing is
  stored for private windows). They are removed when you remove the extension or
  its data;
- the address of your Anki service: as a mark that our deck and note types were
  set up there, so that it is done once; and, with a short version mark of our
  card template, once you were told that your own «Phrases» template does not show
  the saved videos, so that you are told once;
- small technical records: whether the dictionaries are installed and when to try
  again after a failure, a copy of their settings while they are being replaced,
  whether the translation column is open, how dense the list of examples is, and
  where the divider of the phrase window stands.

Earlier versions kept a local log of words looked up on flib.club pages, with
the page address. It never left your computer. This version no longer writes
it and deletes it when the extension starts.

## Network requests

**Dictionaries — `pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev` (our storage).**
Automatically after installation, and when you press «Установить / обновить
словари Flib» in Settings. A plain download request, no personal data.

**Video examples — `cache.flib.club` (the Flib server; the address can be
changed in Settings).** Only when you press «Примеры» on a word, or
«С учётом моих знаний» (examples ranked by the words you know) or «Понятные»
(whole videos you can understand), and only if you have entered a personal
Flib key. Sent: the word and your personal key (for authorization). In the
phrase window (Alt+Shift+A) these buttons send the English text you selected
there, or the whole text if nothing is selected, at most 200 characters.
«Понятные» also sends the ids of the YouTube videos already shown in the
examples panel (at most 1000), so that they are not suggested again; while the
search runs, the extension asks the server for the result by the job id, and
cancels the job when you press «Отменить», close the panel or the search takes
too long. For
«С учётом моих знаний» and «Понятные» the server takes the words you know from
the route profile of this key on its own side; the extension does not send
them. For film examples the word list (words and language
only, no key) is uploaded to a temporary storage link the server returns,
then the chosen clips are downloaded. Without a key, «Примеры» asks your
local service instead (see below).

**Key rights and usage — the Flib server set in Settings (`cache.flib.club`
unless you changed the address).** Only if you have entered a personal Flib key:
when you open the Settings page, when you press «Обновить» («Refresh») in the
section «Ключ и права» («Key and access»), after you save the key or the address,
and when you return to the Settings tab or window and the key or the address has
changed meanwhile. Sent: your personal key (for authorization) and nothing else.
The server answers what the key allows, until when, and how much of its limits
is used; the server counts such a request as activity of the key. The answer is
shown on the page and is not stored.

**Part of speech and sentence translation — `cache.flib.club` (the same Flib
server).** Only when you press «?» in the card. Sent: the word under the mouse,
the sentence around it and your personal key (for authorization). The Flib
server passes the word and the sentence to OpenAI (ChatGPT) to find the part of
speech and to translate the sentence into Russian, and the answer counts
against the quota of your key. Nothing is sent until you press the button. In
the phrase window (Alt+Shift+A) «?» sends the whole English text of the window
and your personal key instead, and the server passes the text to OpenAI only to
translate it. A phrase longer than 1000 characters is not sent. The
sentence or phrase itself and its translation are then stored on your device
inside the extension: each record is the original text with its translation, for
the last 2000 texts, and nothing is stored for private windows. A phrase is also
not stored from a window inside another card or on the extension's own pages (such
as its search page). This lets other words of the same sentence, and the same
phrase, show the translation without a new request. The records are removed when
you remove the extension or its data. This feature contacts no other host.

**Card enrichment — `cache.flib.club` (the same Flib server).** Only when you
add a new word card of the note type «Yomitan Card Type» with «В Anki»
(«To Anki»), you have a personal key, and «Обогащать карточки через ChatGPT»
(«Enrich cards with ChatGPT») is on in Settings (it is on by default). Sent: the word, the example
sentence from the card, the translation and generated sentences (to make audio
for them), and your personal key. The Flib server passes the text to OpenAI
(ChatGPT) for examples, synonyms and a phrase card, and to ElevenLabs for audio;
the answers count against the quota of your key. The results are written into
your Anki: the card itself and, if enabled in settings, a reverse card and a phrase card. Turn the
option off and the extension sends nothing for this. If your Anki is connected
through Flibooster, a separate application, then without the option or without a
key Flibooster may enrich the card by its own settings.

**A phrase saved from the phrase window — `cache.flib.club` (the same Flib
server).** Only when you press «В Anki» there and a new note is added, you have a
personal key, and «Enrich cards with ChatGPT» is on. Sent, with your personal key:
the phrase, to make audio for it; if you selected a part of it as the blank, also
the phrase with a pause in its place, for the audio of the question; and, if the
translation is empty, the phrase to translate it. The Flib server passes the first
two to ElevenLabs and the last one to OpenAI (ChatGPT); the answers count against
the quota of your key and are written into the note in your Anki. A translation
already stored on your device is used without a request, and a new one is stored
there as for «?» above. For a phrase longer than 1000 characters nothing is sent.
Without a key, or with the option off, only what is in the window goes to your
Anki.

**Route events — the Flib server (the same address as for video examples; it
can be changed in Settings).** Only on the route player page of flib.club or
flibooster.ru (a `/player` page whose address names a route video), and only
if you have entered a personal Flib key. An event is recorded when the card
there shows a word, and when you open a blurred Russian translation in that
card. Cards opened from inside a card (by clicking a word in it) record
nothing, and nothing is recorded in private windows. Each event is tied to the route video open in the tab at the moment
of the event. Sent: the route video id, the looked-up word in dictionary
form, the event type (English definition shown or Russian translation opened),
the time of the event and your personal key (for authorization). Each event
also carries a random event id and a mark that it comes from this extension. Before
sending, the extension asks the Flib server, with your key, for the id of
your current route and sends it with the events. The page address, its title
and the page text are not sent. Why: your route takes the words you looked up
into account. The same word, event type and route video are recorded at most
once in 12 hours. Events wait in the extension's local storage until the
server receives them: at most 300 unsent events are kept, and events older
than 7 days are deleted when a new event is recorded and before each attempt to
send the queue. Queued events may be sent later, while you are on another
page; they carry nothing about that page. Without a key nothing is sent and the
events only wait there. All of it is removed with the extension
data (for example, when you remove the extension).

**YouTube — `i.ytimg.com`, `www.youtube-nocookie.com`, `www.youtube.com`.**
Thumbnails are loaded when the examples panel shows YouTube results; a video
plays only when you click it, in the privacy-enhanced (no-cookie) player, which
also uses other Google servers; `youtube.com` opens only if you click a link to
it: «Открыть на YouTube», the «YouTube» source under a dictionary example, the
link under a video in a saved card, or a button inside the player. YouTube
receives the video ID, for a video also its start second (and the end second,
when the example has one), the Referer `https://flib.club/` from the extension's
own player and, like any website, your IP address. In Chrome and Edge, an
embedded frame can see the site names (not the full addresses) of the pages it is
inside, so a player you open in the card can see which site you are on.

A YouTube example you tick and save to Anki (also from «Понятные») is stored in
the `flib_media` field as an embedded `youtube-nocookie.com` player (no
autoplay) with a link to the video on `youtube.com` under it. So Anki, or any
program that shows the note, and not the extension, contacts YouTube
(`www.youtube-nocookie.com` and the other Google servers its player uses)
whenever it shows the side of the card with that field (in the Flib card
template, the answer side), or opens the note in its editor or preview. YouTube
receives the video ID, the start second (and the end second, when the example has
one) and your IP address; the video plays only after a click. The player is set
to send YouTube at most the site part of the address of the page that shows the
card, without the path; in desktop Anki this is Anki's own local address
(`http://127.0.0.1:<port>/`). Other apps that show the card may send a different
address or none. None of this happens for examples you did not save.

**Flib player — `flib.club`.** The «Открыть в плеере» button on a YouTube
example is a link to `https://flib.club/player?v=<video id>` (with `&t=<start
second>` when the example has one). It opens in a new tab only when you click
it. The link carries no key, and no referrer is sent. As with any page you
open, flib.club receives your IP address and its own cookies if your browser
has them (for example, when you are signed in there).

**Google Fonts — `fonts.googleapis.com` and the font host it names.** This is not
a request of the extension. The style of the note types it installs in Anki
(«Yomitan Card Type», «ReverseDeck», «Phrases») loads fonts from there. So Anki, or
any program that shows such a card, contacts Google, and Google receives your IP
address.

**Pronunciation — `www.englishclass101.com`, `commons.wikimedia.org`,
`upload.wikimedia.org`, and the audio file host that englishclass101
returns.** When you press the speaker button, when you save a card whose audio
field is filled automatically, or, if you turn on automatic playback in
Settings, when a card is shown. Sent: the looked-up word. Cookies are
removed from the extension's lookup requests to these sites; the audio file
itself is then played like any media file. An audio source that you add yourself
gets what its address asks for: the word, its reading, the language.

**Your Anki — `127.0.0.1:8777` (your local Flibooster / Anki-Conf service)
and `127.0.0.1:8765` (AnkiConnect).** These addresses are on your own
computer; requests to them do not leave it unless you change the service
address in Settings to another host. If you set an AnkiConnect key, it goes with
every AnkiConnect request, also with the check that Anki is running. Flibooster is
a separate application: to answer these requests it may contact the Flib server with
its own credentials.

- When the extension starts or settings load or change, and again while you use
  it: a check of who answers at these addresses. For example, when a card is shown
  and the last check is older than 30 seconds, when a connection fails, and before
  a save if nobody answered.
- While Anki itself is open, the extension reads its note types and may change them
  without any save. When a word card is shown or the phrase window is opened, and
  your card settings use the type «Yomitan Card Type» (they do by default), it
  creates the deck «Flibooster» and the types «Yomitan Card Type», «ReverseDeck»
  and «Phrases» if they are missing, and adds missing fields to the first two. This
  is done once for each Anki address. At start, after settings change, when Anki is
  found again and when examples are requested through Flibooster, it also adds the
  missing fields `data` and `flib_media` to «Yomitan Card Type» or corrects the
  letter case of `flib_media`. After a field is added or renamed AnkiWeb asks for a
  full sync. Templates and styles of existing types are not changed by this.
- While Anki is closed none of these changes is made. The requests carry a mark that
  tells Flibooster not to write to the collection by itself; Flibooster older than
  1.0.108 may not know it.
- Every time a card is shown, if the check for duplicates is on (it is by default):
  to tell whether the word is already in Anki, the first field of the card that
  would be created (the word by default) is sent with the tags from your settings,
  the deck and the note type; the notes found are read.
- When a card is shown: saved video clips of that word are loaded from your
  local service.
- In the phrase window: when it is opened and when you change its English text or
  the selection in it, your Anki is asked for notes of the type «Phrases» in your
  deck with this phrase, and the notes found are read to compare them. Very short
  texts are not looked for until you press «В Anki».
- When you save a card or a phrase: the address of the page (site and path, without
  the query string), as Anki tags that start with `webpage_`. If you add the
  `{url}` or `{document-title}` marker to a card template, the full page address
  or the page title goes with the card fields. When a card is only shown, it goes
  only if the marker is in the first field.
- When you save a card: the card fields — the word, the sentence,
  the translation, chosen examples, audio, a screenshot if a card field uses it, and, if
  you granted clipboard access, the current clipboard text (the default card
  has a field for it).
- When you save a phrase: the phrase, its blank and translation, the videos you
  ticked (their files are stored in Anki), audio and tags, into a note of the type
  «Phrases». Before that the fields, the card template and the style of this note
  type are read. If the type does not exist, it is created together with the deck
  «Flibooster»; the deck of your cards is created if it is missing. An
  older «Phrases» type gets the field `flib_media`, and, if you have not edited its
  template and style (or Flibooster made the type without working ones), the new
  ones; a type that you edited gets only the field.
  Because of the new field AnkiWeb asks once for a full sync. If the phrase is in
  Anki already, only the ticked videos are added to its note.
- Phrases are saved only while Anki is open. With Anki closed the button «В Anki»
  stays in the phrase window, and a press asks you to open Anki. Word cards can
  still be saved with Anki closed if Flibooster is running: it writes them to the
  collection on your computer by itself. Flibooster older than 1.0.108 may do the
  same with phrases.
- «Проверить текст»: the copied text (first 1000 characters) or the phrase
  you are checking; marking words as known sends those words.
- «Примеры» or «С учётом моих знаний» without a personal key: the word (in
  the phrase window, the selected or the whole text).

**Dictionary sites (GitHub, Hugging Face and others) or an address you
type.** Only when you import or update a dictionary yourself. A plain
download request.

## What our server keeps

After a request is answered, the Flib server may keep some of what it received:

- «Понятные»: the words or phrases you searched for, with the record of the search;
- «Примеры»: the word or the text, in the server's log, when the search failed or
  found nothing that can be shown; such a line may also have the first characters
  of your key;
- audio for your cards: the sound and the first 120 characters of its text, so that
  the same sound is not made twice.

## Permissions

- **Access to all sites (`<all_urls>`)** — to read the text under the mouse
  on any page you open and to show the card there. Page content is
  read locally. Only the data described in this policy leaves the extension.
- **`storage`, `unlimitedStorage`** — settings and dictionaries (hundreds of
  megabytes) are kept locally.
- **`clipboardWrite`** — to copy a word or a card text when you ask for it.
- **`clipboardRead` (optional, asked when first needed)** — for «Проверить
  текст» (checks the copied text for words you do not know yet) and for the
  card field that stores the current clipboard text when you save a card.
- **`scripting`** — to show the card on web pages.
- **`offscreen`** — a hidden extension page for work a Manifest V3 service
  worker cannot do itself: clipboard access, the local dictionary database
  and word search, CSS sanitizing, adding videos to those already in a phrase
  note. It never loads remote pages. (Not used in the Firefox build.)
- **`contextMenus`** — the «Найти в Flib-club» item for selected text.
- **`declarativeNetRequest`** — sets the Referer `https://flib.club/` for the
  embedded YouTube player and removes cookies (and sets the Origin) on the
  extension's own pronunciation lookups. It applies only to requests the extension itself
  makes and does not read or change your browsing.

## Firefox data consent

When you install Flib-club, Firefox lists the kinds of data the extension
transmits, using its own standard names for the requests described above:

- **Website content** — the looked-up word, the sentence around it and the text
  of the phrase window. See «Video examples», «Part of speech», «Card enrichment»,
  «A phrase saved from the phrase window», «Route events», «Pronunciation» and
  «Your Anki».
- **Website activity** — on the Flib route player page only: that the card of a
  word was shown, or that its translation was opened. See «Route events».
- **Browsing activity** — the address of the page (site and path), saved as tags
  on a card or a phrase you save to Anki, and the route video id taken from the address of
  the Flib route player page. See «Your Anki» and «Route events».
- **Authentication information** — your personal Flib key, sent to the Flib
  server with a «Примеры», «С учётом моих знаний», «Понятные», «?», card or
  phrase enrichment, key rights or route events request; and your AnkiConnect key,
  if you set one, sent to your Anki service.

Copied text, used by «Проверить текст» and the clipboard card field, has no name
in the Firefox list. It is described in «Your Anki».

## Contact

Questions and requests: <https://github.com/xxxvita/yomitan_anki_conf/issues>
or `help@flib.club`.

---

## Кратко по-русски

Flib-club не собирает статистику, не следит за посещёнными страницами и не
передаёт данные рекламщикам. Текст страницы читается на вашем компьютере; в
интернет из него ничего не уходит, пока вы просто читаете, кроме событий
маршрута на странице плеера маршрута Flib (см. ниже). Чтобы показать,
есть ли слово в Anki, в ваш Anki-сервис на этом же компьютере (`127.0.0.1`)
передаются первое поле будущей карточки (по умолчанию слово), теги из настроек,
колода и тип заметки; окно фразы для того же передаёт
туда фразу. Если вы задали ключ AnkiConnect, он уходит с каждым запросом к
AnkiConnect. В интернет уходит только
нужное для функций: загрузка словарей (при установке и по кнопке обновления), поиск видеопримеров на
нашем сервере (по кнопкам «Примеры», «С учётом моих знаний» и «Понятные»;
передаются слово — в окне фразы выделенный текст или весь текст, если ничего не
выделено, — и ваш личный ключ, а для «Понятных» ещё идентификаторы уже
показанных роликов YouTube; знакомые слова сервер берёт из профиля маршрута
этого ключа на своей стороне, расширение их не отправляет),
часть речи и перевод предложения по кнопке «?» (передаются слово, предложение
вокруг него и ваш личный ключ; наш сервер передаёт слово и предложение в
OpenAI, ChatGPT; само предложение и его перевод хранятся в расширении на вашем
компьютере — последние 2000, в приватных окнах не хранятся), перевод фразы по
кнопке «?» в окне фразы (передаются вся фраза, не длиннее 1000 знаков, и ключ;
сервер передаёт фразу в OpenAI; фраза и перевод хранятся там же, но не из окна
внутри другой карточки и не с собственных страниц расширения),
права и расход личного ключа (ключ уходит на сервер из настроек, по умолчанию
cache.flib.club, при открытии настроек, по кнопке «Обновить», после смены ключа или
адреса и при возвращении на вкладку или в окно настроек, если ключ или адрес
сменились; для сервера это активность ключа, ответ не хранится),
обогащение новой карточки слова (тип «Yomitan Card Type») при «В Anki», если
включено в настройках и есть ключ (слово, пример,
перевод и ключ; сервер передаёт текст в OpenAI для примеров и в ElevenLabs для
озвучки, в Anki добавляются, если включены в настройках, обратная карточка и карточка-фраза),
обогащение фразы, которую вы добавили из окна фразы кнопкой «В Anki», если оно
включено и есть ключ (фраза — целиком и, если есть пропуск, с паузой вместо него —
передаётся через сервер в ElevenLabs для озвучки, а если перевода нет — в OpenAI;
фразы длиннее 1000 знаков не передаются),
превью и плеер YouTube (no-cookie), открытие ролика в плеере Flib по кнопке
«Открыть в плеере» и озвучка слова. Шрифты карточек с нашими типами заметок
загружает сама Anki с Google Fonts (`fonts.googleapis.com` и сервер шрифтов, который
он укажет): Google получает ваш IP-адрес. Пример YouTube, который вы отметили и
сохранили в Anki (в том числе из «Понятных»), попадает в поле `flib_media` как
встроенный плеер youtube-nocookie.com со ссылкой на ролик под ним: сам Anki
обращается к YouTube, когда показывает сторону карточки с этим полем (в шаблоне
Flib — обратную) или открывает заметку в редакторе или предпросмотре. YouTube
получает идентификатор ролика, секунду начала (и конца, если она есть), IP-адрес
и, возможно, адрес сайта, который показывает карточку, без пути (у Anki на
компьютере это его локальный адрес); видео играет только по щелчку. Кнопка
«Открыть в плеере» — ссылка на flib.club/player с идентификатором ролика и
секундой начала; она открывается только по щелчку, без ключа и без адреса
страницы. Как любой сайт, flib.club получает ваш IP-адрес и свои cookie, если
они есть в браузере. На странице плеера маршрута
flib.club / flibooster.ru, если введён личный ключ, на сервер Flib уходят события
маршрута: идентификатор ролика маршрута, открытого во вкладке в этот момент, слово
в словарной форме, тип события (показано английское определение или открыт
русский перевод), время, случайный номер события, пометка, что оно из этого
расширения, ваш ключ и номер вашего текущего маршрута; маршрут учитывает
подсмотренные слова.
Вложенные карточки и приватные окна событий не записывают. Неотправленные
события хранятся локально: не больше 300, а события старше 7 дней удаляются при
записи нового и перед каждой попыткой отправки.
Наш сервер может хранить: для «Понятных» — слова или фразы, которые вы искали; для
«Примеров», если поиск не удался или показать нечего, — слово или текст в журнале
сервера (рядом могут быть первые знаки ключа); для озвучки карточек — звук и первые
120 знаков его текста.
При сохранении карточки в
неё может попасть текст из буфера обмена, если вы разрешили доступ к нему, а
адрес страницы (сайт и путь) попадает в теги этой карточки.
Пока Anki открыта, расширение при показе карточки слова или окна фразы создаёт в ней
колоду «Flibooster» и типы «Yomitan Card Type», «ReverseDeck» и «Phrases», если их
нет, и добавляет недостающие поля в первые два — один раз для каждого адреса Anki и
только если в настройках карточек есть тип «Yomitan Card Type» (так по умолчанию).
Поля `data` и `flib_media` этого типа проверяются и добавляются также при запуске,
при смене настроек, когда Anki снова нашлась и при сборе примеров через Flibooster.
После добавления или переименования поля AnkiWeb попросит полную синхронизацию. Пока
Anki закрыта, ничего из этого не меняется.
Фраза сохраняется в вашу Anki карточкой типа «Phrases»: расширение читает поля,
шаблон и стиль этого типа, при надобности создаёт его, добавляет поле `flib_media`
и, если вы их не правили, обновляет шаблон и стиль. Из-за нового поля AnkiWeb один
раз попросит полную синхронизацию. Фраза сохраняется, только пока Anki открыта:
иначе кнопка остаётся, а нажатие просит открыть Anki. Карточки слов при закрытой
Anki сохраняет Flibooster, если он запущен: он сам пишет их в коллекцию на вашем
компьютере. До версии 1.0.108 Flibooster может так же записать фразу и типы заметок.
Подробности — выше.
