# Privacy Policy — Flib-club

_Last updated: 2026-06-18_

Flib-club is a browser extension that helps you build a dictionary and an Anki
flashcard collection. It is a fork of [Yomitan](https://github.com/yomidevs/yomitan)
and inherits Yomitan's privacy model.

## What this extension does NOT do

- It does **not** send your browsing data, page content, or scanned text to any
  remote server controlled by us. We do not operate any backend.
- It does **not** track you, profile you, or run analytics.
- It does **not** transmit your clipboard, your Anki notes, or any of your
  configuration anywhere unsolicited.
- It does **not** include third-party advertising or telemetry SDKs.

## What this extension stores locally

Everything that Flib-club generates is kept on your own computer, in the
browser's extension storage and IndexedDB:

- Your settings (server URLs, hotkeys, user-tag list, etc.).
- Imported dictionaries (the same blobs as upstream Yomitan).
- Per-profile preferences.

Nothing in this list ever leaves your device unless _you_ send it somewhere via
one of the integrations below.

## Network endpoints Flib-club talks to

| Endpoint                                       | When                                                                 | What is sent                                                                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `http://127.0.0.1:8765/` (AnkiConnect)         | Only when you save a card / view notes / sync Anki                   | The note fields, deck name, tags, screenshot/audio you chose to attach. Loopback address.                                                                    |
| `http://127.0.0.1:8777/` (Anki-Conf Core)      | Only when you press the CheckWords button or add/remove a known word | The clipboard text (truncated to 1000 chars) for analysis; individual words you click on. Loopback address.                                                  |
| Audio sources you enable in Settings → Audio   | When a popup auto-plays audio or you click the speaker icon          | The term/reading you looked up. See [upstream privacy policy](https://github.com/yomidevs/yomitan/blob/master/PRIVACY-POLICY.md) for the per-source details. |
| Dictionary download URLs you initiate yourself | When you click "Install" on a dictionary                             | Whatever HTTP request your browser makes to fetch the dictionary archive.                                                                                    |

The first two are **loopback only** — packets never leave your machine. The
audio and dictionary calls only happen when _you_ explicitly trigger them.

## Permissions and why we need them

- **`<all_urls>` host permission**: Yomitan-style text scanning has to read text
  on whatever page you are reading. The extension reads page DOM locally; no
  page content is transmitted.
- **`clipboardRead` (optional)**: only used by the CheckWords button to send
  the clipboard's first 1000 characters to your local Anki-Conf service for
  lexicon analysis. Off by default; you grant it explicitly the first time you
  use CheckWords.
- **`clipboardWrite`**: used to copy term lookups into your clipboard on
  request.
- **`storage` / `unlimitedStorage`**: stores settings and dictionary data
  locally. No remote upload.
- **`scripting`**, **`offscreen`**, **`contextMenus`**: needed to inject the
  popup into pages and host non-DOM helpers (audio decoder, template renderer).
- **`declarativeNetRequest`**: removes a `Content-Security-Policy` header that
  would otherwise block our popup from loading on some sites. Does not read
  request bodies.
- **`nativeMessaging` (optional)**: only used if you enable the MeCab Japanese
  parser, which talks to a native helper installed by you.

## Contact

For questions specific to this fork, file an issue at
<https://github.com/xxxvita/yomitan_anki_conf/issues> or email
`god.antigravity@gmail.com`.

For privacy questions about the upstream Yomitan codebase, refer to the
[upstream privacy policy](https://github.com/yomidevs/yomitan/blob/master/PRIVACY-POLICY.md).
