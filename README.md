# CreativeScope

Paste a public Google Drive link to an ad creative → get the audience-segment tags for the person in
focus plus a transcript of any spoken audio. Paste several links and it runs them as a batch and
exports the lot as CSV.

- **Live tool:** _(Pages URL)_
- **API:** _(Worker URL)_

| | |
| --- | --- |
| Backend | Cloudflare Workers — plain `fetch` handler, no framework, no dependencies |
| Frontend | Svelte 5 + Vite → Cloudflare Pages |
| Model | `gemini-3.7-flash`, falling back to `3.6-flash` → `flash-latest` |
| Transport | NDJSON progress stream over one `POST`, single or batch |

## Run

```bash
npm run install:all
echo "GEMINI_API_KEY=..." > worker/.dev.vars     # gitignored
npm run dev                                      # API :8788, UI :5174 (proxied)
```

```bash
npm test                                # 81 tests: 51 Worker, 30 UI (Testing Library)
npm run typecheck                       # tsc + svelte-check
node scripts/check-creatives.mjs        # scores the 6 briefed creatives
MOCK=nobody node scripts/mock-api.mjs   # fake API for UI work, spends no quota
```

`mock-api.mjs` serves both endpoints, fails the third item of any batch, and proxies `/api/preview`
to the real Drive so the video player still works.

## Deploy

```bash
cd worker && npx wrangler secret put GEMINI_API_KEY && npx wrangler deploy
cd ../web  && VITE_API_BASE_URL=https://<worker-url> npm run deploy
```

## API

`POST /api/analyze` — `{"url": "..."}` → `application/x-ndjson`, one event per line:

```jsonc
{"event":"progress","step":"transcoding","detail":"Gemini is preparing the video"}
{"event":"complete","result":{ /* see below */ }}
{"event":"failed","error":{"code":"drive_forbidden","message":"...","hint":"..."}}
```

```jsonc
{
  "source":  { "fileId", "fileName", "mimeType", "kind": "image|video", "byteSize" },
  "sceneSummary": "One sentence describing the shot.",
  "subject": {
    "present": true,
    "attributes": { "ethnicity","gender","ageBand","activity","hairColor","build","outfit" },
    "confidence": "high|medium|low",
    "note": "what limited the read, or null"
  },
  "speech":  { "detected": true, "language": "uk", "transcript": "..." },
  "meta":    { "model", "passes", "elapsedMs", "cached" }
}
```

Steps: `resolving → fetching → staging → transcoding → reading → transcribing`. Videos only emit
`staging`/`transcoding`; `transcribing` only appears on a salvage pass.

`POST /api/analyze/batch` — `{"urls": [...]}`, up to 12. Same stream, every event tagged with the
index of the creative it belongs to, so they interleave:

```jsonc
{"event":"queued","concurrency":3,"items":[{"id":0,"url":"..."}]}
{"event":"progress","id":1,"step":"transcoding"}
{"event":"complete","id":1,"result":{ /* identical shape */ }}
{"event":"failed","id":2,"error":{"code":"drive_forbidden","message":"...","hint":"..."}}
{"event":"done","summary":{"total":3,"succeeded":2,"failed":1}}
```

One bad link fails its own row and nothing else; the stream always ends on `done`.

Also: `GET /api/health`, and `GET /api/preview?src=<drive-url>` which proxies the file with `Range`
support so the UI can play the video inline.

Errors are `{code, message, hint}`. Codes: `not_a_drive_link`, `drive_unreachable`,
`drive_forbidden`, `media_type_unsupported`, `media_too_large`, `gemini_unavailable`,
`gemini_rate_limited`, `gemini_refused`, `gemini_malformed`, `gemini_timeout`.

## Architectural decisions

- **Worker + Pages as two deploys**, not one Worker serving static assets: costs a CORS header and a
  build-time `VITE_API_BASE_URL`, buys prompt redeploys that don't rebuild the frontend, and leaves
  the API curl-drivable.
- **No framework in the Worker.** Five routes don't justify Hono; zero dependencies keeps cold start low.
- **One Gemini call**, not two — the media is already uploaded and attended to. Exception: if pass one
  reports speech but returns an empty transcript, a second audio-only pass runs. Visual result is
  already banked, so the retry risks nothing.
- **Structured output enforced twice**: `responseSchema` pins every field to an enum, and a
  normaliser re-checks it, maps near-misses (`Caucasian`→`multiethnic`), and blanks one unreadable
  field instead of failing the whole analysis.
- **`propertyOrdering` forces `sceneSummary` before the labels** — describing the shot first
  measurably steadied the enum choices, at the cost of one short string.
- **Model fallback chain on capacity errors only** (503, quota). A safety refusal or malformed answer
  would just repeat on another model. `meta.model` reports who actually answered.
- **Content type from magic bytes, not the header.** Drive labels plenty of media
  `application/octet-stream`, which Gemini rejects. `peek()` reads 32 bytes, then returns a stream
  that still starts at byte zero. `Content-Length` is checked before any bytes are read.
- **NDJSON, not SSE.** The client needs a POST body, so `EventSource` was never an option, and SSE
  framing adds nothing over one JSON object per line.
- **The batch pool runs server-side, on one connection.** The obvious build is N parallel requests
  with a queue in the browser. But the scarce resource is the Gemini quota, and that's shared by
  every open tab — a per-tab limiter caps nothing. Three at a time, decided by the Worker, also
  means the client relays events instead of refereeing N races. Cost: a batch is one long-lived
  request, so a dropped connection loses the run rather than three-sixths of it.
- **Batch output is a CSV.** These tags exist to be pivoted in a spreadsheet, and a JSON blob asks
  the marketer to convert it first. Failed rows are exported too, with their error in the last
  column — a silently shorter file is the wrong way to report a broken link.

## Google Drive

All downloads go through `drive.usercontent.google.com/download?id=…&confirm=t` with a browser
`User-Agent` — Drive tailors its response to the client and otherwise tends to wrap bytes in HTML.
When the virus-scan interstitial appears anyway, the hidden form fields are replayed wholesale rather
than regexing for a `confirm` token, since newer versions also require `uuid`. Still HTML after that
→ the file isn't public, and the user is told to fix sharing.

**Integrity note:** the six briefed creatives are named after their own answers
(`asian female middle-aged.mp4`). They're uploaded to the Files API as `creative-<fileId>` so the
ground truth never enters the model's context. The UI still shows the real name.

## Prompt

`worker/src/instructions.ts`. Built around three problems:

1. **Refusals.** Dating creatives are wall-to-wall swimwear. Framed as "describe this person" Gemini
   declines often; framed as segment tagging of commercial stock footage it doesn't. Safety
   thresholds are also relaxed to `BLOCK_ONLY_HIGH`.
2. **A gap in the vocabulary.** The brief's ethnicity list has no `white`, so the prompt states
   outright that white/European-presenting subjects are `multiethnic`, and that `latina` should be
   chosen on features rather than avoided in favour of the catch-all.
3. **Reproducibility.** Temperature 0, `topP` 0.1, and a tie-breaker on every enum. The expensive
   failure isn't a wrong tag, it's one creative landing in two segments across two runs.

Tuning ran as a scored loop rather than by eye: the briefed filenames encode the expected
ethnicity/gender/age, so `scripts/check-creatives.mjs` turns a prompt edit into a number. Two things
that came out of it and stayed:

- **Age skews young unless argued out explicitly.** The first prompt under-aged five of six,
  including a visibly 60-plus couple returned as `middle-aged`. Per-band facial cues (nasolabial
  folds at rest, neck slackness, crepey skin), "a fit, well-lit 60-year-old is still older", and a
  tie-break toward the older band fixed most of it. Age is still the weakest attribute.
- **The model was chosen on that score, not on the changelog.** One creative sat at
  `multiethnic / middle-aged` on `gemini-3.6-flash` through every prompt revision; `3.7-flash` read
  it correctly first try.

## Known limitations

- **Free-tier quota is 20 requests/day per model.** Three passes over the six creatives exhaust it,
  and a full batch of twelve is most of a day in one click; the tool then returns
  `gemini_rate_limited` per row. The fallback chain buys ~60/day across three models.
  **Use a billing-enabled key for a public deploy**, or enable the KV cache below.
- **Multimodal output isn't deterministic at temperature 0.** Hair colour flipped `blonde`/`brown`
  across runs on one clip. Measured anecdotally, not systematically.
- **`gemini-3.7-flash` returns 503 under load.** Hence the fallback chain.

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Bare file ID pasted | Accepted — five link shapes plus a raw ID |
| Private file | Drive returns a login page → told to set "Anyone with the link" |
| Virus-scan interstitial | Hidden form fields replayed once, including `uuid` |
| `application/octet-stream` | Magic bytes, then filename extension |
| File > 60 MB | Rejected from `Content-Length` before download |
| Image > 13 MB | Files API instead of inline base64 |
| No person in frame | `subject.present: false`, transcript still shown |
| Voiceover over an empty scene | Audio judged independently of the visual |
| Music or sung lyrics only | `speechDetected: false` — the prompt excludes lyrics |
| Hallucinated audio on a still | Pinned off — images always return `transcript: null` |
| Speech flagged, transcript empty | Audio-only second pass; if it fails, reported as no speech |
| Non-English speech | Verbatim in original script + BCP-47 language badge |
| Safety block | `gemini_refused`, and the UI hides the retry button |
| Truncated JSON (`MAX_TOKENS`) | Distinguished from other malformed output |
| Client closes the tab | Stream writer detects the broken pipe and stops |
| Uploaded video in quota | Deleted via `ctx.waitUntil` after analysis |
| Same link twice in a batch | Deduplicated in the browser and again in the Worker |
| One dead link in a batch | That row fails alone; the rest finish and still export |
| Batch cancelled midway | Rows already returned stay on screen and stay exportable |
| More than 12 links | Rejected before any Gemini call, with the count in the message |

## How I used AI tools

Built with Cursor (Claude Opus 5) driving, which is how I work day to day.

- **Generated then edited:** Worker skeleton, Svelte components, CSS, and both test suites — 51
  Worker unit tests and 30 UI tests covering the render states, including the batch stream.
- **Verified instead of trusting recall.** Two things the model had wrong from memory: `gemini-2.5-flash`
  is retired for new keys, and `thinkingConfig` takes `thinkingLevel` on Gemini 3, not the
  `thinkingBudget` integer of 2.5. Both caught by probing the live API first. Same for the Files API —
  searching current docs is how I found resumable upload is the only supported protocol.
- **Prompt work as an eval loop, not a vibe.** `scripts/check-creatives.mjs` exists because I wanted a
  number. Noticing the filenames encode ground truth made tuning scoreable, and the age fix came out
  of that score. Where cases stayed wrong I pulled frames with `ffmpeg` and judged them myself
  rather than tuning until the model agreed with a filename.
- **Where I overrode it:** rewrote a buffer-then-sniff into a stream peek; split a single `AppError`
  into `code`/`message`/`hint` because the hint is the only actionable part; deleted a generated
  fallback that defaulted a missing `gender` to `female` — an invented default in a segment database
  is worse than a blank cell.

## Next five hours

1. **Turn on the KV cache.** Code written, binding commented into `wrangler.jsonc`; needs a namespace.
   Repeat analyses currently cost a full Gemini call each — on a free-tier key that's the difference
   between a working demo and a rate-limited one.
2. **A real eval set.** Thirty creatives with agreed labels, run on every prompt change, plus a
   run-to-run variance measurement.
3. **Make a batch survive a closed tab.** It currently lives inside one request. Workers Queues plus
   a job id, with the page reattaching to a job rather than owning it, is the honest version.
4. **Rate limiting and a spend cap.** Public with no auth is what the brief asked for, but batch
   turns one careless paste into twelve Gemini calls; a per-IP limit via Durable Objects would need
   to exist before it stayed public.
5. **Age calibration properly** — few-shot band examples, or a cheap second pass that only judges age,
   measured against the eval set rather than argued.
