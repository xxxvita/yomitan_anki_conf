# Server requirements: YouTube examples ranked by what the user knows (two features)

Status: requirements from the owner (2026-11-20), relayed by the Flib-club extension session (src-cd). The public
HTTP shapes below are a PROPOSAL. Each server team designs its own spec in its own repo, gets the owner's approval as
usual, then implements. Order: the extension does the events transport first; these server features are prepared IN
PARALLEL.

## Owner decisions (verbatim intent)

- "Known words" = the words of the user's LAST route request. On the gateway that is `route_states.known_words` of the
  authenticated key (one row per key, replaced on every profile PUT/import).
- There are TWO different features:
  - **A. Panel examples ranked by knowledge (synchronous).** Used in the popup examples panel, and in the phrase window
    (Alt+Shift+A). A result is a FRAGMENT around the target. Rank fragments by how much of the fragment the user
    already knows.
  - **B. "Understandable" videos (asynchronous).** A result is a WHOLE video that contains the target and is as
    understandable as possible for this user as a whole. The client must be able to pass a set of videos to EXCLUDE
    (already shown or seen) from the answer.
- A target is either a **lemma** (word, phrasal verb, multi-word expression; split phrasal verbs count) or an **exact
  quote** ("as is" text the user selected).
- Up to **30 targets per call**. **Top 5** results per target.
- The extension also keeps a plain (not knowledge-ranked) search for the selected text or quote. So feature A needs a
  plain mode with quote support, too.

## Facts gathered on 2026-11-20 (from the gateway, daemon and route sessions; read from code)

- `/v1/examples` today:
  - one word per call, `limit ≤ 10`;
  - daemon kind `examples_by_word`: up to 40 candidate videos per lemma, one best cue per video, readability score;
  - budget 6 s; no batch, no knowledge ranking.
- The subtitle daemon runs on node `route_vds`, built from demon-route (option B: cues lemmatized at query time):
  - `examples_index.bin` holds only an INVERTED lemma → video index plus per-video meta. There is no forward video →
    lemmas table.
  - Cue text comes from `corpus.db`. Split phrasal verbs are matched by `CueHas`.
  - There is no cue-level lemma storage anywhere for YouTube.
- Exact-quote search exists only as FTS5 over the episode/film `lexicon.db` (off on the node). There is no FTS over the
  YouTube `corpus.db` cue text.
- The route daemon's `route_index.bin` has forward per-video lemma lists (`LessonLemmasByPuzzle`) and known-coverage
  scoring over the whole index (`IndexCorpus.ScoreKinds`). A lesson is a whole video.
- The owner keeps the subtitle daemon and the route daemon SEPARATE. No daemon may call the other. The gateway
  routes each kind to the daemon that serves it.
- `route_states.known_words`: gzip JSON of `{word, anki_interval_days, status, chunk, confidence}`, cap 200 000.
  Read it with `GetRouteState(keyID, withKnownWords=true)`. It only exists for the key that wrote the route profile.
- The data on the node is a static snapshot (2026-11-16).

## Feature A — panel examples ranked by knowledge (synchronous)

### Proposed public contract (gateway)

`POST /v1/examples/batch`

```json
{
  "targets": [
    { "text": "give up", "mode": "lemma" },
    { "text": "as far as I know", "mode": "quote" }
  ],
  "limit": 5,
  "rank": "known"
}
```

- `targets`: 1..30 items; `text` non-empty, at most 200 code points; `mode` is `lemma` or `quote`.
- `limit`: 1..5, default 5.
- `rank`: `known` or `plain`, default `plain`.
- `rank: known`: the gateway reads the key's known words and sends them ONCE per batch to the daemon (or a reference
  the daemon caches by `known_words_rev`), never per target. With no route profile for the key, the answer is ranked as
  `plain` and says `known_source: "none"`. This is not an error.

Response `200`:

```json
{
  "known_source": "route",
  "known_rev": 42,
  "partial": false,
  "results": [
    {
      "index": 0,
      "text": "give up",
      "mode": "lemma",
      "items": [
        {
          "video_id": "…",
          "from_ms": 0,
          "to_ms": 0,
          "text_en": "…",
          "text_ru": "…",
          "title": "…",
          "known_share": 0.93
        }
      ],
      "empty_reason": null
    }
  ]
}
```

- `empty_reason` per target: `not_in_corpus`, `no_usable_examples`, `budget_exhausted` or `bad_target`.
- **Budget:** a hard per-call budget (the gateway team proposes the number). Targets not finished in time come back with
  `budget_exhausted`, and `partial: true`. The UI shows what arrived.
- **Quota and charging:** the gateway team decides (per call vs per processed target). Failed or budget-exhausted
  targets are never charged.
- Field names follow today's `ExampleItem` so the extension can reuse its sanitizer.

### Daemon side (subtitle daemon, new kind, e.g. `examples_ranked`)

- Do NOT extend `examples_by_word`: it has a one-word contract and a 6 s budget.
- **Lemma mode:** the existing resolve → candidates → cue read path. Then score a WINDOW of ±N cues around the hit by
  the share of its lemmas that are in the known set, and combine that with the existing readability score. Return the
  top `limit`, at most one per channel.
- **Quote mode (new):**
  - normalize the quote and lemmatize it;
  - pick candidates by intersecting the posting lists of its rarest lemmas;
  - confirm a contiguous text match in the cues (case- and punctuation-insensitive);
  - score the same way as lemma mode.
- `rank: plain` keeps today's readability ranking.
- Known words: use the same definition of "known" as the route (which statuses count). The daemon team states the rule
  in its spec.
- Report measured latency for 30 targets with a realistic known set before the gateway fixes the budget.

## Feature B — "understandable" whole videos (asynchronous)

### Proposed public contract (gateway)

- `POST /v1/videos/understandable` → `202 {"job_id": "…"}`.
- `GET /v1/videos/understandable/{job_id}` → `{"status": "queued|running|done|failed", "results": […], "error": …}`.
- `DELETE /v1/videos/understandable/{job_id}` cancels.

Request:

```json
{
  "targets": [{ "text": "give up", "mode": "lemma" }],
  "limit": 5,
  "exclude_video_ids": ["dQw4w9WgXcQ"]
}
```

- `targets` 1..30 (or fewer if measurements say so — see open questions); `limit` 1..5.
- `exclude_video_ids`: up to 1000 YouTube ids. They are removed BEFORE the top-N is taken.
- Known words are REQUIRED here. With no route profile, the gateway proposes a coded error (e.g.
  `409 route_profile_missing`) so the UI can explain it.

Each result item:

```json
{
  "video_id": "…",
  "title": "…",
  "channel": "…",
  "duration_s": 0,
  "coverage": 0.97,
  "target_hits": [{ "from_ms": 0, "to_ms": 0, "text_en": "…" }]
}
```

- `coverage` is the share of known tokens in the whole video, by the route's own definition.
- `target_hits` lists the first few occurrences of the target, so the client can start playback at a hit.

### Daemon side (which daemon is the daemon team's call, with measurements)

- The data for whole-video coverage exists today only in the route daemon (`route_index.bin` forward lists,
  `ScoreKinds`). A NEW kind served by the route daemon process does not couple the two daemons: the gateway routes the
  kind there, and neither daemon calls the other. The alternative is a new forward section in `examples_index.bin` for
  the subtitle daemon (rebuild and resend to the node).
- It must not slow down route day builds. Report page-cache and CPU impact. A route build took 135 s cold and 20 s warm
  on 2026-11-20.
- Target hits within a chosen video can come from the subtitle-daemon-style cue read. The daemon team decides how
  without crossing daemons.

## Open questions for the server teams (answer in your specs)

1. Feature A: the per-call budget, the size of the cue window N, and whether 30 targets fit synchronously or need the
   partial-result mode.
2. Feature B: the max targets per job (30 is the owner's general cap), the job TTL, and polling guidance.
3. Which daemon serves B, and the expected latency per job.
4. "Known" definition: which `status`/`anki_interval_days` values count. It must be identical in A and B.
5. Quota and charging for A and B.
6. The demo key: allowed or not (B needs a route profile anyway).

## Out of scope here

- Extension UI (examples panel buttons, phrase window panel, the «Понятные» button): the extension session does it
  against the approved public contracts.
- The events transport (`/v1/route/external-events`): already live on the server; the extension work is in progress.
