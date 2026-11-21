# Privacy Policy — Flib-club

_Last updated: 2026-11-21 (version 0.6.0)_

Flib-club is a browser extension for learning English: it shows the meaning
of a word under the mouse, finds video examples with that word, and saves
flashcards to Anki. It is a fork of
[Yomitan](https://github.com/yomidevs/yomitan).

## In short

- Flib-club does **not** collect analytics, does **not** track the pages you
  visit and does **not** sell or share data with advertisers.
- By default, the address of a page leaves the browser only when you save a
  card: it goes to your Anki service as tags on that card. The one exception is
  the route player page of flib.club / flibooster.ru: there the id of the route
  video, taken from the page address, is sent with route events (see below).
- Page text is read **locally** to find the word under the mouse. While you
  just read, nothing from the page is sent to the internet, except route
  events on the Flib route player page: the word shown in the card or whose
  translation you opened, with the route video id. To show whether a
  word is already in your Anki, the word and the sentence around it are
  passed to the Anki service **on your own computer** (see below).
- Data goes to the internet only for these features: downloading the
  dictionaries, finding video examples on our server when you press
  «Примеры», «С учётом моих знаний» or «Понятные», finding the part of
  speech and translating the sentence when you press «?» (the sentence and
  its translation are then kept on your computer),
  enriching a card you save to Anki, route events from the Flib route player
  page (only with a personal key), showing YouTube videos, pronunciation audio,
  and dictionaries or audio sources you add yourself.

## What is stored on your computer

In the browser's extension storage and IndexedDB:

- your settings, including server addresses and your personal Flib key;
- the imported dictionaries;
- your Anki tags and per-profile preferences;
- route events not sent yet: at most 300, each with the route video id, the
  word, the event type and the time (see «Route events» below);
- a note of which word, route video and event type were already recorded, so
  the same event is not recorded twice within 12 hours; notes older than 12
  hours are deleted when a new event is recorded and before each attempt to
  send the queue;
- when an answer of the Flib server pauses sending route events, the time the
  pause ends and a short hash of your key (not the key itself);
- the sentences you pressed «?» on and their Russian translations (the last
  2000; nothing is stored for private windows). They are removed when you
  remove the extension or its data.

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

**Part of speech and sentence translation — `cache.flib.club` (the same Flib
server).** Only when you press «?» in the card. Sent: the word under the mouse,
the sentence around it and your personal key (for authorization). The Flib
server passes the word and the sentence to OpenAI (ChatGPT) to find the part of
speech and to translate the sentence into Russian, and the answer counts
against the quota of your key. Nothing is sent until you press the button. The
sentence itself and its translation are then stored on your device inside the
extension: each record is the original sentence with its translation, for the
last 2000 sentences you pressed «?» on, and nothing is stored for private
windows. This lets other words of the same sentence show the translation
without a new request. The records are removed when you remove the extension
or its data. This feature contacts no other host.

**Card enrichment — `cache.flib.club` (the same Flib server).** Only when you
save a card to Anki with «+», you have a personal key, and «Enrich cards with
ChatGPT» is on in Settings (it is on by default). Sent: the word, the example
sentence from the card, the translation and generated sentences (to make audio
for them), and your personal key. The Flib server passes the text to OpenAI
(ChatGPT) for examples, synonyms and a phrase card, and to ElevenLabs for audio;
the answers count against the quota of your key. The results are written into
your Anki: the card itself and, if enabled in settings, a reverse card and a phrase card. Turn the
option off and only the dictionary text goes to Anki.

**Route events — the Flib server (the same address as for video examples; it
can be changed in Settings).** Only on the route player page of flib.club or
flibooster.ru (a `/player` page whose address names a route video), and only
if you have entered a personal Flib key. An event is recorded when the card
there shows a word, and when you open a blurred Russian translation in that
card. Cards opened from inside a card (by clicking a word in it) record
nothing, and nothing is recorded in private windows. Each event is tied to the route video open in the tab at the moment
of the event. Sent: the route video id, the looked-up word in dictionary
form, the event type (English definition shown or Russian translation opened),
the time of the event and your personal key (for authorization). Before
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
plays only when you click it, in the privacy-enhanced (no-cookie) player;
`youtube.com` opens only if you click «open on YouTube». YouTube receives the
video ID and, like any website, your IP address.

**Pronunciation — `www.englishclass101.com`, `commons.wikimedia.org`,
`upload.wikimedia.org`, and the audio file host that englishclass101
returns.** When you press the speaker button, or when you save a card whose
audio field is filled automatically. Sent: the looked-up word. Cookies are
removed from the extension's lookup requests to these sites; the audio file
itself is then played like any media file.

**Your Anki — `127.0.0.1:8777` (your local Flibooster / Anki-Conf service)
and `127.0.0.1:8765` (AnkiConnect).** These addresses are on your own
computer; requests to them do not leave it unless you change the service
address in Settings to another host. Flibooster is a separate application: to
answer these requests it may contact the Flib server with its own credentials.

- When the extension starts or settings load: a check that the service is
  running.
- Every time a card is shown: to tell whether the word is already in Anki,
  the card that would be created is checked for duplicates — the word, its
  definitions and the sentence around it on the page.
- When a card is shown: saved video clips of that word are loaded from your
  local service.
- When you save a card: the address of the page (site and path, without the
  query string), as Anki tags that start with `webpage_`. If you add the
  `{url}` or `{document-title}` marker to a card template, the full page address
  or the page title goes with the card fields, including when a card is shown.
- When you save or open a card: the card fields — the word, the sentence,
  the translation, chosen examples, audio, a screenshot if a card field uses it, and, if
  you granted clipboard access, the current clipboard text (the default card
  has a field for it).
- «Проверить текст»: the copied text (first 1000 characters) or the phrase
  you are checking; marking words as known sends those words.
- «Примеры» or «С учётом моих знаний» without a personal key: the word (in
  the phrase window, the selected or the whole text).

**Dictionary sites (GitHub, Hugging Face and others) or an address you
type.** Only when you import or update a dictionary yourself. A plain
download request.

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
  and word search, CSS sanitizing. It never loads remote pages. (Not used in
  the Firefox build.)
- **`contextMenus`** — the «Найти в Flib-club» item for selected text.
- **`declarativeNetRequest`** — sets the Referer `https://flib.club/` for the
  embedded YouTube player and removes cookies (and sets the Origin) on the
  extension's own pronunciation lookups. It applies only to requests the extension itself
  makes and does not read or change your browsing.

## Firefox data consent

When you install Flib-club, Firefox lists the kinds of data the extension
transmits, using its own standard names for the requests described above:

- **Website content** — the looked-up word and the sentence around it. See
  «Video examples», «Part of speech», «Card enrichment», «Route events»,
  «Pronunciation» and «Your Anki».
- **Browsing activity** — the address of the page (site and path), saved as tags
  on a card you save to Anki, and the route video id taken from the address of
  the Flib route player page. See «Your Anki» and «Route events».
- **Authentication information** — your personal Flib key, sent to the Flib
  server with a «Примеры», «С учётом моих знаний», «Понятные», «?», card
  enrichment or route events request.

Copied text, used by «Проверить текст» and the clipboard card field, has no name
in the Firefox list. It is described in «Your Anki».

## Contact

Questions and requests: <https://github.com/xxxvita/yomitan_anki_conf/issues>
or `help@flib.club`.

---

## Кратко по-русски

Flib-club не собирает статистику, не следит за посещёнными страницами и не
передаёт данные рекламщикам. Текст страницы читается на вашем компьютере; в
интернет из него ничего не уходит, пока вы просто читаете. Чтобы показать,
есть ли слово в Anki, слово, его значения и предложение вокруг него передаются в ваш
Anki-сервис на этом же компьютере (`127.0.0.1`). В интернет уходит только
нужное для функций: загрузка словарей (при установке и по кнопке обновления), поиск видеопримеров на
нашем сервере (по кнопкам «Примеры», «С учётом моих знаний» и «Понятные»;
передаются слово — в окне фразы выделенный текст или весь текст, если ничего не
выделено, — и ваш личный ключ, а для «Понятных» ещё идентификаторы уже
показанных роликов YouTube; знакомые слова сервер берёт из профиля маршрута
этого ключа на своей стороне, расширение их не отправляет),
часть речи и перевод предложения по кнопке «?» (передаются слово, предложение
вокруг него и ваш личный ключ; наш сервер передаёт слово и предложение в
OpenAI, ChatGPT; само предложение и его перевод хранятся в расширении на вашем
компьютере — последние 2000, в приватных окнах не хранятся),
обогащение карточки при «+», если включено в настройках (слово, пример,
перевод и ключ; сервер передаёт текст в OpenAI для примеров и в ElevenLabs для
озвучки, в Anki добавляются, если включены в настройках, обратная карточка и карточка-фраза),
превью и плеер YouTube (no-cookie) и озвучка слова. На странице плеера маршрута
flib.club / flibooster.ru, если введён личный ключ, на сервер Flib уходят события
маршрута: идентификатор ролика маршрута, открытого во вкладке в этот момент, слово
в словарной форме, тип события (показано английское определение или открыт
русский перевод), время и ваш ключ; маршрут учитывает подсмотренные слова.
Вложенные карточки и приватные окна событий не записывают. Неотправленные
события хранятся локально: не больше 300, а события старше 7 дней удаляются при
записи нового и перед каждой попыткой отправки.
При сохранении карточки в
неё может попасть текст из буфера обмена, если вы разрешили доступ к нему, а
адрес страницы (сайт и путь) попадает в теги этой карточки.
Подробности — выше.
