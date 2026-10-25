# Redub Engine: Design Spec

**Status:** Draft v2 for review, 2026-10-25. v2 adds fixes from an independent three-lens review (timing/audio, protocol/engineering, vendor facts).

**What it is:** an AI engine that "beautifies" the speech in a video, **in the same language**:
- fixes grammar;
- removes fillers and false starts;
- improves wording;
- re-voices the speech with clean, high-quality audio that stays in sync with the original timeline.

English and Bangla come first.

**Supporting research:** [`docs/superpowers/research/2026-10-25-voice-redub-research-briefing.md`](../research/2026-10-25-voice-redub-research-briefing.md). The briefing was written before the product decisions below. Where the two disagree, this spec wins.

---

## 1. Product decisions (agreed with the product owner)

| # | Decision | Choice |
|---|---|---|
| D1 | Who uses it | Our own desktop video editor (Electron/Tauri). This project builds **only the engine**; the editor UI belongs to the editor team. |
| D2 | Where AI runs | **Cloud AI services only.** No local AI models, GPU or large downloads. Light audio processing (speech detection, stretch, mix) runs locally on CPU. |
| D3 | API keys | **Users bring their own keys.** The editor stores them in the OS keychain and hands them to the engine at runtime. There is no backend server of ours. |
| D4 | Engine form | **Python sidecar**, launched by the editor and controlled over stdin/stdout. |
| D5 | Approach | **Pluggable connectors with a small default set.** ElevenLabs and Anthropic keys are required. An Azure Speech key is optional and improves Bangla. More vendors can be added later as connectors. |
| D6 | Voice | **Both**, chosen per speaker: clone the original speaker, or pick a stock voice. |
| D7 | Render mode | **Full re-voice.** Every sentence is regenerated. If a sentence can't be fitted, the original audio is kept for it and flagged. |
| D8 | Review flow | **Automatic, fix afterwards.** The dub is generated in one go. The user then edits or regenerates any single sentence. |
| D9 | Lip-sync | **Not in v1.** Each sentence keeps its original start time, length and pauses. |
| D10 | Bangla style | **Bangladesh standard:** Bangla Academy spelling, colloquial *cholito* register, natural English loanwords kept as spoken. |
| D11 | Languages | English and Bangla (bn-BD first; bn-IN accepted), including code-mixed Banglish. |

## 2. Goals, non-goals, success criteria

### Goals
1. The editor hands over a 48 kHz dialogue WAV of N samples and gets back a dub stem of **exactly N samples**. In the stem, every re-voiced utterance starts within −20 / +40 ms of its **anchor**: the start of its first word that is not a pre-marked filler (§6.4).
2. The rewritten text is grammatical and natural and keeps the meaning. Names, numbers and negations are never changed.
3. Any single sentence can be edited and regenerated in seconds, without reprocessing the job. This works even after the editor or the engine restarts.
4. The engine can be shipped commercially: no GPL or non-commercial components are bundled.

### Non-goals (v1)
- Lip-sync and other video re-rendering.
- Translation to another language.
- Separating music from dialogue: v1 assumes the dialogue track holds speech plus room noise, with music on separate editor tracks.
- Local or offline AI models.
- Plugins for third-party editors (Premiere, Resolve and others).
- Real-time processing.
- Re-voicing overlapping speech (§6.4).

### Success criteria (checked on the bake-off set, §11.4)
| Metric | Target |
|---|---|
| Utterances placed with take outcome `fit` (no `stretch_flagged`, no `overflow_review`) | ≥ 85% (English), ≥ 75% (Bangla) |
| Start error: onset detected in the stem (§6.12) − anchor, median / p95 | ≤ 20 ms / ≤ 40 ms. The bake-off also measures against hand labels. |
| Meaning preserved (native rater, 1–5) | ≥ 4.5 on ≥ 95% of utterances |
| Voice naturalness (blind rating, 1–5) | ≥ 4.0 English, ≥ 3.8 Bangla |
| Stem sample count == N | 100% |
| Cost per minute of video at list prices (§10) | ≤ $0.60 |

## 3. Architecture

```
┌──────────────── Editor (Electron or Tauri) ─────────────────┐
│ UI · stores user keys in OS keychain · places returned audio │
└──────────────┬───────────────────────────────────────────────┘
               │ spawn; JSON-RPC 2.0 as NDJSON over stdin/stdout
               │ (audio is exchanged as file paths, never through the pipe)
┌──────────────▼──────────────── redub-engine (Python 3.13) ───┐
│ rpc/        NDJSON loop, per-request tasks, events            │
│ jobs/       job store (SQLite + audio files), states, versions│
│ pipeline/   ingest → vad → transcribe → segment → voices →    │
│             rewrite → synthesize → fit → place → mix          │
│ timing/     VAD regions, anchors, slots, budgets, duration    │
│             model, pause detection, piece fitting             │
│ lang/       language packs: en, bn                            │
│ connectors/ asr/ llm/ tts/ isolate/ (capability-declared)     │
│ audio/      ffmpeg I/O, loudness, fades, limiter, true peak   │
│ export/     stem, clips, manifest, SRT/VTT, changes, QC       │
│ cli/        `redub` command for use without an editor         │
└───────────────────────────────────────────────────────────────┘
        │ HTTPS (user's keys)
        ▼
  ElevenLabs: Scribe v2 transcription · Eleven v4 voices + cloning · Voice Isolator
  Anthropic:  Claude Opus 5.5 rewrite · Claude Haiku 5.5 meaning check
  Azure Speech (optional): MAI-Transcribe-2 · bn-BD / bn-IN / en neural voices
```

**Code location:** a self-contained `redub-engine/` directory in this repository. It does not depend on the rest of the repo, so it can move to its own repository unchanged.

### 3.1 Module responsibilities

| Module | Does | Depends on |
|---|---|---|
| `rpc` | <ul><li>Reads one JSON object per stdin line.</li><li>Runs **each request in its own asyncio task**. Responses can arrive out of order and are matched by `id`, so `job.cancel` and `job.get` are answered while other work on the same job is in flight.</li><li>Writes responses and events through a single locked writer.</li><li>Logs go only to stderr.</li><li>When stdin closes, it persists running jobs as `paused` and exits.</li></ul> | `jobs`, `pipeline` |
| `jobs` | <ul><li>Persists the job, speakers, segments, versions, takes, frozen gains, duration-model snapshots and spend in `job_dir/job.sqlite`.</li><li>Records per-segment stage completion, which resume uses (§4.2).</li><li>No cache is keyed on input hashes. Explicit retries always make new calls.</li></ul> | stdlib `sqlite3` |
| `pipeline` | Orchestrates the stages, holds per-provider concurrency limits, applies the take loop and fallback chain, and enforces the spend cap. | everything below |
| `timing` | All time math, in integer samples at 48 kHz. | `lang`, `audio` |
| `lang/en`, `lang/bn` | <ul><li>Display-text and TTS-text normalisation.</li><li>Syllable counting.</li><li>Filler lists.</li><li>Rewrite rules and the spelling table.</li></ul> | none (pure Python) |
| `connectors` | One adapter per vendor service. Each implements an interface from §5 and declares capabilities. | `httpx2`, `anthropic` |
| `audio` | <ul><li>Decoding and encoding via ffmpeg.</li><li>Fades, gain and BS.1770 loudness in numpy (K-weighting biquads, no scipy).</li><li>4×-oversampled true-peak meter.</li><li>The limiter.</li></ul> | numpy, soundfile, ffmpeg |
| `export` | All deliverables in §8. | `audio`, `jobs` |

### 3.2 Runtime and dependencies

| Purpose | Choice | Licence |
|---|---|---|
| Runtime | Python 3.13 | PSF |
| HTTP | `httpx2`, async. This is the httpx fork that `anthropic` ≥ 2 depends on; all connectors share it, so only one HTTP stack ships. | BSD-3 |
| Claude | `anthropic` official SDK, pinned `>=2.3,<3` | Apache-2.0 |
| Schemas | `pydantic` v2 | MIT |
| Arrays and WAV I/O | `numpy`; `soundfile`, which bundles libsndfile as a shared library | BSD; LGPL-2.1 (shared library) |
| Grapheme-aware text | `regex` (`\X`) | Apache-2.0 AND CNRI-Python |
| Time-stretch | `python-stretch` 0.3.x (Signalsmith Stretch) | MIT |
| Speech detection | `silero-vad-lite` 0.4.x. Bundles the Silero v6.2.3 model and ONNX Runtime 1.19, with no torch; its wheels include Intel and Apple-silicon Macs. | MIT (include both bundled notices) |
| Media tool | `ffmpeg` as a **separate executable**, run by subprocess (§3.3) | LGPL-3.0-or-later |

**ffmpeg builds:**
- **Windows:** BtbN `win64-lgpl`, taken from a month-end release, which BtbN keeps for 2 years. Mirror it, with the matching BtbN commit and all dependency sources, into our artefact store.
- **macOS:** built in our CI with `--enable-version3` and without `--enable-gpl` or `--enable-nonfree`, so both platforms carry the same licence.
- Every pipeline filter we use is LGPL: `atempo`, `alimiter`, `aresample`, `loudnorm`, `ebur128`, `afade`.

**Excluded** (GPL or non-commercial licences, or they need torch):
- Rubber Band, `pyrubberband`, `pedalboard`, `pytsmod`;
- `phonemizer` and espeak-ng;
- the `silero-vad` pip package (it requires torch);
- PyAV wheels (they bundle x264 and x265);
- the `cmudict` and `syllables` pip packages;
- the csebuetnlp normaliser.

The `num2words` package (LGPL) is used in tests only. The repo keeps `THIRD_PARTY_LICENSES.md`, plus the ffmpeg LGPL notice and source offer. CI fails when a GPL, AGPL or NC dependency is added.

### 3.3 Packaging and launch

**Build:** PyInstaller 6.x, **onedir, console mode**.
- Bootloader built from source, which reduces antivirus false positives.
- Flags: `--noupx`, `--python-option u`, `--python-option "X utf8"`.
- At startup the engine calls `sys.stdout.reconfigure(encoding="utf-8", newline="\n")` and flushes after every message. Without this, Windows pipes use the ANSI code page and break Bangla text.
- The frozen entry point calls `multiprocessing.freeze_support()` (needed by §3.4).
- **Onefile is not used.** It extracts to a temp folder on every launch, leaves folders behind when killed, and its embedded libraries can't be re-signed.
- **Windowed mode is not used.** It sets `sys.stdout` to `None`.

**Targets:** Windows 10/11 x64; macOS 13+ on arm64 and x64.

**Signing:** the engine folder is signed before it goes to the editor's bundler, because Tauri does not sign `bundle.resources`.
- **macOS:** every Mach-O file, ffmpeg included, is signed with Developer ID, hardened runtime and a secure timestamp, then notarized with `notarytool`.
- **Windows:** every `.exe`, `.dll` and `.pyd` is signed with Artifact Signing. Smart App Control blocks unsigned code, and EV certificates no longer bypass SmartScreen.

**Electron:**
- Ship the onedir through `extraResources` (electron-builder) or `packagerConfig.extraResource` (Forge). Resolve its path via `process.resourcesPath`.
- Launch with `child_process.spawn(exe, [], {stdio:'pipe', windowsHide:true, env:{...minimalEnv, PYTHONUTF8:'1', PYTHONUNBUFFERED:'1'}})`. `utilityProcess` can't run native binaries.
- Read stdout line by line and always drain stderr.
- To quit, send `engine.shutdown`, then close stdin. On Windows, `kill()` is always forceful.

**Tauri v2:**
- Ship the signed onedir as `bundle.resources`.
- Spawn it from Rust with the shell plugin's `Command` and a `$RESOURCE/...` path, behind narrow `#[tauri::command]` functions. The webview holds no shell permissions.
- Capabilities needed: `shell:allow-spawn` (with an argument validator), `shell:allow-stdin-write`, `shell:allow-kill`.

**Startup target:** `engine.hello` is answered in under 2 s on a mid-range laptop.

### 3.4 Concurrency
- **Event loop:** a single asyncio loop.
- **Input:** a reader thread feeds stdin lines into an asyncio queue.
- **Network calls:** `httpx2.AsyncClient`, plus `AsyncAnthropic`.
- **VAD and mixing:** a thread pool.
- **Time-stretch:** a `ProcessPoolExecutor` with 2 workers, each holding one `Signalsmith.Stretch` (`preset(1, 48000)`). `python-stretch` 0.3.x holds the GIL during `process()`, so a thread pool would block the event loop.
- **Per-provider semaphores:**
  - ElevenLabs: the plan tier's non-Flash TTS limit (Free 2, Starter 3, Creator 5, Pro 10, Scale/Business 15). It adapts from the `maximum-concurrent-requests` response header.
  - Azure: 4.
  - Anthropic: 4.
- Utterances are processed in parallel within those limits.

### 3.5 Determinism

The same inputs and the same provider responses must give the same output:
- **Duration-model snapshot:** each voice's duration-model parameters (§6.7) are snapshotted when a `job.run` or `segment.*` call starts, and stored in the job. Refits only take effect from the next call.
- **Neighbour text:** during `job.run`, `previous_text` and `next_text` are always the neighbours' *original* text. During `segment.*` calls they are the neighbours' current text.
- **Seeds:** `hash(segment_id, version, take_index) mod 2^32`.

## 4. Editor ↔ engine protocol

### 4.0 Conventions
- **Transport:** JSON-RPC 2.0, one JSON object per line (NDJSON), UTF-8 (`ensure_ascii=False`). Lines are at most 16 MB. Only protocol messages go to stdout.
- **Time:** every time value is an **integer sample index at 48 000 Hz, 0-based from the first sample of `dialogue_path`**. This covers segments, cuts, `manifest.json` and caption times.
  - `timeline.start_sample` is the timeline position of file sample 0. It is used only for the `bext` TimeReference.
  - Frame rate is a rational string (e.g. `"30000/1001"`) with a `drop_frame` flag. The engine never computes timecode; the editor converts.
- **Versioning:** `engine.hello` returns `protocol: 1`. Every breaking change increments it.
- **Keys:** `engine.configure` may be called again at any time, for example after `auth_failed`. New keys apply to the next provider call.

### 4.1 Requests

| Method | Params | Result | Allowed in |
|---|---|---|---|
| `engine.hello` | none | `{version, protocol, connectors:[{id, kind, static_caps}]}`. Capabilities that depend on probes are `null` here. | any |
| `engine.configure` | `{keys:{elevenlabs, anthropic, azure?:{key, region}}, prices?, defaults?}` | `{ok}` | any |
| `providers.check` | none | Per provider: `{ok, error?, account?, probes}`. For ElevenLabs, `account` is `{tier, can_clone, voice_slots_free, add_edits_left}`. Runs the probes in §5.2. | any |
| `voices.list_stock` | `{language}` | `[StockVoice]` (§5) | any |
| `job.create` | §4.4 | `{job_id}`. The job is persisted in `job_dir`. | n/a |
| `job.open` | `{job_dir}` | `{job_id, status}`. Required after an engine restart before any other call on that job; otherwise those calls return `job_not_found`. A job found in `running` is persisted as `paused`. | n/a |
| `job.analyze` | `{job_id}` | `{language, n_samples, speakers:[Speaker], segments:[Segment], estimate:{usd_low, usd_high, by_provider}}`. Long-running; emits `job.progress`. | created |
| `speakers.set_voice` | `{job_id, speaker_id, mode:"clone"\|"stock"\|"existing", voice?:{provider, voice_id, public_owner_id?}, fallback_voice?:{provider, voice_id}, gender?:"female"\|"male", consent?:{confirmed_by, confirmed_at}}` | `{speaker}` | analyzed, paused, cancelled |
| `job.run` | `{job_id, spend_cap_usd?}` | `{ok}` immediately; the outcome arrives as events. | analyzed, paused, cancelled |
| `job.cancel` | `{job_id}` | `{ok}`, sent only after in-flight provider requests are aborted, pipeline tasks have stopped and the new state is persisted. | analyzing, running, paused |
| `job.get` | `{job_id}` | `{job_id, status, language, n_samples, speakers, segments, spend, error?}` | any |
| `segment.update_text` | `{job_id, segment_id, text}` | `{segment, warning?:{code:"text_too_long", syllables, max_syllables}}` | completed |
| `segment.regenerate` | `{job_id, segment_id, mode:"same_text"\|"new_rewrite"}` | `{segment}` | completed |
| `segment.revert` | `{job_id, segment_id}` | `{segment}` | completed |
| `segment.use_original` | `{job_id, segment_id, clean?:bool}` | `{segment}` | completed |
| `job.export` | `{job_id, formats:[…], out_dir?}` | `{paths:{…}}` (§8). Deliverables are written **only** here. | completed |
| `job.delete` | `{job_id, keep_voices?:bool}` | `{ok, kept_voices?:[{speaker_id, provider, voice_id}]}` | any except analyzing, running |
| `engine.shutdown` | none | `{ok}`. Running jobs are persisted as `paused`, then the engine exits. | any |

**Voice requirements before `job.run`:**
- Every speaker must have a voice set with `speakers.set_voice`. If one doesn't, `job.run` returns `invalid_params {field:"speaker_id", reason:"voice_not_set"}`.
- `job.analyze` returns `suggested_mode` for each speaker, so the editor can offer one-click defaults.
- `mode:"clone"` requires `consent`.
- `mode:"stock"` and `mode:"existing"` require `voice`.

**Spend cap:** `spend_cap_usd` caps the job's **total** spend across all runs and `segment.*` calls.
- Before each provider call, the engine reserves that call's estimated cost. It pauses with `spend_cap_reached` if `spent + reserved + estimate > cap`.
- Calls already in flight finish, and their cost is counted.
- A new value passed on resume replaces the old cap; omitting it keeps the old cap.
- A `segment.*` call that would exceed the cap returns `spend_cap_reached`, and the job stays `completed`.

### 4.2 Job states

| State | How it is entered | Leaves to |
|---|---|---|
| `created` | `job.create`; a failed or cancelled `job.analyze` | `analyzing` |
| `analyzing` | `job.analyze` | `analyzed` on success. Otherwise back to `created`; the error is the response to `job.analyze`. |
| `analyzed` | analysis done | `running` |
| `running` | `job.run` | `completed`, `paused`, `cancelled`, `failed` |
| `paused` | `quota_exhausted`, `spend_cap_reached` or `auth_failed` during a run; `engine.shutdown` or stdin EOF; `job.open` finding the job `running` | `running` (resume), `cancelled` |
| `cancelled` | `job.cancel` | `running` (resume) |
| `completed` | all segments resolved | terminal for the pipeline; only `segment.*`, `job.export` and `job.delete` |
| `failed` | internal error: disk full, decode failure mid-run, stem-length assertion | terminal; only `job.get` and `job.delete` |

**Rules:**
- **Resume:** resuming (`job.run` on `paused` or `cancelled`) skips any stage that a segment has already completed, using the completion records in the job store.
- **Voice changes:** changing a voice while `paused` or `cancelled` discards that speaker's unfinished takes only.
- **Errors in `segment.*` calls:** they come back **only** as that request's error response, including `quota_exhausted`, `spend_cap_reached` and `auth_failed`. The job stays `completed`, and the segment keeps its current version.
- **One call per segment:** a second `segment.*` call on a segment that already has one in flight returns `job_state_conflict {status:"segment_busy"}`.
- **Export and delete:** `job.export` and `job.delete` wait for any in-flight `segment.*` calls on the job to finish.

### 4.3 Events (engine → editor)

| Event | Meaning |
|---|---|
| `job.progress {job_id, stage, done, total}` | `stage` is one of `ingest`, `vad`, `transcribe`, `segment`, `voices`, `rewrite`, `synthesize`, `mix`. `done`/`total` count utterances (speakers for `voices`; 1 for single-step stages). |
| `segment.updated {job_id, segment}` | A segment changed. |
| `job.completed {job_id}` | Terminal event of a successful run. |
| `job.paused {job_id, error}` | The run stopped and can be resumed. |
| `job.cancelled {job_id}` | Cancellation finished. |
| `job.failed {job_id, error}` | Internal error; the job is terminal. |
| `provider.warning {provider, code, message}` | Examples: `free_tier_no_commercial_licence`, `price_promo_ending`, `rate_limited`, `low_quota`. |

- `error` is a JSON-RPC error object `{code, message, data}` using the codes in §4.7.
- The engine persists the new state **before** it writes the event.
- The terminal event of a run (`completed`, `paused`, `cancelled` or `failed`) always comes after every `segment.updated` from that run.

### 4.4 `job.create` params
```json
{
  "job_dir": "/path/chosen/by/editor/job-0001",
  "dialogue_path": "/path/dialogue.wav",
  "speaker_tracks": [{"path": "/path/mic1.wav", "label": "Host"}],
  "timeline": {"start_sample": 172800000, "fps": "30000/1001", "drop_frame": true, "cuts": [1441440]},
  "language": "auto",
  "locale": "bn-BD",
  "strictness": "clean",
  "ambience": "clean",
  "glossary": ["Qbexel", "API"],
  "options": {"tolerance": 0.10, "min_fill": 0.75, "min_clone_seconds": 30}
}
```

| Field | Rules |
|---|---|
| `dialogue_path` | **Required format:** WAV (PCM 16/24/32-bit or float32) at **48 000 Hz**. Stereo is down-mixed to mono. Anything else returns `invalid_input {reason:"not_wav_48k"}`. N is its sample count. |
| `speaker_tracks` | Optional. Same format and the same N. When given, diarization is off (§6.3). |
| `timeline.cuts` | Optional. Shot-cut positions (file-relative samples). An utterance never borrows silence across a cut. |
| `language` | `"auto"`, `"en"` or `"bn"` |
| `strictness` | `"light"`, `"clean"` or `"polish"` (§6.8) |
| `ambience` | `"clean"`: true silence between utterances. `"keep"`: the original room tone fills the gaps (§6.12). |

### 4.5 Speaker object
```json
{ "id": "S1", "label": "Host", "gender": null,
  "speech_seconds": 412.3, "clean_speech_seconds": 301.0,
  "clone_eligible": true, "clone_block_reason": null,
  "suggested_mode": "clone",
  "voice": {"mode": "clone", "provider": "elevenlabs", "voice_id": "…", "public_owner_id": null, "created_by_job": true},
  "fallback_voice": {"provider": "azure", "voice_id": "bn-BD-PradeepNeural"},
  "consent": {"confirmed_by": "Riad", "confirmed_at": "2026-10-25T10:00:00Z"} }
```
- `clone_block_reason` is one of `too_little_speech`, `plan_no_cloning`, `no_voice_slots` or `no_add_edits_left`.
- When `clone_eligible` is false, `suggested_mode` is `"stock"`, and every segment of that speaker carries the `clone_unavailable` flag.

### 4.6 Segment object
```json
{
  "id": "u_0042",
  "speaker_id": "S1",
  "src":    {"start": 1234560, "end": 1401600},
  "anchor": 1243200,
  "slot":   {"start": 1232160, "end": 1420800},
  "phrases": [{"start": 1234560, "end": 1310400, "anchor": 1243200, "empty": false},
              {"start": 1329600, "end": 1401600, "anchor": 1329600, "empty": false}],
  "original_text": "uh so we we gonna start the the video now",
  "text": "So, we're going to start the video now.",
  "version": 2,
  "status": "done",
  "take": {"path": "…/takes/u_0042_v2_t1.wav", "outcome": "fit", "stretch": 0.97,
           "voice": {"provider": "elevenlabs", "voice_id": "…"}, "takes_tried": 1},
  "flags": ["low_asr_confidence"],
  "edits": [{"type": "filler_removed", "src": "uh"},
            {"type": "repetition_removed", "src": "we"},
            {"type": "grammar", "src": "we gonna", "dst": "we're going to"}],
  "error": null
}
```

**`status`:**

| Value | Meaning |
|---|---|
| `pending` | Not processed yet. |
| `rewriting` | Rewrite in progress. |
| `synthesizing` | Voice generation in progress. |
| `done` | Re-voiced. Also used for an utterance that was pure filler: `text: ""`, `take: null`. |
| `original_kept` | The original audio is used. |
| `failed` | Provider failure after retries. The original audio is used, and `error` is set. |

**`flags`** (closed list):

| Flag | Set when |
|---|---|
| `stretch_flagged` | The take was stretched into the flagged band. |
| `overflow_review` | The take could not be fitted. |
| `low_asr_confidence` | Transcription confidence was low for some words. |
| `meaning_check_failed` | Even the light rewrite failed the meaning check. |
| `rewrite_failed` | The rewrite call failed or the model refused. |
| `protected_token_changed` | A user edit changed a name, number, glossary term or negation. This is a warning only. |
| `overlap_speech` | The utterance overlaps another speaker. |
| `voice_fallback` | The take used the speaker's fallback voice. |
| `clone_unavailable` | The speaker could not be cloned. |
| `text_too_long` | User text exceeds the time budget. |

**`edits.type`:** `filler_removed`, `repetition_removed`, `false_start_removed`, `grammar`, `word_choice`, `rephrase`, `spelling`.

### 4.7 Errors

| Code | Name | `data` / notes |
|---|---|---|
| -32700 | parse_error | `id: null`. Invalid JSON or a line over 16 MB. The engine keeps running. |
| -32600 | invalid_request | Not a JSON-RPC 2.0 object. The engine keeps running. |
| -32601 | method_not_found | none |
| -32602 | invalid_params | `{field, reason}`. An unknown segment gives `{field:"segment_id", reason:"not_found"}`. |
| -32001 | auth_failed | `{provider}`. In `job.paused`, or as the error response of the call. |
| -32002 | quota_exhausted | `{provider}`. In `job.paused`, or as the error response of a `segment.*` call. |
| -32003 | provider_unavailable | `{provider, status}`. Returned by `job.analyze` when transcription fails after its fallback; recorded in a segment's `error` otherwise. |
| -32010 | invalid_input | `{reason}`, one of `undecodable`, `not_wav_48k`, `too_short`, `too_long`, `silent`, `clipped`, `unsupported_language`, `length_mismatch` |
| -32011 | consent_required | `{speaker_id}` |
| -32020 | job_not_found | none |
| -32021 | job_state_conflict | `{status}` (a job state, or `"segment_busy"`) |
| -32030 | spend_cap_reached | `{spent_usd, cap_usd}`. In `job.paused`, or as the error response of a `segment.*` call. |

## 5. Connectors

The pipeline reads only connector and voice capabilities; it never branches on vendor names.

```python
class ASR(Protocol):
    caps: ASRCaps  # languages, word_timestamps, word_confidence, diarization,
                   # max_seconds, max_seconds_diarized, audio_events
    async def transcribe(self, audio: Path, language: str | None, diarize: bool,
                         keyterms: list[str]) -> Transcript: ...

class LLM(Protocol):
    async def rewrite(self, req: RewriteRequest) -> RewriteResponse: ...
    async def judge(self, req: JudgeRequest) -> JudgeResponse: ...

class StockVoice(BaseModel):
    provider: str; voice_id: str; public_owner_id: str | None
    name: str; gender: str | None; locale: str; preview_url: str | None
    duration_control: Literal["exact", "rate", "none"] | None  # None until probed
    rate_range: tuple[float, float] | None

class TTS(Protocol):
    caps: TTSCaps  # languages, cloning, clone_denoise, alignment, max_chars, output_rates
    async def list_voices(self, language: str) -> list[StockVoice]: ...
    async def prepare_voice(self, ref: VoiceRef) -> str: ...   # e.g. add a library voice; returns usable voice_id
    async def clone(self, name: str, reference: list[Path], denoise: bool) -> str: ...
    async def delete_voice(self, voice_id: str) -> None: ...
    async def synthesize(self, req: SynthRequest) -> Take: ...
    # SynthRequest: voice_id, text, language, seed, previous_text?, next_text?,
    #               duration_sec? (exact voices), rate? (rate voices)
    # Take: 48 kHz float32 mono audio + optional character alignment

class Isolator(Protocol):
    async def isolate(self, audio: Path) -> Path: ...
```

### 5.1 v1 connectors

**`asr.elevenlabs_scribe`** (default)
- **Endpoint:** `POST /v1/speech-to-text`, multipart, `model_id=scribe_v2`.
- **Parameters:** `timestamps_granularity=word`; `diarize` as requested; `language_code` (`en`, `bn`, or null for auto-detect); `keyterms`.
- **Never** set `no_verbatim`: fillers must stay in the transcript.
- **Response handling:**
  - Word confidence is `exp(logprob)`, so `word_confidence=true`.
  - `audio_events=true`.
  - Detected language codes come back as ISO-639-3 (`ben`, `eng`) and are normalised (§6.3).
- **Limits and price:** Bengali sits in the 5–10% WER tier. $0.22 per audio hour, +$0.05/h when `keyterms` are sent. Files up to 10 h.

**`asr.azure_mai`** (optional)
- **Endpoint:** `POST https://{region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, multipart with an `audio` part and a `definition` part.
- **Request:**
  - `enhancedMode:{enabled:true, model:"MAI-Transcribe-2", modelOptions:{timestamps:"word", transcribeStyle:"verbatim"}}`. `timestamps` defaults to `none`, so it **must** be set.
  - `diarization:{enabled:<diarize>}`.
  - Glossary goes in `phraseList.phrases`.
- **Audio:** sent as one request, mono 16 kHz FLAC. There is no chunking, because chunked diarization numbers speakers per chunk.
- **Capabilities:** `max_seconds_diarized` = 1800 s (conservative; the limit is undocumented). `word_confidence=false`, since words carry no confidence.
- **Availability and price:**
  - Region must be one of `centralindia`, `eastus`, `northeurope`, `southeastasia`, `westus`, `westus2`.
  - Preview, with no SLA.
  - $0.10/h until 2026-12-31 (promotion), then budget $0.36–0.54/h.

**`llm.anthropic`** — see §6.8.

**`tts.elevenlabs`**
- **Synthesis:** `POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=pcm_48000`, `model_id=eleven_v4`.
  - Bengali is available on `eleven_v4`, `eleven_v4_turbo`, `eleven_v3` and `eleven_v3_conversational`; v1 uses `eleven_v4`.
  - None of those models has speed, style or SSML control, so every ElevenLabs voice has `duration_control="none"`.
  - Character-level `alignment` is returned when the probe in §5.2 confirms it works on v4.
  - Requests carry `previous_text`, `next_text`, `seed` and `language_code`.
  - If `pcm_48000` hits a 403 plan gate, it falls back to `pcm_24000`, resampled locally.
  - The character limit is read at runtime from `GET /v1/models` (10 000 for v4).
  - Price: $0.08 per 1K characters. Library voices can carry a custom rate, so they are listed with `include_custom_rates=false`.
- **Cloning:** `POST /v1/voices/add` (multipart `name`, `files`, `remove_background_noise`; `caps.clone_denoise=true`).
  - 1–2 min of clean reference is recommended; at least 10 s is required.
  - Delete a clone with `DELETE /v1/voices/{voice_id}`.
  - **Whether clones built from Bengali reference audio sound right is unverified.** This is a bake-off item.
- **Stock voices:**
  - Listed with `GET /v1/shared-voices?language=bn|en`. On the Free tier, only voices with `free_users_allowed=true` are listed.
  - `prepare_voice` adds the chosen voice to the user's account with `POST /v1/voices/add/{public_owner_id}/{voice_id}` (body `new_name`) and stores the returned id with `created_by_job=true`.

**`tts.azure_neural`** (optional)
- **Endpoint:** `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`, with SSML and `X-Microsoft-OutputFormat: riff-48khz-16bit-mono-pcm`.
- **Voices:** `bn-BD-NabanitaNeural`, `bn-BD-PradeepNeural`, `bn-IN-TanishaaNeural`, `bn-IN-BashkarNeural`, plus English `*Neural` voices.
- **Timing control:**
  - `<prosody rate>` works across 0.5–2×.
  - `<mstts:audioduration>` is documented for prebuilt voices but unconfirmed for Bengali. The §5.2 probe sets each voice's `duration_control` to `"exact"` or `"rate"`.
- **Other:** the REST response has no word timing; none is needed (§6.10). Price: $15 per 1M characters.

**`isolate.elevenlabs`**
- **Endpoint:** `POST /v1/audio-isolation`. Returns MP3; limits are 500 MB and 1 h.
- **Price:** $0.12 per minute.
- **When used:** only by `segment.use_original {clean:true}`.

**Not in v1:**
- Azure Personal Voice. It is limited access, for Microsoft-managed customers only, so bring-your-own-key users realistically can't use it.
- The Azure Speech SDK. Its word events need Windows 11+, and no word timing is required.

### 5.2 Probes and account checks

Probes run during `providers.check`, or lazily before a job's first call to that provider. Results are cached for the life of the process.

**ElevenLabs:**
- `GET /v1/user/subscription` reads `tier`, `can_use_instant_voice_cloning`, `voice_limit`, `voice_slots_used`, `max_voice_add_edits` and `voice_add_edit_counter`.
  - These set `clone_eligible` and `clone_block_reason` (§4.5) and size the semaphore (§3.4).
  - On a Free tier, the engine emits `provider.warning free_tier_no_commercial_licence`.
- One 2-word `eleven_v4` synthesis checks whether `alignment` is returned.

**Azure:**
- The region is checked against the MAI region list.
- One short line per locale (bn-BD, bn-IN, en-US) is synthesised with `mstts:audioduration` set to 0.8× its natural length.
  - If the result is within ±5% of the requested length, that locale's voices get `"exact"`; otherwise `"rate"`.

### 5.3 Routing
1. **ASR:** use `asr.azure_mai` when all of these hold:
   - an Azure key is present;
   - its region supports MAI;
   - the job language is `bn` or `auto`;
   - the input is no longer than `max_seconds_diarized`.

   Otherwise use `asr.elevenlabs_scribe`. If the chosen connector fails with `provider_unavailable`, the other one is tried. The M2 bake-off may change this default.
2. **Primary voice:** the voice set with `speakers.set_voice`.
3. **Fallback voice** (used in §6.11, step 1):
   - the speaker's `fallback_voice`, if set and its `duration_control` is not `"none"`;
   - otherwise, if an Azure key is present, the first Azure voice for the job locale whose gender matches `speaker.gender` (`bn-BD-NabanitaNeural` or `en-US-AvaNeural` when gender is null);
   - otherwise there is no fallback voice.

### 5.4 Error classification and retries

§5.4 is the only retry layer. The Anthropic client is created with `AsyncAnthropic(api_key=…, max_retries=0, timeout=120)`.

The vendor error body is classified **before** the HTTP status:

| Condition | Handling |
|---|---|
| ElevenLabs 400/401/403 with `detail.status == "quota_exceeded"` | `quota_exhausted` (pause, or the error response of a `segment.*` call) |
| ElevenLabs 403 on an output-format or feature gate | Capability downgrade (e.g. `pcm_24000`), then retry |
| ElevenLabs voice-limit or add-edit errors during clone or prepare | The speaker gets the fallback voice and `voice_fallback`. If there is none, the job pauses with `quota_exhausted`. |
| Any other 401/403 | `auth_failed` (pause, or the error response) |
| 429 (rate limit, busy, concurrency) | Exponential backoff with full jitter: base 1 s, cap 30 s, 6 attempts, honouring `retry-after`. An Azure 429 that persists after 6 attempts → `quota_exhausted`. |
| 5xx, timeout, connection error | 3 retries with the same backoff, then `provider_unavailable` |

**Where `provider_unavailable` lands:**
- **Segment-level call:** the segment becomes `failed`, is rendered from the original audio, and records `error`. `segment.regenerate` can retry it. The job continues.
- **Transcription:** after the §5.3 fallback, `job.analyze` returns -32003 and the job stays `created`.
- **Clone failure:** the speaker uses its fallback voice, and every segment gets `voice_fallback`.
- **Rewrite chunk failure or refusal:** every utterance in the chunk gets the deterministic light edit (§6.8) and `rewrite_failed`.
- **Meaning-check failure or refusal:** counts as a failed check.

## 6. Processing pipeline

### 6.1 Ingest
- Validate `dialogue_path` and the speaker tracks (§4.4). Read them as float32; N is the sample count.
- Make a 16 kHz mono copy for VAD and transcription.
- Reject the input (`invalid_input`) if it is:
  - shorter than 1 s (`too_short`) or longer than 3 h (`too_long`);
  - more than 95% non-speech (`silent`);
  - more than 1% clipped samples, `|x| ≥ 0.999` (`clipped`).

### 6.2 Speech detection
`silero-vad-lite` gives one speech probability per 32 ms window (512 samples at 16 kHz). Regions come from our port of the upstream `get_speech_timestamps` logic (MIT):
1. Enter speech when p ≥ 0.5. Leave only after at least 200 ms with p < 0.35.
2. Drop regions shorter than 150 ms.
3. Pad each region by 50 ms on each side, clamped so regions don't overlap.
4. Merge gaps shorter than 200 ms.

**Room tone:** non-speech gaps of at least 400 ms are ranked by RMS. The quietest are concatenated, up to 10 s, with crossfades of half the shorter fragment (at most 200 ms). The ends are crossfaded into a seamless loop, which `ambience:"keep"` uses.

### 6.3 Transcription and words
1. **Send** the 16 kHz audio with:
   - `diarize = not speaker_tracks`;
   - the glossary as `keyterms` (Scribe) or `phraseList` (Azure). Scribe drops entries with 50+ characters, more than 5 words, or any of `<>{}[]\`, and accepts at most 1000.
2. **Speaker tracks:** when given, each word is assigned to the track with the highest RMS over the word's span. Words where two tracks are within 3 dB of each other are marked overlapping. Speaker ids are `S1…Sn` in track order, with `label` taken from the track.
3. **Word-boundary refinement:**
   - A word start that follows non-speech snaps to the first 5 ms frame, within ±30 ms, whose energy exceeds the local noise floor + 10 dB.
   - A boundary between two adjacent words snaps to the lowest-energy 5 ms frame within ±30 ms.
   - Then enforce: starts increase monotonically, every word is at least 40 ms long, and every word lies inside a VAD region padded by 100 ms.
4. **Low confidence:** a word is low-confidence if it violates those checks after refinement, or if its confidence is below 0.5 on connectors with `word_confidence`. Its segment gets the `low_asr_confidence` flag, and the word is passed to the LLM as `word[?]`.
5. **Language:** the detected language is normalised to ISO-639-1 (`eng`→`en`, `ben`/`bn-BD`/`bn-IN`→`bn`). With `language:"auto"` it becomes the job language; any other language gives `invalid_input {reason:"unsupported_language"}`.

### 6.4 Segmentation, fillers, anchors, overlap
- **Pre-marked fillers** (deterministic, before the rewrite; only unambiguous ones):
  - language-pack tokens (initial lists, tuned in the bake-off): en `um, uh, er, erm, hmm, mm`; bn `উম, উঁ, হুম, আঁ`;
  - immediate repetitions of the same normalised token, where all but the last are marked.

  Ambiguous fillers (en *ah, like, you know, I mean*; bn *আ, এ, ইয়ে, এই, মানে, আসলে, তো*) are **not** pre-marked, because they can also be real words. The LLM decides whether to remove them.
- **Utterance (segment):** ends at a speaker change, at sentence-final punctuation (`. ? ! ।`) followed by a pause of 300 ms or more, or at 15 s, split at the longest internal pause.
- **Phrase:** within an utterance, a maximal run of words whose gaps are all under 300 ms.
- **Per phrase j:**
  - *Fluent words* are the words that are not pre-marked.
  - If phrase j has no fluent words, it is **empty**.
  - Otherwise: A_j = start of its first fluent word (the phrase anchor) and B_j = end of its last fluent word.
  - F_j = the summed duration of the pre-marked words strictly between A_j and B_j. Each adjacent gap, capped at 150 ms, is added once.
- **Utterance anchor:** `anchor` = A of the first non-empty phrase. B_u = B of the last non-empty phrase.
- **Pure-filler utterances:** an utterance with no non-empty phrase gets status `done`, `text: ""`, `take: null` and a `filler_removed` edit. Its time becomes bed (silence or room tone).
- **Overlap:** words from different speakers whose times intersect.
  - Every utterance containing one is flagged `overlap_speech` and kept as original audio over the **union** of the overlapping utterances' spans. That span is rendered once.
  - `segment.regenerate` can force a re-voice; the other speaker's overlapping words are then lost, and the user is warned in the editor.
- **Audio events:** when the ASR reports audio events (laughter, applause) of 300 ms or more, they are rendered from the original audio, provided they don't intersect a placed piece.

### 6.5 Voices per speaker
- **Eligibility:** `clone_eligible` requires `clean_speech_seconds ≥ min_clone_seconds` and an ElevenLabs account that allows cloning (§5.2). "Clean" means: not overlapping, no low-confidence words, and loudness within ±6 dB of the speaker's median.
- **Clone reference:**
  1. Take that speaker's clean utterances, longest first, up to 90 s, joined with 300 ms silences.
  2. Encode as MP3 at 192 kbps or more, normalised to about −20 dBFS RMS.
  3. Ask for `denoise=true` only when the estimated SNR is below 20 dB, because cleaning a reference can lower clone similarity.
- Clones and prepared library voices are created in the `voices` stage of `job.run`, marked `created_by_job=true`, and deleted by `job.delete` unless `keep_voices` is set.
- **`mode:"existing"` voices are never deleted.**

### 6.6 TTS text normalisation (`lang` packs)
Display text (shown to the user and used in subtitles) and TTS text (sent to the voice provider) are kept separately, with an index map between them. **All syllable and pause-mark counts use the TTS text.**

**Bangla:**
1. **ZWJ and khanda ta:**
   - Map legacy ত্‍ (ta + hasanta + ZWJ) to ৎ.
   - Keep the ZWJ in র‍্য.
   - Drop all other ZWJ and ZWNJ.
2. **NFC.** It decomposes ড় ঢ় য় into base + nukta; that form is accepted.
3. **Number expansion** with our own code:
   - Merge lakh-style comma groups (১,২৫,০০০) before parsing.
   - Integers → words with lakh/koti grouping, colloquial forms (দুশো, পাঁচশো).
   - Decimals digit by digit after দশমিক.
   - Also: ৳/টাকা/পয়সা, %, times (১০:৩০ → দশটা ত্রিশ), dates (২৫/১০/২০২৬ → পঁচিশে অক্টোবর দুই হাজার ছাব্বিশ), ordinals (১ম → প্রথম), and the minus sign.
   - `num2words(lang="bn")` and `bangla-text-normalizer` serve only as test oracles; both have known bugs.
4. **`bnunicodenormalizer`** (MIT), per Bengali word, after expansion (it strips ৳ and %), with `allow_english=True`. A `None` result keeps the original word.

Display text uses Bengali digits.

**English:** expand numbers, currency, dates, times and abbreviations; keep acronyms in their original case.

### 6.7 Time budget and duration model

**Slot:**
- `next_start` = first-word start of the next utterance that does not overlap this one, or N if there is none.
- `gap = next_start − last_word_end`.
- `borrow = 0` if the next utterance is by another speaker or a cut lies in `(last_word_end, next_start)`. Otherwise `borrow = max(0, min(0.5 × gap, gap − 150 ms))`.
- `slot.start = max(0, first_word_start − 50 ms)`.
- `slot.end = min(N, max(last_word_end, min(next_start − 80 ms, last_word_end + borrow)))`.

**Speech targets:**
- Each non-empty phrase j: `T_j = max(0.6 × (B_j − A_j), (B_j − A_j) − F_j)`.
- **Multi-piece mode:** used when a candidate keeps the phrase structure and has two or more non-empty phrases. Each phrase is a piece with target T_j.
  - **Non-last piece:** `max_len_j = A_next − A_j − 80 ms`, where `A_next` is the next non-empty phrase's anchor.
  - **Last piece:** `max_len_j = slot.end − A_j`.
- **One-piece mode:** used otherwise.
  - `T_u = max(0.6 × (B_u − anchor), (B_u − anchor) − F_u)`. F_u covers all pre-marked time between the anchor and B_u, so inter-phrase pauses count toward T_u.
  - `max_len_u = slot.end − anchor`.

**Duration model**, per voice and language, for **trimmed** speech:

  `D(text) = S / rate + k × M`

  - S = syllables of the TTS text.
  - M = internal pause marks (`, ; : । . ? !` that are not at the end of the text).
  - Seed values: `rate` 5.0 syllables/s (en) or 5.5 (bn); `k` = 0.15 s.
  - **Refit** by non-negative least squares on the voice's history of `(S, M, L)`, once there are at least 5 entries. L is the take length after trim, before pause shaping and stretch.
  - **Logged takes:** `none` takes as L; `rate` takes as `L × rate`. `exact` takes are not logged.
  - The model is snapshotted per call (§3.5).

**Syllable counting:**
- **English:** a vendored `cmudict.dict` (BSD data) read by our own loader, with a vowel-group fallback.
- **Bangla:** our own rule-based counter following Epitran's `ben-Beng` rules.
  - Vowel signs and independent vowels each count as one nucleus.
  - A consonant with no sign carries an inherent vowel. That vowel is deleted before a vowel, word-finally after a single consonant, and in the middle of `VC_CV`.
  - A word-final conjunct keeps its vowel.
  - Hasanta (্) and ৎ kill the vowel. ং, ঃ and ঁ add no syllable.
  - Expected accuracy is about 90–97% per word; the per-voice refit absorbs the bias.
- **Latin-script words inside Bangla:** use the English counter.

**Targets sent to the LLM:**
- Per non-empty phrase: `target_syllables_j = max(1, round((T_j − k × M_j) × rate))`, where M_j counts the original phrase's internal marks.
- `target_words_j = max(1, round(target_syllables_j / spw))`.
- `spw` is the original fluent words' syllables per word. If there are no fluent words, it is the language-pack default: initially 1.5 (en) or 2.0 (bn), recalibrated in M2.

**Acceptance (selection):** a candidate passes when, per non-empty phrase (multi-piece) or for the utterance total (one-piece), the predicted D lies in `[min_fill × T, min((1 + tolerance) × T, max_len)]`.
- Defaults: `min_fill` 0.75, `tolerance` 0.10.
- Short is tolerated more than long: a missing word becomes a pause, while extra words run into the next sentence.
- Utterances with `T_u < 1.0 s` skip this gate; the take fit (§6.10) decides.

### 6.8 Rewrite (Claude)

**Rewrite call (Opus 5.5):**
```python
await client.beta.messages.create(
    model="claude-opus-5-5", max_tokens=16000,
    system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
    messages=[{"role": "user", "content": chunk_json}],
    output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": REWRITE_SCHEMA}},
    betas=["server-side-fallback-2026-07-01"], fallbacks="default")
```
- **Thinking:** adaptive. Opus 5.5 cannot disable thinking.
- **Effort:** `EFFORT` starts at `"medium"`, set explicitly, and is tuned in the bake-off.
- **Prompt caching:** `SYSTEM_PROMPT` holds the language-pack rules and stays stable, so it can be cached.
- **No sampling parameters:** `temperature`, `top_p` and `top_k` return a 400. Variety comes from the length-targeted candidates.
- **No forced tool choice:** `tool_choice` `any` / `tool` return a 400.
- **Response checks, in order:**
  1. `stop_reason`: `refusal` or `max_tokens` counts as a failed round.
  2. Validate with the pydantic models. A failure counts as a failed round.
  3. Check counts: exactly 3 candidates, and `len(phrases) == len(input phrases)` or `== 1`. A violation counts as a failed round.

  `REWRITE_SCHEMA` is derived from the pydantic models. It has no count constraints, because structured outputs can't enforce them, and it uses `additionalProperties: false`.
- **Spend:** read from `usage.iterations` when present, pricing each attempt at the model that ran it (a fallback runs on another model), and from top-level `usage` otherwise.

**Meaning check (Haiku 5.5):**
- Call: `client.messages.create(model="claude-haiku-5-5", output_config={"effort":"low", "format":{…JUDGE_SCHEMA}})`.
- No `fallbacks`, because Haiku 5.5 has none.
- A refusal, an invalid result or a call failure counts as a failed check.

**Chunks:**
- 2–4 consecutive utterances in timeline order, each labelled with its speaker.
- Plus the original text of the 2 previous and 2 next utterances as read-only context, and the glossary.
- Chunks run in parallel.

**Strictness:**

| Level | Allowed edits |
|---|---|
| `light` | Remove fillers, repetitions and false starts; fix only clear grammatical errors; no rewording. |
| `clean` (default) | `light`, plus fix grammar (agreement, tense, word order) and replace wrong or poor word choices, keeping the speaker's vocabulary and register. |
| `polish` | `clean`, plus rephrase for clarity and flow; sentences may be restructured. Never add facts or opinions. |

**Language-pack rules (system prompt):**
- **Both languages:**
  - Answer in the input language.
  - Keep person, intended tense, tone and politeness.
  - Never change names, numbers, units, dates, negations or glossary terms.
  - Words marked `[?]` may get spelling fixes only.
- **Bangla (bn-BD):**
  - *Cholito* only; never *sadhu*.
  - Bangla Academy spelling, supported by a curated table of about 200 common misspellings with their standard forms (e.g. সরকারী→সরকারি, দাবী→দাবি), built with a native reviewer in M2. No permissively licensed Academy lexicon exists.
  - Keep English loanwords exactly as spoken, in the same script.
  - Ambiguous fillers (এই, মানে, আসলে, তো) are removed only when they are used as fillers.
- **English:**
  - Keep the speaker's dialect; spelling follows the transcript.
  - Remove *like, you know, I mean, sort of, kind of* only when they are used as fillers.

**Contract (per chunk):**
```python
class PhraseIn(BaseModel):
    text: str                   # original verbatim text; low-confidence words as "word[?]"; pre-marked fillers as "{uh}"
    empty: bool                 # true if every word is a pre-marked filler -> expected back as ""
    target_syllables: int       # §6.7 (0 if empty)
    target_words: int           # §6.7 (0 if empty)

class UtteranceIn(BaseModel):
    id: str
    speaker: str
    phrases: list[PhraseIn]

class RewriteRequest(BaseModel):
    language: Literal["en", "bn"]
    strictness: Literal["light", "clean", "polish"]
    glossary: list[str]
    context_before: list[str]
    context_after: list[str]
    utterances: list[UtteranceIn]
    feedback: list[str] = []    # numeric feedback from earlier rounds (step 4)
    avoid: list[str] = []       # earlier texts to differ from (segment.regenerate new_rewrite)

class Edit(BaseModel):
    type: Literal["filler_removed", "repetition_removed", "false_start_removed",
                  "grammar", "word_choice", "rephrase", "spelling"]
    src: str
    dst: str | None = None

class Candidate(BaseModel):
    length: Literal["short", "target", "long"]   # aim: target-8% / target / target+8% syllables
    phrases: list[str]          # same count as input phrases ("" for empty ones), or exactly 1
    edits: list[Edit]

class UtteranceOut(BaseModel):
    id: str
    candidates: list[Candidate]  # code checks: exactly 3

class RewriteResponse(BaseModel):
    utterances: list[UtteranceOut]
```

**Selection (in code):**
1. **Hard gates.** Reject a candidate if:
   - its language or script differs from the input;
   - a protected token is missing or changed (glossary terms; numbers after normalisation; proper nouns found in the original);
   - the negation count changes (bn: না নি নেই নয় নাই; en: not, n't, no, never);
   - it is a Bangla candidate containing *sadhu* verb forms (pattern list).
2. **Fit:** the acceptance check in §6.7.
3. **Pick:** among passing candidates, the one with the fewest edits; on a tie, the one closest to target.
4. **Feedback:** if none passes, run up to 3 rounds with numeric feedback, e.g. *"u_0042 phrase 2 has 23 syllables; it must have 16–20."* After round 3, the candidate with the smallest `|log(D/T)|` that passes the hard gates continues to synthesis, and §6.10 decides.
5. **Meaning check** of the chosen text against the original. On failure:
   - retry once at the same level, with the failure reason as feedback;
   - then step down a level (polish → clean → light);
   - if `light` still fails, use the **deterministic light edit** (the verbatim transcript without pre-marked fillers) and flag `meaning_check_failed`.

### 6.9 Synthesis and the take loop

**Request text:** the chosen candidate's TTS text, with phrases joined by spaces. A phrase without final punctuation gets a comma, which invites a pause at each phrase boundary. The whole utterance is one request, which gives natural prosody.

**Strategy by the voice's `duration_control`:**

| Control | Strategy |
|---|---|
| `exact` | One take with `mstts:audioduration` set to T_u (§6.7, one-piece target). A second take is made if the outcome is not `fit`. |
| `rate` | Take 1 at `rate = clamp(D/T_u, voice range)`, where rate > 1 means faster. If the outcome is not `fit`, one more take at `rate × L1/T_u`, where L1 is take 1's trimmed length. |
| `none` (ElevenLabs v4) | Up to 3 takes, each with a new seed (§3.5). If take 2's outcome is `out`, the text is not user-fixed (§7), and the selection did not already use all 3 feedback rounds, one more feedback round runs on the **measured** lengths before take 3. |

**Best take:** ranked by outcome (`fit` > `flagged` > `out`), then by `|log α_applied|`.

### 6.10 Fit (per take)
1. **Trim** leading and trailing silence. The threshold is the take's noise floor (10th-percentile 5 ms frame energy) + 6 dB.
2. **Pause detection:**
   - Resample the take to 16 kHz and run a **fresh** VAD instance: threshold 0.5, no padding, minimum silence 120 ms.
   - Refine boundaries to 5 ms energy frames.
   - No provider word timing is needed, so this works for every voice.
3. **Pieces** (multi-piece mode, with m non-empty phrases):
   - Requires at least m − 1 detected pauses.
   - Each boundary's expected position is `L × (TTS characters up to that phrase's end) / (total characters)`.
   - Pauses are assigned to boundaries one-to-one and in order, minimising the total |pause centre − expected position| (dynamic programming).
   - Each assigned pause is cut at its midpoint, and each piece is trimmed again with the step-1 rule.
   - If there are too few pauses, use one-piece mode.
4. **Pause shaping** (one-piece mode only, and only when `L > max_len`): shorten the longest internal pauses first. Each pause over 150 ms is cut to `max(150 ms, 0.5 × its length)`, stopping once `L ≤ max_len`.
5. **Outcome per piece** (length L, target T, max M):

   | Condition | Action | Outcome |
   |---|---|---|
   | `L > M`, α = M/L ≥ 0.88 | Compress to M | `fit` |
   | `L > M`, 0.80 ≤ α < 0.88 | Compress to M | `flagged` |
   | `L > M`, α < 0.80 | none | `out` |
   | `L < min_fill × T`, required α ≤ 1.08 | Expand to exactly `min_fill × T` | `fit` |
   | `L < min_fill × T`, required α ≤ 1.12 | Expand to exactly `min_fill × T` | `flagged` |
   | `L < min_fill × T`, required α > 1.12 | none | `out` |
   | otherwise | none (α = 1); leftover time stays as trailing silence | `fit` |

   - Stretching uses Signalsmith with `timeFactor = 1/α`. Output length is input length divided by `timeFactor`.
   - `α_applied` is recorded for each piece.
6. **Take outcome:** the worst piece outcome. `take.stretch` is the `α_applied` furthest from 1.

### 6.11 Fallback chain (best take is `out`)
1. **Fallback voice** (§5.3, rule 3), if one exists: run that voice's strategy (§6.9). If the outcome is `fit` or `flagged`, use it and flag `voice_fallback`.
2. **Keep the original:** status `original_kept`, flag `overflow_review`. The original audio is used over `[slot.start, min(slot.end, last_word_end + 50 ms)]`.
   - For user-fixed text (§7), the user's text and best take are still stored as a new version.

### 6.12 Place and mix
- **Bed:**
  - `ambience:"clean"`: zeros.
  - `ambience:"keep"`: `bed[n] = tone[n mod L_tone]`. Because it is indexed by absolute sample, a re-render reproduces it exactly.
  - Under kept original audio (original_kept, failed, overlap and audio-event spans), the bed is **replaced**, not summed, with 20 ms equal-power crossfades.
- **Pieces:** each piece's first non-silent sample is placed at its anchor A_j (nominal offset 0). Pieces get a 5 ms fade-in and a 15 ms fade-out.
- **Speaker gain:** at the end of `job.run`, each speaker's gain is computed as `g_s = L_orig(s) − L_dub(s)`, where L is BS.1770 integrated loudness over that speaker's speech regions. The gains are **frozen** and persisted; edits never recompute them.
- **Limiter:**
  - Run ffmpeg `alimiter=limit=0.794:level=0:latency=1`: a −2 dBFS sample ceiling, no auto-level gain, delay compensated.
  - Measure the true peak with the 4×-oversampled meter. If it is above −1 dBTP, rerun with the limit lowered by the excess.
  - Assert that the stem length is N; any other length moves the job to `failed`.
- **Onset check (QC start error):** in the stem, find the first 5 ms frame after `anchor − 60 ms` whose energy exceeds `max(bed level, −70 dBFS) + 10 dB`. Start error = that frame − anchor.

## 7. Editing loop (after `job.run` completes)

**Versions:**
- Every successful `segment.update_text`, `segment.regenerate` and `segment.use_original` appends a new version `max + 1`, holding text, take, status, flags and edits.
- `segment.revert` appends a new version that copies the version that was current just before the current one, so reverting twice toggles back. With no earlier version it returns `invalid_params {field:"segment_id", reason:"no_previous_version"}`.

| Action | Behaviour | Cost |
|---|---|---|
| `segment.update_text` | **Fixed text.** <ol><li>Normalise and predict D. If it is over `max_len`, the response carries `warning {code:"text_too_long", syllables, max_syllables}` and synthesis continues anyway.</li><li>If a protected token changed, flag `protected_token_changed`.</li><li>Run the take loop (§6.9) with no rewrite rounds, then the fallback voice.</li><li>If it is still `out`, the new version stores the user's text and best take with `text_too_long` + `overflow_review`, and the stem uses the original audio for the slot.</li></ol> | TTS |
| `segment.regenerate same_text` | Fixed text, same rules, with new seeds (the version and take index change). | TTS |
| `segment.regenerate new_rewrite` | §6.8 for this utterance, with all earlier texts in `avoid`, then §6.9–6.11. | LLM + TTS |
| `segment.revert` | Restores the earlier text and take from the store. | Free |
| `segment.use_original` | Original audio for the slot, optionally cleaned by the Voice Isolator. | Free, or isolator |

**Region re-render:**
1. Rebuild `[slot.start − 50 ms, slot.end + 50 ms]` from the bed plus **every** placed piece or kept-original span that intersects the window, the neighbours included, using the frozen speaker gains.
2. Run the limiter over the window plus 100 ms of context on each side.
3. Splice back only the window, then emit `segment.updated`.

## 8. Deliverables (`job.export`)

Files are written to `out_dir`, which defaults to `job_dir/export/`, through temp names and atomic renames.

| Key | File | Notes |
|---|---|---|
| `stem` | `dub_stem.wav` | <ul><li>Mono, 48 kHz, 24-bit PCM, **N samples**.</li><li>Written by ffmpeg: `-c:a pcm_s24le -write_bext 1 -metadata time_reference=<timeline.start_sample> -metadata description="Contains AI-generated voice (redub-engine)" -metadata comment="Contains AI-generated voice (redub-engine)"`.</li><li>A test reads back the TimeReference and the sample count.</li></ul> |
| `clips` | `clips/{segment_id}.wav` + `manifest.json` | One clip per segment with a re-voiced take, holding the rendered audio over the segment's slot. Each comes with its file-relative `start_sample`. |
| `srt`, `vtt` | `captions.srt`, `captions.vtt` | <ul><li>UTF-8; the SRT BOM is optional. SRT uses `HH:MM:SS,mmm`. VTT has a `WEBVTT` header, uses `HH:MM:SS.mmm`, and escapes `&` and `<`. Times are file-relative, rounded from samples to milliseconds.</li><li>Cues follow utterances, split at piece boundaries. Netflix-based defaults: ≤ 2 lines, ≤ 42 characters per line, ≤ 20 characters/s (en) or ≤ 22 (bn), 0.83–7 s per cue.</li><li>Characters are counted as extended grapheme clusters (`regex` `\X`), so ক্ষ counts as one. Text is NFC; ZWJ/ZWNJ are kept.</li><li>Times come from the placed pieces; ElevenLabs character alignment refines split points where available.</li></ul> |
| `changes` | `changes.json` | Per segment: original text, final text, edits, status and flags, for every version. |
| `qc` | `qc_report.json` | <ul><li>Per segment: outcome, `α_applied` per piece, start error (§6.12), voice, takes tried, provider and spend.</li><li>Per job: share of segments with outcome `fit`, flag counts, start-error median and p95, total spend.</li></ul> |

## 9. Safety, consent and privacy
- **Consent gate:** cloning requires `consent:{confirmed_by, confirmed_at}` per speaker, stored in the job. The editor UI shows the speaker's label and a statement that the user has the right to clone this voice.
- **Clone lifecycle:** voices are created per job and deleted at `job.delete` unless they are kept. Voices supplied as `existing` are never deleted. Reference audio lives only in the job folder.
- **Disclosure:** exported audio carries the AI-voice note in its metadata (§8), and `changes.json` records every change. C2PA comes later.
- **Data flows**, which the editor's settings screen lists:

  | Recipient | Receives |
  |---|---|
  | ElevenLabs | Audio (transcription, clone reference, isolation) and text (TTS) |
  | Azure | Audio and text, only when that key is set |
  | Anthropic | Text only |

- **Secrets:**
  - Keys are passed in only via `engine.configure` and held in memory.
  - Log lines are redacted against every configured key.
  - Keys never go into argv or the environment. ffmpeg runs with a scrubbed environment and an argument list, never a shell.
  - The editor stores keys with Electron `safeStorage` (async API) or, in Tauri, the `keyring` crate.
- **Licence notice:** a Free-tier ElevenLabs key triggers a warning that its output carries no commercial licence (§5.2).

## 10. Cost model (list prices, 2026-10; the price table is configurable)

Per minute of speech (about 900 characters of final text):

| Item | Low | High |
|---|---|---|
| Transcription: Scribe v2 ($0.22/h, +$0.05/h with keyterms) or MAI-Transcribe-2 ($0.10–0.54/h) | $0.002 | $0.009 |
| Rewrite: Opus 5.5 at $4/$20 per MTok (refusal fallbacks billed at the fallback model's rates) + Haiku 5.5 meaning check at $0.10/$0.50 | $0.05 | $0.30 |
| TTS: ElevenLabs $0.08 per 1K characters × 1–3 takes, or Azure $15 per 1M characters | $0.07 | $0.22 |
| **Total** | **≈ $0.12** | **≈ $0.53** |
| Optional Voice Isolator on kept segments | +$0.12 per minute isolated | |

`job.analyze` returns this estimate for the actual job, and `spend_cap_usd` enforces a limit (§4.1).

## 11. Testing

### 11.1 Unit (no network)
- **Sample math:** slot, borrow and anchor rules, including the edges (first and last utterance, a gap under 80 ms, cuts, overlaps). Property tests check that the stem length is always N.
- **Fit rules:**
  - the outcome table in §6.10;
  - the `timeFactor` semantics;
  - order-preserving pause assignment;
  - best-take ranking.
- **Duration model:** fit, refit and snapshotting.
- **Bangla:**
  - the syllable counter against 500 hand-labelled words;
  - the normaliser (ZWJ, khanda ta, nukta, numbers, ৳, %, dates and times) against the test oracles.
- **English:** the syllable counter against held-out CMUdict entries.
- **Selection gates:** protected tokens, negation counts, *sadhu* patterns, count violations.
- **Error classification:** the body-before-status table in §5.4.

### 11.2 Connector tests (recorded)
- Fixtures are recorded from real responses for each connector, including 401, 403 plan gates, `quota_exceeded`, 429, 5xx and refusals.
- They are replayed through an `httpx2.MockTransport`. The Anthropic connector gets it via `AsyncAnthropic(http_client=anthropic.DefaultAsyncHttpxClient(transport=mock), max_retries=0)`.
- CI runs with no keys and no network.

### 11.3 Pipeline and protocol tests
- **Fake-connector end-to-end:** deterministic transcripts, speech-like synthetic takes, a fixed duration model. It asserts:
  - a sample-exact stem;
  - start errors within tolerance;
  - a stable flags list;
  - resume after a forced pause;
  - from M3, revert, regenerate and region re-render equal a full render.
- **Protocol tests** over real stdin/stdout:
  - framing, -32700 and -32600;
  - out-of-order responses;
  - every state transition in §4.2;
  - `job.cancel` mid-run (response only after the tasks stop, then `job.cancelled`, then resume);
  - `job.open` after a restart;
  - exit on EOF with the job persisted as `paused`.
- **Live smoke tests:** only when keys are in the environment. Three 30 s clips: English, Bangla and Banglish.

### 11.4 Bake-off (the M2 gate)
- **Data:** 2–3 h of the product owner's own clips: Bangladeshi Bangla (formal and colloquial), Banglish, English, noisy audio, two speakers. Word boundaries are labelled by hand for 150 utterances.
- **Tool:** a `redub-eval` CLI, with dev-only dependencies, reports:
  - WER/CER (`jiwer`);
  - word-boundary error;
  - outcome rates and the α distribution;
  - start error, measured both by the engine's own onset check and against the hand labels;
  - re-transcription CER of the dub.

  It also exports a blind rating sheet covering meaning, naturalness and "sounds like the speaker".
- **Decisions it drives:**
  1. Default Bangla ASR: Scribe v2 or MAI-Transcribe-2.
  2. Default Bangla voice path: ElevenLabs v4 clone or Azure bn-BD stock, or adding a Sarvam or Gemini connector later.
  3. Opus 5.5 effort.
  4. `tolerance`, `min_fill`, the stretch bands and the duration-model seeds.
  5. The filler lists.

## 12. Milestones

| ID | Deliverable | Exit check |
|---|---|---|
| M0 | Foundations: `rpc` (including `job.open` and the state machine), the job store, `audio` (I/O, loudness, true peak, limiter), `timing` (VAD regions, anchors, slots, fit table), fake connectors, and a pipeline skeleton (ingest → segment → fake rewrite → fake TTS → fit → place → mix → stem export), plus the CLI | Unit tests and protocol tests pass; the fake end-to-end run is sample-exact |
| M1 | English end-to-end: Scribe v2, Claude rewrite with selection and meaning check, ElevenLabs v4 (clone and stock), probes, all exports | Live English smoke test passes; ≥ 85% `fit` on a 10-minute English test video |
| M2 | Bangla: `lang/bn` (normaliser, syllable counter, rules, spelling table), the Azure MAI and Azure neural connectors with probes, `redub-eval`, the bake-off | Bake-off report produced; Bangla defaults chosen; §2 Bangla targets met, or a documented decision to add a connector |
| M3 | Editing and cost: `segment.*`, versions, region re-render, the `job.analyze` estimate, the spend cap | Edit-loop tests pass; `segment.regenerate same_text` p90 < 10 s over 20 sentences on a Creator-tier key (`new_rewrite` p90 is measured and reported) |
| M4 | Packaging: PyInstaller onedir builds (Windows x64, macOS arm64/x64), LGPL ffmpeg, signing and notarization, `THIRD_PARTY_LICENSES.md`, Electron and Tauri integration examples | Signed builds launch from the sample Electron and Tauri apps and pass the protocol suite |

**Later (not in v1):** lip-sync, Sarvam and Gemini TTS connectors, more languages, local or offline models, C2PA, separating music from mixed dialogue, re-voicing overlapping speech, per-speaker stem export.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Bangla transcription errors on colloquial speech or Banglish become wrong "corrections" | `[?]`-marked words are protected; flags show in the editor; the bake-off picks the vendor; glossary keyterms. |
| Bangla cloned voices sound off (clones from Bengali reference audio are unverified on ElevenLabs) | M2 bake-off; stock voices with rate control as an alternative; the connector design allows adding Sarvam or Gemini. |
| No speed control on ElevenLabs v4 | Rewrite to a budget using syllables measured in code; 3 takes with different seeds; bounded stretch; an exact-timing Azure fallback voice; original audio kept with a flag as the last resort. |
| Vendor churn (MAI is in preview and its promo price ends 2026-12-31; ElevenLabs models change) | Capability-flagged connectors and per-voice probes; a configurable price table; recorded-fixture tests that catch API drift early. |
| Meaning drift or changed names, numbers or negations | Hard gates plus the meaning check; step-down strictness levels; the deterministic light fallback; a full `changes.json` audit. |
| Licence contamination | The exclusion list in §3.2, a licence register, and a CI licence gate. |
| Consent and deepfake misuse | The consent gate, per-job voice deletion, metadata disclosure, and the Free-tier licence warning. |
