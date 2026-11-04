# Privacy Policy — Flib-club

_Last updated: 2026-11-05 (version 0.4.1)_

Flib-club is a browser extension for learning English: it shows the meaning
of a word under the mouse, finds video examples with that word, and saves
flashcards to Anki. It is a fork of
[Yomitan](https://github.com/yomidevs/yomitan).

## In short

- Flib-club does **not** collect analytics, does **not** track the pages you
  visit and does **not** sell or share data with advertisers.
- Page text is read **locally** to find the word under the mouse. It is not
  uploaded anywhere while you just read.
- Data leaves your browser only for the features listed below: downloading
  the dictionaries, finding video examples on our server when you press
  «Примеры», pronunciation audio, and saving cards to your own Anki.

## What is stored on your computer

In the browser's extension storage and IndexedDB:

- your settings, including server addresses and your personal Flib key;
- the imported dictionaries;
- your Anki tags and per-profile preferences;
- a local log of words you looked up on flib.club pages (it stays on your
  computer and is never uploaded).

## Network requests

| Destination                                                                                                | When                                                                                                                                          | What is sent                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev` (our dictionary storage)                                     | Automatically after installation, and when you press «Установить / обновить словари Flib» in Settings                                         | A plain download request. No personal data.                                                                                                                                                 |
| `cache.flib.club` (the Flib server; the address can be changed in Settings)                                | Only when you press «Примеры» on a word and only if you have entered a personal Flib key                                                      | The word, and your personal key for authorization. For film examples the word list is uploaded to a temporary storage link the server provides; then the chosen clips are downloaded.       |
| `i.ytimg.com`, `www.youtube-nocookie.com`                                                                  | Video thumbnails are loaded when the examples panel shows YouTube results; a video is played only when you click it                           | The video ID in the address. The player is the privacy-enhanced (no-cookie) YouTube embed.                                                                                                  |
| Pronunciation sources: `www.englishclass101.com`, `commons.wikimedia.org` (Lingua Libre, Wiktionary audio) | When you press the speaker button, or when a card you save uses the audio field                                                               | The looked-up word. Cookies are not sent.                                                                                                                                                   |
| `127.0.0.1:8777` (your local Flibooster/Anki-Conf service) and `127.0.0.1:8765` (AnkiConnect)              | When the extension checks that the local service is running, when it shows whether a word is already in Anki, and when you save or open cards | The words being checked; for a saved card: the word, the sentence from the page, the translation, chosen examples, audio and a screenshot. Optional «Проверить текст» sends clipboard text. |
| Dictionary sites (GitHub, Hugging Face, others) or an address you type                                     | Only when you import or update a dictionary yourself                                                                                          | A plain download request.                                                                                                                                                                   |

The `127.0.0.1` addresses are on your own computer: these requests do not
leave it, unless you change the service address in Settings to another host.

## Permissions

- **Access to all sites (`<all_urls>`)** — to read the text under the mouse
  on any page you open and to show the card there. The page content is not
  transmitted.
- **`storage`, `unlimitedStorage`** — settings and dictionaries (hundreds of
  megabytes) are kept locally.
- **`clipboardWrite`** — to copy a word or a card text when you ask for it.
- **`clipboardRead` (optional, asked on first use)** — only for «Проверить
  текст», which checks the copied text for words you do not know yet.
- **`scripting`** — to show the card on web pages.
- **`offscreen`** — a hidden extension page for work a Manifest V3 service
  worker cannot do itself: clipboard access and the local dictionary database
  and word search. It never loads remote pages.
- **`contextMenus`** — the «Найти в Flib-club» item for selected text.
- **`declarativeNetRequest`** — sets the referrer for the embedded YouTube
  player so the video can play inside the extension; it does not read or
  change your browsing.

## Contact

Questions and requests: <https://github.com/xxxvita/yomitan_anki_conf/issues>
or `god.antigravity@gmail.com`.

---

## Кратко по-русски

Flib-club не собирает статистику, не следит за посещёнными страницами и не
передаёт данные рекламщикам. Текст страницы читается только на вашем
компьютере. В сеть уходит лишь то, что нужно для функций: загрузка словарей
(при установке), поиск видеопримеров на нашем сервере (по кнопке «Примеры»,
передаётся слово и ваш личный ключ), превью и плеер YouTube (no-cookie),
озвучка слова (по кнопке динамика) и сохранение карточек в ваш Anki на этом
же компьютере (`127.0.0.1`). Подробности — в таблице выше.
