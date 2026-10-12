# Spec: save gateway film clips (WebM) and YouTube links into Anki cards on «+»

Status: owner-approved 2026-10-12. Branches: extension `feat/gateway-clips-to-anki` (this repo), anki_conf
`feat/flib-media-field` (template side). Supersedes the "gateway clips are not saveable" note in
`HANDOFF-2026-10-12-gateway-examples.md` §2.A.

## 1. Spec (P8 step 1)

The user ticks film clips and/or YouTube examples in the gateway examples panel (nothing preselected). On «+»
the popup trims each ticked film clip to its window and transcodes it in a module Worker to WebM. It stores each
WebM in Anki through `storeMediaFile` (via a new backend API) and only then calls `addNote`/`updateNote`. The
note gets the HTML (videos with highlighted subtitles, film title/year/IMDb link, YouTube links) in the
`flib_media` field of the "Yomitan Card Type" note type. The extension appends that field idempotently; the
template that displays it is owned by anki_conf's canonical model JSON.

## 2. Owner decisions (2026-10-12)

| #   | Decision                                                                                                                                                                                                   | Rejected                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| D-1 | `<video>` in a field, WebM (VP9+Opus; VP8+Opus on Firefox), transcoded in the browser                                                                                                                      | MP4 (owner's Anki QtWebEngine cannot play H.264/AAC — measured `canPlayType`=''), `[sound:]`, Core ffmpeg, gateway WebM |
| D-2 | Selection by checkboxes, nothing preselected, film AND YouTube                                                                                                                                             | auto-select first clip                                                                                                  |
| D-3 | YouTube only as links `https://www.youtube.com/watch?v=<id>&t=<s>s` (cannot be cut)                                                                                                                        | —                                                                                                                       |
| D-4 | Quality "auto": never upscale; height > 720 → scale to 720 (keep aspect, even dims); explicit bitrate by output height (≤480: 0.8 Mbit/s, ≤720: 1.5 Mbit/s)                                                | quality presets (`QUALITY_*` give ~8 Mbit/s)                                                                            |
| D-5 | Auto field `flib_media` on "Yomitan Card Type" appended by the extension (same pattern as `data`); `{{flib_media}}` placed in the template by anki_conf canonical JSON (its «Обновить» button installs it) | extension editing templates (anki_conf «Обновить»/`--force`/theme `apply.sh` overwrite templates wholesale)             |

## 3. Facts the design relies on (VERIFIED 2026-10-12)

- Gateway clip window: file time = `lead_trim_sec + rel_ms/1000`; window = `[lead_trim_sec, lead_trim_sec +
trim_duration_sec]`. Movies arrive near-trimmed (lead 0.3–1.4 s); series arrive as fixed 20/40 s files with
  lead 2–16 s. `lead_trim_sec` is never 0.
- Anki media accounting (`rslib/src/text.rs` `HTML_MEDIA_TAGS`: img|audio|video|object|source with src|data):
  `<video src="x.webm">` counts as used; `src="x.webm#t=…"` is taken literally (file → Unused, deletable) —
  NEVER use a fragment; `<track src>` is NOT counted (a `.vtt` file would be reported Unused unless its name
  starts with `_`).
- mediabunny@1.60.0 (MPL-2.0, no Exhibit B → GPL-3 compatible) `Conversion` with `trim:{start,end}` handles
  non-keyframe starts. Chromium: 0.8–1.8 s for a 10–12 s window; Firefox VP9 14–16 s, VP8 3.4 s. Output plays
  in Anki 26.05 QtWebEngine (readyState 4, audio decoded, `<track>` cues shown). Prototype:
  `/tmp/claude-1000/-home-xxxvita-Work-yomitan-phrases-src/846df4cf-cb42-4a00-8815-7e8b566257f2/scratchpad/transcode/`
  (`web/transcode.js`, `web/worker.js`).
- Workers must be same-origin module files (CSP has no `worker-src`, falls back to `script-src 'self'`; blob:
  workers are blocked). Pattern: `new Worker(new URL('…', import.meta.url), {type: 'module'})`.
- Today the popup keeps only a blob URL per film card (`gateway-examples-panel.js` `_blobUrls`); the `Blob` and
  `ClipInfo` (`lead_trim_sec`, `source`) are dropped after render. YouTube `ExampleItem` is only captured in a
  click closure. The gateway panel has no checkboxes; `getSelectedClipIds()` returns `[]`.
- `AnkiConnect._invokeAt` puts the full `params` into `error.data` → a failed `storeMediaFile` would carry
  megabytes of base64 into logs/UI.
- `storeMediaFile` is in `RETRYABLE_ACTIONS`; `addNote` is not and must never be retried.

## 4. State enumeration (D2) — every field, its writer and its reader (D3)

| State                                                       | Owner         | Written                                                                       | Read by                             |
| ----------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| `FilmCard.blob` (MP4 Blob)                                  | gateway panel | `_loadCard` on media load                                                     | save → transcode input              |
| `FilmCard.window {startSec, endSec}`                        | gateway panel | `_loadCard` from `info.lead_trim_sec`, `clip.trimDurationSec`, media duration | transcode `trim`                    |
| `FilmCard.source {title, year, imdbUrl}`                    | gateway panel | `_loadCard` from `info.source`                                                | field HTML caption                  |
| `FilmCard.vtt` (highlighted WebVTT text, window-relative)   | gateway panel | built with the existing `example-subtitle-track.js`                           | field HTML `<track>`                |
| `_selectedFilm: Set<clipId>` / `_selectedYouTube: Set<key>` | gateway panel | checkbox toggle; cleared on word change/destroy                               | `getSelectedGatewayMedia()`         |
| `YouTubeCard {ref, startMs, textEn}`                        | gateway panel | `_buildYouTubeCard`                                                           | field HTML links                    |
| field `flib_media`                                          | Anki note     | `_saveAnkiNote` (add and overwrite)                                           | anki_conf template `{{flib_media}}` |
| media file `flib-<sha256>.webm`                             | Anki media    | new backend API → `storeMediaFile`                                            | `<video src>` in `flib_media`       |

Each blob must be released when the panel is destroyed (blob URLs revoked, Blob references dropped).

## 5. Edge cases (P8 step 2) — each needs a test

1. Ticked clip not ready yet (still polling / failed) when «+» is pressed → wait up to 20 s for ready, else abort
   the save with «Нарезка ещё не загрузилась» — no `addNote`.
2. WebCodecs / encoder unavailable (`VideoEncoder.isConfigSupported` false for VP9 and VP8, or no
   `AudioEncoder` opus), transcode throws, worker `error`, or exceeds 30 s → terminate the worker, abort the
   save with a clear message, no `addNote`.
3. Popup closed / new lookup / panel destroyed during transcode → `AbortSignal` aborts, worker terminated,
   nothing stored, no `addNote`.
4. Window out of bounds: `lead_trim_sec + trim_duration_sec` > file duration → clamp end to file duration;
   `trim_duration_sec` missing/NaN/≤0 → use `[lead, min(duration, lead + 30)]`; window length capped at 60 s;
   `lead_trim_sec` missing/NaN/<0 → 0.
5. `storeMediaFile` succeeds but `addNote` fails (duplicate, Anki down, route switch) → no retry of `addNote`;
   the orphan media file is harmless (same hash name on retry; Check Media cleans it).
6. Note type of the card format has no `flib_media` field (other note type, or bootstrap not done yet) while
   something is ticked → abort before transcoding with «В типе заметки нет поля flib_media».
7. Same clip saved twice / on two notes → identical filename by sha256 of the WebM bytes; no duplicates.
8. Failed `storeMediaFile` → the error that reaches logs/UI must NOT contain the base64 (strip `data`
   param in `error.data`).
9. Hostile/odd metadata: titles with `<`, `"`, `&`; `imdb_url` not matching
   `^https://www\.imdb\.com/title/tt\d+/?$`; YouTube ref not matching `^[A-Za-z0-9_-]{11}$`; subtitle text with
   `-->` or `<` → everything escaped; invalid URLs dropped (text kept), never injected raw into the field.
10. Overwrite path (`isOverwrite`, `updateNote`) → `flib_media` replaced by the new selection; if nothing is
    ticked, the existing field value is left untouched.
11. Nothing ticked → zero overhead: no worker spawned, no API calls, field untouched.
12. Firefox → VP8 is chosen (VP9 is too slow there); output still WebM.

## 6. Components

### Extension (`feat/gateway-clips-to-anki`)

- **T1 Transcode core.** Vendor `mediabunny@1.60.0` (`dev/lib/mediabunny.js` → `ext/lib/mediabunny.js` via
  `npm run build:libs`; legal entry in `ext/legal-npm.html` via `npm run license-report:html`). Pure module
  `ext/js/display/clip-transcode-util.js`: `computeClipWindow(...)` (edge case 4), `chooseOutputSettings(...)`
  (D-4, codec by encoder support), `flibMediaFileName(bytes)` (`flib-<sha256 hex>.webm`). Worker
  `ext/js/display/clip-transcode-worker.js` + main-thread client `clip-transcoder.js` (timeout 30 s,
  AbortSignal, terminate on any end). Unit tests for the pure functions; the Worker exercised with a fake.
- **T2 Backend.** API `flibStoreAnkiMedia {fileName, base64}` → validates `^flib-[0-9a-f]{64}\.webm$`, base64
  size ≤ 20 MB, sender is an extension page (same check as `flibSecretsSet`), then `this._anki.storeMediaFile`;
  AnkiConnect must answer exactly `fileName`, any other name → `flib_media_not_stored`. Strip base64 from
  `error.data` (edge case 8) and never put message params into the `API._invoke` "unexpected response" error.
  Generalise `video-examples-bootstrap.js` so it also brings `flib_media` to its exact name: exact → nothing;
  a case variant (`Flib_Media`) → `modelFieldRename` to `flib_media` (Anki template references such as
  `{{flib_media}}` are case-sensitive; AnkiConnect note-field keys are not, so the rename is for the template);
  absent → append without index; then verify by re-reading. `data` keeps its any-case policy (present in any
  case → nothing). An AnkiConnect without `modelFieldRename` still gets the appends; the rename is skipped and
  reported as `skippedRenames` (backend logs a warning), or `unsupported_anki_connect` when the rename is the
  only change due. API `flibAnkiModelHasField {modelName, fieldName}` → exact, case-sensitive match; `false`
  only when the model exists and lacks the field; AnkiConnect disabled/unreachable → `flib_anki_unavailable`,
  unknown model → `flib_anki_model_unknown`. Positive answers cached 60 s per server+model (not cached when the
  route changed mid-call; at most 32 entries), cleared after every bootstrap run.
- **T3 Panel + save.** Checkboxes on film and YouTube cards (D-2); keep §4 state; `getSelectedGatewayMedia()`;
  pure `buildFlibMediaFieldHtml(...)` in `gateway-examples-util.js` (escaping per edge case 9; `<track>` via
  `data:text/vtt;base64,…` if it works in Anki QtWebEngine — VERIFY in the isolated Anki harness
  `scratchpad/anki-play/`; otherwise store `_flib-<sha>.vtt`); `display-anki.js` `_saveAnkiNote`: after
  `_applySelectedClipsToNote`, call `_applySelectedGatewayMediaToNote` (transcode → store → set field) before
  add/update; progress state on the «+» button. Replace the «Сохранение в карточку — только для примеров через
  anki_conf» note.

Field HTML shape (one block per clip, then a YouTube list):

```html
<div class="flib-clip">
  <video controls preload="metadata" src="flib-<sha>.webm">
    <track
      kind="subtitles"
      srclang="en"
      label="EN"
      default
      src="data:text/vtt;base64,…"
    />
  </video>
  <div class="flib-clip-src">
    <a href="https://www.imdb.com/title/tt…/">Title</a> (2026)
  </div>
</div>
<ul class="flib-yt">
  <li>
    <a href="https://www.youtube.com/watch?v=ID&amp;t=12s"
      >▶ line with <b>word</b></a
    >
  </li>
</ul>
```

### anki_conf (`feat/flib-media-field`, worktree)

- Add field `flib_media` (last) to `internal/ankimodels/models/Yomitan Card Type.json`; place
  `<div class="flib-media">{{flib_media}}</div>` next to the `flib-ve-block` on Front and Back; CSS for
  `.flib-media video {max-width:100%}` and `video::cue(.hl)` highlight. Keep the theme pack
  (`themes/yomitan/01-lexicon-times`) consistent. Tests of `anki_bootstrap` status/update still pass; «Обновить»
  appends the field and pushes the template.

## 7. Out of scope (v1)

Phrase-note save path (`display-anki.js` ~1595); Core-side trimming; Core-collected clips (unchanged);
AnkiDroid verification; Windows Anki verification (owner may test in VM `win10-2` after T3).
