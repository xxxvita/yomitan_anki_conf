# Privacy Policy — Flib-club

_Last updated: 2026-11-05 (version 0.4.2)_

Flib-club is a browser extension for learning English: it shows the meaning
of a word under the mouse, finds video examples with that word, and saves
flashcards to Anki. It is a fork of
[Yomitan](https://github.com/yomidevs/yomitan).

## In short

- Flib-club does **not** collect analytics, does **not** track the pages you
  visit and does **not** sell or share data with advertisers.
- The address of a page is used only when you save a card: it goes to your
  Anki service as tags on that card.
- Page text is read **locally** to find the word under the mouse. While you
  just read, nothing from the page is sent to the internet. To show whether a
  word is already in your Anki, the word and the sentence around it are
  passed to the Anki service **on your own computer** (see below).
- Data goes to the internet only for these features: downloading the
  dictionaries, finding video examples on our server when you press
  «Примеры», showing YouTube videos, pronunciation audio, and dictionaries or
  audio sources you add yourself.

## What is stored on your computer

In the browser's extension storage and IndexedDB:

- your settings, including server addresses and your personal Flib key;
- the imported dictionaries;
- your Anki tags and per-profile preferences;
- a local log of words you looked up on flib.club pages, with the page
  address (it stays on your computer and is never uploaded).

## Network requests

**Dictionaries — `pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev` (our storage).**
Automatically after installation, and when you press «Установить / обновить
словари Flib» in Settings. A plain download request, no personal data.

**Video examples — `cache.flib.club` (the Flib server; the address can be
changed in Settings).** Only when you press «Примеры» on a word, and only if
you have entered a personal Flib key. Sent: the word and your personal key
(for authorization). For film examples the word list (words and language
only, no key) is uploaded to a temporary storage link the server returns,
then the chosen clips are downloaded. Without a key, «Примеры» asks your
local service instead (see below).

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
  `{url}` marker to a card template, the full page address goes with the card
  fields, including when a card is shown.
- When you save or open a card: the card fields — the word, the sentence,
  the translation, chosen examples, audio, a screenshot if a card field uses it, and, if
  you granted clipboard access, the current clipboard text (the default card
  has a field for it).
- «Проверить текст»: the copied text (first 1000 characters) or the phrase
  you are checking; marking words as known sends those words.
- «Примеры» without a personal key: the word.

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
  «Video examples», «Pronunciation» and «Your Anki».
- **Browsing activity** — the address of the page (site and path), saved as tags
  on a card you save to Anki. See «Your Anki».
- **Authentication information** — your personal Flib key, sent to the Flib
  server with a «Примеры» request.

Copied text, used by «Проверить текст» and the clipboard card field, has no name
in the Firefox list. It is described in «Your Anki».

## Contact

Questions and requests: <https://github.com/xxxvita/yomitan_anki_conf/issues>
or `god.antigravity@gmail.com`.

---

## Кратко по-русски

Flib-club не собирает статистику, не следит за посещёнными страницами и не
передаёт данные рекламщикам. Текст страницы читается на вашем компьютере; в
интернет из него ничего не уходит, пока вы просто читаете. Чтобы показать,
есть ли слово в Anki, слово, его значения и предложение вокруг него передаются в ваш
Anki-сервис на этом же компьютере (`127.0.0.1`). В интернет уходит только
нужное для функций: загрузка словарей (при установке и по кнопке обновления), поиск видеопримеров на
нашем сервере (по кнопке «Примеры», передаются слово и ваш личный ключ),
превью и плеер YouTube (no-cookie) и озвучка слова. При сохранении карточки в
неё может попасть текст из буфера обмена, если вы разрешили доступ к нему, а
адрес страницы (сайт и путь) попадает в теги этой карточки.
Подробности — выше.
