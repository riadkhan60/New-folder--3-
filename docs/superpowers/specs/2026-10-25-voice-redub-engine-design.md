# Redub Engine — Design Spec

**Status:** Draft for review (2026-10-25)
**Scope:** Design for v1 of an AI tool that "beautifies" the spoken voice in a video. It fixes grammar, removes fillers and false starts, and improves wording **in the same language**. It then re-voices the speech with clean, high-quality audio that stays in sync with the original timeline. English and Bangla come first.
**Supporting research:** [`docs/superpowers/research/2026-10-25-voice-redub-research-briefing.md`](../research/2026-10-25-voice-redub-research-briefing.md). The briefing was written before the product decisions below. Where the two disagree, this spec wins.

---

## 1. Product decisions (agreed with the product owner)

| # | Decision | Choice |
|---|---|---|
| D1 | Who uses it | Our own desktop video editor (Electron/Tauri). This project builds **only the engine**; the editor UI belongs to the editor team. |
| D2 | Where AI runs | **Cloud AI services only.** No local AI models, GPU or large downloads. Light audio processing (speech detection, stretch, mix) runs locally on CPU. |
| D3 | API keys | **Users bring their own keys.** The editor stores them in the OS keychain and hands them to the engine at runtime. There is no backend server of ours. |
| D4 | Engine form | **Python sidecar** that the editor launches and talks to over stdin/stdout. |
| D5 | Approach | **Pluggable connectors with a small default set.** ElevenLabs and Anthropic keys are required. An Azure Speech key is optional and improves Bangla. More vendors can be added later as connectors. |
| D6 | Voice | **Both**, chosen per speaker: clone the original speaker, or pick a stock voice. |
| D7 | Render mode | **Full re-voice.** Every sentence is regenerated. When a sentence can't be fitted, the original audio is kept for that sentence and flagged. |
| D8 | Review flow | **Automatic, fix afterwards.** The dub is generated in one go; the user then edits or regenerates any single sentence. |
| D9 | Lip-sync | **Not in v1.** Each sentence keeps its original start time, length and pauses. |
| D10 | Bangla style | **Bangladesh standard:** Bangla Academy spelling, colloquial *cholito* register, and natural English loanwords kept as spoken. |
| D11 | Languages | English and Bangla (bn-BD first; bn-IN accepted), including code-mixed Banglish. |

## 2. Goals, non-goals, success criteria

### Goals
1. The editor hands over a dialogue track. It gets back a dub track **with exactly the same length in samples**, in which every sentence starts within −20 / +40 ms of the original sentence start.
2. The rewritten text is grammatical, natural and keeps the meaning. Names, numbers and negations are never changed.
3. Each sentence can be edited and regenerated in seconds, without reprocessing the job.
4. The engine is commercially shippable: no GPL or non-commercial components are bundled.

### Non-goals (v1)
- Lip-sync and other video re-rendering.
- Translation into another language.
- Separating music from dialogue. v1 assumes the dialogue track holds speech plus room noise, with music on separate editor tracks.
- Local or offline AI models.
- Plugins for third-party editors (Premiere, Resolve and others).
- Real-time or live processing.

### Success criteria (checked on the bake-off set, §11.4)
| Metric | Target |
|---|---|
| Sentences placed without a `stretch_flagged` or `overflow_review` flag | ≥ 85% (English), ≥ 75% (Bangla) |
| Sentence start error, median / p95 | ≤ 20 ms / ≤ 40 ms |
| Meaning preserved (native rater, 1–5) | ≥ 4.5 on ≥ 95% of sentences |
| Voice naturalness (blind rating, 1–5) | ≥ 4.0 English, ≥ 3.8 Bangla |
| Output sample count equals input sample count | 100% |
| Cost per minute of video at list prices, before the voice-cleanup add-on | ≤ $0.60 |

## 3. Architecture

```
┌──────────────── Editor (Electron or Tauri) ─────────────────┐
│ UI · stores user keys in OS keychain · places returned audio │
└──────────────┬───────────────────────────────────────────────┘
               │ spawn; JSON-RPC 2.0 as NDJSON over stdin/stdout
               │ (audio exchanged as file paths, never through the pipe)
┌──────────────▼──────────────── redub-engine (Python 3.13) ───┐
│ rpc/        NDJSON JSON-RPC loop, method table, events        │
│ jobs/       job store (SQLite + audio cache), state machine    │
│ pipeline/   ingest → transcribe → segment → voices → rewrite   │
│             → synthesize → fit → place → mix → export          │
│ timing/     VAD, slots & budgets, syllable counting, duration  │
│             model, pause detection, time-map stretch           │
│ lang/       language packs: en, bn                             │
│ connectors/ asr/ llm/ tts/ isolate/ — capability-declared      │
│ audio/      ffmpeg I/O, resample, loudness, fades, limiter     │
│ export/     stem, clips, manifest, SRT/VTT, changes, QC report │
│ cli/        `redub` command for testing without an editor      │
└───────────────────────────────────────────────────────────────┘
        │ HTTPS (user's keys)
        ▼
  ElevenLabs (Scribe v2 transcription · Eleven v4 voices + cloning · Voice Isolator)
  Anthropic (Claude Opus 5.5 rewrite · Claude Haiku 5.5 meaning check)
  Azure Speech, optional (MAI-Transcribe-2 transcription · bn-BD/bn-IN/en neural voices)
```

**Code location:** a self-contained `redub-engine/` directory in this repository. It has no dependencies on the rest of the repo, so it can move to its own repository unchanged.

### 3.1 Module responsibilities

| Module | Does | Depends on |
|---|---|---|
| `rpc` | Reads one JSON object per stdin line and dispatches to handlers. Writes responses and events to stdout from a single locked writer. Logs go only to stderr. Exits on stdin EOF. | `jobs`, `pipeline` |
| `jobs` | Persists jobs, speakers, segments, text versions, takes and spend in `job.sqlite`. Caches each stage's output, keyed by a hash of its inputs, so re-runs skip finished work. | stdlib `sqlite3` |
| `pipeline` | Orchestrates the stages, holds per-provider concurrency limits, and applies the fallback chain. | everything below |
| `timing` | All time math in integer samples. Owns slots, budgets, the duration model, stretch decisions and the time map. | `lang`, `audio` |
| `lang/en`, `lang/bn` | Text normalisation, TTS-text expansion, syllable counting, filler hints, rewrite rules and the spelling table. | none (pure Python) |
| `connectors` | One adapter per vendor service, each implementing one of the interfaces in §5 and declaring its capabilities. | `httpx`, `anthropic` |
| `audio` | Decode, encode and resample via ffmpeg. Fades, gain, loudness (BS.1770) and the final limiter. | numpy, soundfile, ffmpeg |
| `export` | Writes every deliverable in §8. | `audio`, `jobs` |

### 3.2 Runtime and dependencies (all permissive licences)

| Purpose | Choice | Licence |
|---|---|---|
| Language runtime | Python 3.13 | PSF |
| HTTP | `httpx` (async) | BSD-3 |
| Claude | `anthropic` official SDK | MIT |
| Schemas / validation | `pydantic` v2 | MIT |
| Grapheme-aware text (subtitle character counts) | `regex` | Apache-2.0 |
| Arrays / WAV I/O | `numpy`, `soundfile` (bundles libsndfile as a shared library) | BSD / LGPL-2.1 shared lib |
| Time-stretch | `python-stretch` 0.3.x (Signalsmith Stretch) | MIT |
| Stretch fallback | ffmpeg `atempo` | LGPL |
| Speech detection (VAD) | `silero-vad-lite` 0.4.x: Silero v6 model, no torch, Intel and Apple-silicon Mac wheels | MIT |
| Media tool | `ffmpeg` **LGPL build** as a separate executable called by subprocess. Windows: pinned BtbN `lgpl` release. macOS: built in our CI without `--enable-gpl` / `--enable-nonfree`. | LGPL-2.1 |

**Explicitly excluded,** because of GPL or non-commercial licences, or because they pull in torch: Rubber Band and `pyrubberband`, `pedalboard`, `pytsmod`, `phonemizer` / espeak-ng, the `silero-vad` pip package (it requires torch), PyAV wheels (they bundle x264/x265), the `cmudict` and `syllables` pip packages, and the csebuetnlp normalizer. The repo keeps a `THIRD_PARTY_LICENSES.md` register, plus the LGPL notice and source offer for ffmpeg.

### 3.3 Packaging and launch
- **Build:** PyInstaller 6.x, **onedir, console mode.** Windowed mode sets `sys.stdout` to `None` on Windows, which breaks the protocol.
  - Build the bootloader from source, which reduces antivirus false positives.
  - Pass `--noupx`, `--python-option u` and `--python-option "X utf8"`.
  - The engine also calls `sys.stdout.reconfigure(encoding="utf-8", newline="\n")` and flushes after every message. Windows pipes otherwise default to the ANSI code page, which breaks Bangla text.
  - Onefile is not used: it extracts to a temp folder on every launch, leaves folders behind when killed, and its embedded libraries can't be re-signed.
- **Targets:** Windows 10/11 x64, macOS 13+ arm64, and macOS 13+ x64.
- **Signing:**
  - **macOS:** every Mach-O file, including ffmpeg, is signed with a Developer ID, hardened runtime and a secure timestamp, then notarized with `notarytool`.
  - **Windows:** every `.exe`, `.dll` and `.pyd` in the onedir is signed (Artifact Signing). Smart App Control blocks unsigned code, and EV certificates no longer bypass SmartScreen.
  - The engine folder is signed **before** it goes to the editor's bundler, since Tauri does not sign `bundle.resources`.
- **Electron:**
  - Ship the onedir in electron-builder `extraResources`, or Forge `packagerConfig.extraResource`. It cannot be spawned from inside `app.asar`.
  - Resolve it via `process.resourcesPath`.
  - Launch with `child_process.spawn(exe, [], {stdio:'pipe', windowsHide:true, env:{...minimalEnv, PYTHONUTF8:'1', PYTHONUNBUFFERED:'1'}})`. `utilityProcess` can't run native binaries.
  - Read stdout line by line and always drain stderr.
  - On quit, send `engine.shutdown`, then close stdin. Windows `kill()` is always forceful.
- **Tauri v2:**
  - Ship the signed onedir as `bundle.resources`.
  - Spawn it from Rust with the shell plugin's `Command` and a `$RESOURCE/...` path, behind narrow `#[tauri::command]`s, so the webview holds no shell permissions.
  - Capability scope: `shell:allow-spawn` (with an argument validator), `shell:allow-stdin-write` and `shell:allow-kill`.
- **Startup target:** `engine.hello` answered in under 2 s on a mid-range laptop.

### 3.4 Concurrency model
- One asyncio event loop.
- A reader thread feeds stdin lines into an asyncio queue.
- Network calls use async `httpx`, plus `AsyncAnthropic` for Claude.
- CPU work (VAD, stretch, mixing) runs in a thread pool; numpy and Signalsmith release the GIL.
- Each provider has its own semaphore. Defaults:
  - **ElevenLabs:** taken from the user's plan tier (Free 2, Starter 3, Creator 5, Pro 10, Scale/Business 15 concurrent TTS requests). It adapts at runtime from the `maximum-concurrent-requests` response header.
  - **Azure:** 4 concurrent requests.
  - **Anthropic:** 4 concurrent requests.
- Utterances are processed in parallel within those limits.

## 4. Editor ↔ engine protocol

**Transport:** JSON-RPC 2.0. Each message is one JSON object on one line (NDJSON), UTF-8, with `ensure_ascii=False`. Lines are limited to 16 MB. stdout carries only protocol messages; stderr carries logs, with API keys redacted. The engine exits when stdin closes.

**Time representation:** every time value is an **integer sample index at the job sample rate, 48 000 Hz**. Frame rate is a rational string such as `"30000/1001"`, sent with a `drop_frame` boolean. Timecode is never computed inside the engine; the editor converts.

**Versioning:** `engine.hello` returns `protocol: 1`. Any breaking change increments it.

### 4.1 Requests

| Method | Params | Result |
|---|---|---|
| `engine.hello` | none | `{version, protocol, connectors:[{id, kind, capabilities}]}` |
| `engine.configure` | `{keys:{elevenlabs, anthropic, azure?:{key, region}}, elevenlabs_tier?, prices?, defaults?}` | `{ok}`. Keys are held in memory only. |
| `providers.check` | none | Per provider: `{ok, error?, quota?}`. Calls the cheapest authenticated endpoint each vendor offers. |
| `voices.list_stock` | `{language}` | `[{voice_id, provider, name, gender, locale, preview_url, rate_control}]` |
| `job.create` | see §4.3 | `{job_id}` |
| `job.analyze` | `{job_id}` | Runs ingest, transcription and segmentation only. Returns `{language, speakers:[…], segments:[…], estimate:{usd_low, usd_high, breakdown}}`. |
| `speakers.set_voice` | `{job_id, speaker_id, mode:"clone"\|"stock"\|"existing", stock_voice_id?, existing_voice_id?, consent?:{confirmed_by, confirmed_at}}` | `{ok}`. `consent` is required when `mode="clone"`. |
| `job.run` | `{job_id, spend_cap_usd?}` | `{ok}`. Progress arrives as events. |
| `job.cancel` | `{job_id}` | `{ok}` |
| `job.get` | `{job_id}` | Full state: `{status, speakers, segments, spend, outputs?}` |
| `segment.update_text` | `{job_id, segment_id, text}` | `{segment, warning?}`. Re-voices with the user's text. No AI rewrite runs. |
| `segment.regenerate` | `{job_id, segment_id, mode:"same_text"\|"new_rewrite"}` | `{segment}` |
| `segment.revert` | `{job_id, segment_id}` | `{segment}`. Restores the previous version from cache, at no cost. |
| `segment.use_original` | `{job_id, segment_id, clean?:bool}` | `{segment}`. Uses the original audio; `clean` runs it through the Voice Isolator. |
| `job.export` | `{job_id, formats:[…]}` | `{paths:{…}}` (see §8) |
| `job.delete` | `{job_id, keep_voices?:bool}` | `{ok}`. Deletes the job folder and any cloned voices on the provider. |
| `engine.shutdown` | none | `{ok}`, then the engine exits. |

### 4.1a Job states

```
created ──job.analyze──► analyzed ──job.run──► running ──► completed
                                                  │  ▲
                 quota_exhausted / spend cap ─────┘  └──job.run── paused
                 job.cancel ──► cancelled          fatal error ──► failed
```

- `segment.*` methods are allowed only in `completed`.
- `job.run` on a `paused` job resumes from the job store; no finished stage is repeated.
- `job.delete` is allowed in any state except `running`; cancel first.

### 4.2 Events (notifications, engine → editor)
- `job.progress {job_id, stage, done, total}`
- `segment.updated {job_id, segment}`
- `job.completed {job_id, outputs}`
- `job.failed {job_id, error}`
- `provider.warning {provider, code, message}`: rate limited, low quota, price promotion ending, and similar.

### 4.3 `job.create` params
```json
{
  "job_dir": "/path/chosen/by/editor/job-0001",
  "dialogue_path": "/path/dialogue.wav",
  "speaker_tracks": [{"path": "/path/mic1.wav", "label": "Host"}],
  "timeline": {"start_sample": 0, "fps": "30000/1001", "drop_frame": true, "cuts": [1441440]},
  "language": "auto",
  "locale": "bn-BD",
  "strictness": "clean",
  "ambience": "clean",
  "glossary": ["Qbexel", "API"],
  "options": {"tolerance": 0.10, "min_fill": 0.75, "min_clone_seconds": 30}
}
```
- `dialogue_path` may be any format ffmpeg can decode. The engine resamples to 48 kHz mono float32 for processing.
- `speaker_tracks` is optional. When given, diarization uses the tracks instead of the AI's guess.
- `cuts` is optional: the shot-cut sample positions. A sentence never borrows silence across a cut.
- `language` is `"auto"`, `"en"` or `"bn"`.
- `strictness` is `"light"`, `"clean"` or `"polish"` (§6.6).
- `ambience` is `"clean"` (true silence between sentences) or `"keep"` (the original room tone fills the gaps).

### 4.4 Segment object
```json
{
  "id": "u_0042",
  "speaker_id": "S1",
  "src":  {"start": 1234560, "end": 1401600},
  "slot": {"start": 1232160, "end": 1420800},
  "phrases": [{"start": 1234560, "end": 1310400}, {"start": 1329600, "end": 1401600}],
  "original_text": "so uh we we gonna start the the video now",
  "text": "So, we're going to start the video now.",
  "version": 2,
  "status": "done",
  "take": {"path": "…/takes/u_0042_v2_t1.wav", "stretch": 0.97, "fit": "ok", "voice": "S1-clone"},
  "flags": ["low_asr_confidence"],
  "edits": [{"type": "filler_removed", "src": "uh"},
            {"type": "repetition_removed", "src": "we"},
            {"type": "grammar", "src": "we gonna", "dst": "we're going to"}]
}
```
- `status` values: `pending`, `rewriting`, `synthesizing`, `done`, `flagged`, `original_kept`, `failed`.
- `flags` come from a closed list:

| Flag | Meaning |
|---|---|
| `stretch_flagged` | The take was stretched into the flagged band (§6.9). |
| `overflow_review` | The sentence could not be fitted; the original audio was kept. |
| `low_asr_confidence` | The transcription service was unsure about some words. |
| `meaning_check_failed` | The meaning check failed even at the lightest edit level. |
| `protected_token_changed` | A name, number, glossary term or negation changed. |
| `overlap_speech` | Two speakers talk at once in this sentence. |
| `voice_fallback` | A different voice than the one chosen was used. |
| `clone_unavailable` | Too little clean speech to clone this speaker. |
| `text_too_long` | User-edited text exceeds the time budget. |

- `edits.type` values: `filler_removed`, `repetition_removed`, `false_start_removed`, `grammar`, `word_choice`, `rephrase`, `spelling`.

### 4.5 Errors
JSON-RPC error codes:

| Code | Name | Data |
|---|---|---|
| -32601 | method_not_found | none |
| -32602 | invalid_params | `{field, reason}` |
| -32001 | auth_failed | `{provider}` |
| -32002 | quota_exhausted | `{provider}`. The job is paused and resumable. |
| -32003 | provider_unavailable | `{provider, status}`, after retries are exhausted |
| -32010 | invalid_input | `{reason}`: silent, clipped, too long, undecodable, or unsupported language |
| -32011 | consent_required | `{speaker_id}` |
| -32012 | clone_unavailable | `{speaker_id, speech_seconds}` |
| -32020 | job_not_found | none |
| -32021 | job_state_conflict | `{status}` |
| -32030 | spend_cap_reached | `{spent_usd}`. The job is paused and resumable. |

## 5. Connectors

Every connector implements one interface and returns a `capabilities` object. The pipeline reads only these capabilities; it never branches on vendor names.

```python
class ASR(Protocol):
    caps: ASRCaps  # languages, word_timestamps, word_confidence, diarization, max_seconds, verbatim
    async def transcribe(self, audio: Path, lang: str | None, speakers: int | None,
                         keyterms: list[str]) -> Transcript: ...

class LLM(Protocol):
    async def rewrite(self, req: RewriteRequest) -> RewriteResponse: ...
    async def judge(self, req: JudgeRequest) -> JudgeResponse: ...

class TTS(Protocol):
    caps: TTSCaps  # languages, cloning, duration_control: "exact"|"rate"|"none",
                   # rate_range, alignment, max_chars, output_rates
    async def list_voices(self, language: str) -> list[StockVoice]: ...
    async def clone(self, name: str, reference: list[Path]) -> str: ...  # returns voice_id
    async def delete_voice(self, voice_id: str) -> None: ...
    async def synthesize(self, req: SynthRequest) -> Take: ...  # audio + optional char alignment

class Isolator(Protocol):
    async def isolate(self, audio: Path) -> Path: ...
```

### 5.1 v1 connectors

| Connector | Service and endpoint | Key facts verified 2026-10 |
|---|---|---|
| `asr.elevenlabs_scribe` (default) | `POST /v1/speech-to-text`, `model_id=scribe_v2` | <ul><li>`timestamps_granularity=word`, `diarize=true`, `num_speakers`, `language_code` (`en` / `bn`, or null for auto-detect), `keyterms`.</li><li>**Do not** set `no_verbatim`: fillers and false starts must be kept.</li><li>Bengali is in the 5–10% WER tier.</li><li>Price $0.22 per audio hour; files up to 10 h.</li></ul> |
| `asr.azure_mai` (optional; preferred for Bangla when present) | `POST {endpoint}/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, multipart `audio` + `definition` | <ul><li>Request: `enhancedMode:{enabled:true, model:"MAI-Transcribe-2", modelOptions:{timestamps:"word", transcribeStyle:"verbatim"}}` and `diarization:{enabled:true}`. `timestamps` defaults to `none`, so it **must** be set.</li><li>Upload mono 16 kHz FLAC.</li><li>Regions: `centralindia`, `eastus`, `northeurope`, `southeastasia`, `westus`, `westus2`.</li><li>Preview status.</li><li>Promo price of $0.10/h ends 2026-12-31; budget $0.36–0.54/h afterwards.</li><li>Chunk to ≤ 2 h / 250 MB.</li></ul> |
| `llm.anthropic` | Messages API via the `anthropic` SDK | See §6.6. |
| `tts.elevenlabs` | `POST /v1/text-to-speech/{voice_id}/with-timestamps`, `model_id=eleven_v4` | <ul><li>Bengali is supported **only** on `eleven_v4` / `eleven_v3`.</li><li>**No speed, style or SSML control**, so `duration_control="none"`.</li><li>Returns character-level `alignment`. Its availability on v4 is confirmed by a startup probe; when it is missing, `alignment=false`.</li><li>Continuity via `previous_text` / `next_text`.</li><li>`seed` for best-effort reproducibility.</li><li>Output `pcm_24000` by default; `pcm_44100` on tiers that allow it (a 403 `feature_not_available` triggers a downgrade). Resampled to 48 kHz locally.</li><li>10 000-character limit per request, read at runtime from `GET /v1/models`.</li><li>$0.08 per 1K characters.</li></ul> |
| `tts.elevenlabs` (cloning) | `POST /v1/voices/add` (multipart `name`, `files`, `remove_background_noise`) | <ul><li>1–2 minutes of clean reference audio is recommended; at least 10 s total is required.</li><li>Delete with `DELETE /v1/voices/{voice_id}`.</li><li>Whether clones built from **Bengali** reference audio sound right is unverified. This is a bake-off item (§11.4).</li></ul> |
| `tts.elevenlabs` (stock voices) | `GET /v1/shared-voices?language=bn` (or `en`) | A library voice is added to the user's account before use via `POST /v1/voices/add/{public_user_id}/{voice_id}`. |
| `tts.azure_neural` (optional) | REST `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`, SSML | <ul><li>Voices: `bn-BD-NabanitaNeural`, `bn-BD-PradeepNeural`, `bn-IN-TanishaaNeural`, `bn-IN-BashkarNeural`, plus English `*Neural` voices.</li><li>`<prosody rate>` works from 0.5 to 2×. `<mstts:audioduration>` is documented for prebuilt voices but unconfirmed for Bengali.</li><li>A startup self-test synthesises one short line per language and measures the result. It then sets `duration_control` to `"exact"` if audioduration works, otherwise `"rate"`.</li><li>REST returns no word timing (the engine doesn't need it, §6.8).</li><li>Output `riff-48khz-16bit-mono-pcm`.</li><li>$15 per 1M characters.</li></ul> |
| `isolate.elevenlabs` | `POST /v1/audio-isolation` | <ul><li>Returns MP3.</li><li>Limits: ≤ 500 MB and ≤ 1 h per file.</li><li>$0.12 per minute.</li><li>Used only for `segment.use_original {clean:true}`. It is never run on the whole job by default.</li></ul> |

**Not in v1:** Azure Personal Voice. It is a Limited Access feature that only Microsoft-managed customers can get, so bring-your-own-key users realistically can't use it.

### 5.2 Routing rules
1. **ASR:** if an Azure key is present and the job language is `bn` or `auto`, use `asr.azure_mai`; otherwise use `asr.elevenlabs_scribe`. This is the starting rule; the M2 bake-off may change it. If the first choice fails with `provider_unavailable`, the other one is tried.
2. **TTS for a speaker:** follows the voice the user chose in `speakers.set_voice`.
3. **Exact-timing fallback voice** (§6.10, step 4): the stock voice the user chose for that speaker if it has `duration_control != "none"`. Otherwise the default Azure voice for the language and the speaker's gender, if an Azure key is present.

### 5.3 Retries and limits (all connectors)

| Error | Handling |
|---|---|
| 429 rate limit or system busy | Exponential backoff with full jitter (base 1 s, max 30 s, 6 attempts). The engine also honours `retry-after`. |
| 401 / 403 | Fail fast with `auth_failed`. |
| Quota or credit exhausted (ElevenLabs `quota_exceeded`, Azure 403 quota) | Pause the job and return `quota_exhausted`. |
| 5xx or timeout | 3 retries, then the segment fails with `provider_unavailable`. The job continues. |

## 6. Processing pipeline

### 6.1 Ingest
1. Decode `dialogue_path` with ffmpeg to 48 kHz mono float32, giving the **master clock**. Record its sample count N; the output stem will have exactly N samples.
2. Make a 16 kHz mono copy for VAD and transcription.
3. Reject the input with `invalid_input` if any of these hold:
   - it is under 1 s or over 3 h;
   - it is more than 95% silence;
   - more than 1% of samples are clipped (`|x| ≥ 0.999`).

### 6.2 Speech detection (pause map)
- **VAD settings:** `silero-vad-lite` at 16 kHz, threshold 0.5, minimum speech 150 ms, minimum silence 200 ms, 50 ms padding.
- Gaps shorter than 200 ms are merged.
- The engine stores every speech region and every non-speech gap.
- **Room tone:** the quietest 2–10 s of non-speech gaps are saved for `ambience:"keep"`.

### 6.3 Transcription and word timing
1. Send the 16 kHz audio (chunked at VAD gaps if it exceeds the connector's `max_seconds`) with:
   - glossary terms as `keyterms`;
   - the speaker count, if `speaker_tracks` were given.
2. **Word-boundary refinement (local, cheap):** move each word start and end to the lowest-energy 5 ms frame within ±30 ms. Then enforce:
   - word starts must increase monotonically;
   - every word is at least 40 ms long;
   - every word lies inside a VAD speech region, padded by 100 ms.
3. Flag words as `low_asr_confidence` on their segment when they:
   - violate the checks after refinement; or
   - fall below 0.5 confidence, on connectors whose `caps.word_confidence` is true. Azure LLM-speech-style confidences that are always 0 are treated as absent.
4. The ASR's language becomes the job language when `language:"auto"`.

### 6.4 Segmentation
- A **phrase** is a run of words between pauses of 300 ms or more. Phrases are the timing anchors.
- An **utterance** (= segment) ends at:
  - a speaker change;
  - sentence-final punctuation (`. ? ! ।`) followed by a pause of 300 ms or more;
  - a 15 s length cap, split at the longest internal pause.
- **Overlap:** two words from different speakers whose time ranges intersect. An utterance containing one is flagged `overlap_speech`, and the overlapping span (plus 50 ms on each side) is always rendered from the original audio.

### 6.5 Voices per speaker
- **Default:**
  - "clone" if the speaker has at least `min_clone_seconds` (default 30 s) of clean speech;
  - otherwise "stock", with `clone_unavailable` set.
- The editor must call `speakers.set_voice` with consent before any clone is created; otherwise `job.run` returns `consent_required`.
- **Clone reference selection:**
  1. Take segments from that speaker that have no `overlap_speech`, no `low_asr_confidence`, and a loudness within ±6 dB of the speaker median.
  2. Concatenate the longest ones up to 90 s, with 300 ms silences between them.
  3. Encode as MP3 at 192 kbps or higher and normalise to about −20 dBFS RMS.
  4. Set `remove_background_noise=true` only when the estimated SNR is below 20 dB; cleaning a reference can lower clone similarity.
- The cloned `voice_id` is stored on the speaker. It is deleted from the provider at `job.delete` unless `keep_voices:true`.

### 6.6 Rewrite (Claude)

**Models:**
- **Rewrite:** `claude-opus-5-5`, with adaptive thinking (Opus 5.5 cannot disable thinking). `output_config.effort` is set **explicitly**, starting at `"medium"` and tuned in the bake-off.
- **Meaning check:** `claude-haiku-5-5` with `output_config.effort: "low"`. Haiku 5.5 has no server-side refusal fallback, so a refusal from the judge counts as a failed check.

**API rules that apply** (current API):
- **Structured outputs:** use `client.messages.parse(..., output_format=<pydantic model>)`.
- **No sampling parameters:** `temperature`, `top_p` and `top_k` return a 400. Variety between candidates comes from explicit length targets in the prompt.
- **No forced tool choice:** `tool_choice` `any` / `tool` return a 400.
- **Refusals:**
  - Send the server-side fallback `fallbacks:"default"` with the `server-side-fallback-2026-07-01` beta.
  - Always check `stop_reason == "refusal"` before reading content.
  - If a refusal still arrives, the segment drops to the deterministic light edit (step 5 below).
- **Prompt caching:** a stable system prompt holds the language-pack rules and is cached; per-chunk content goes after the cache breakpoint.
- **`max_tokens`:** 16 000, non-streaming. Outputs are small.

**Chunking:**
- Each request covers 2–4 consecutive utterances, in timeline order, from any speakers, each labelled with its speaker.
- Each request includes the original text of the 2 previous and 2 next utterances as read-only context, plus the glossary.
- Context is original text rather than rewritten text, so chunks can run in parallel.

**Strictness levels:**

| Level | Allowed edits |
|---|---|
| `light` | Remove fillers, repetitions and false starts; fix only clear grammatical errors. No rewording. |
| `clean` (default) | `light`, plus fix grammar (agreement, tense, word order) and replace wrong or poor word choices, keeping the speaker's vocabulary and register. |
| `polish` | `clean`, plus rephrase for clarity and flow; sentences may be restructured. Never adds facts or opinions. |

**Language-pack rules** (go in the system prompt):
- **Both languages:**
  - Same language as the input.
  - Keep the speaker's person, tense intent, tone and politeness level.
  - Never change names, numbers, units, dates, negations or glossary terms.
  - Do not "fix" words marked `[?]` (low ASR confidence) beyond spelling.
- **Bangla (bn-BD):**
  - Cholito register only; never sadhu.
  - Bangla Academy standard spelling. Includes a curated table of common misspellings mapped to standard forms (e.g. সরকারী→সরকারি, দাবী→দাবি), about 200 entries, built with a native reviewer in M2. No permissively licensed Academy lexicon exists.
  - Keep English loanwords exactly as the speaker used them, in the same script.
  - Display text uses Bengali digits.
  - Filler hints: এই, মানে, আসলে, তো, উম, আ, plus repeated words. Each one is removed only when it is used as filler.
- **English:**
  - Keep the speaker's dialect (US/UK/IN spelling follows the transcript).
  - Filler hints: um, uh, like, you know, I mean, sort of, kind of. Each one is removed only when it is used as filler.

**Request and response contract (per chunk):**
```python
class UtteranceIn(BaseModel):
    id: str
    phrases: list[str]          # original verbatim text per phrase, low-confidence words as "word[?]"
    target_syllables: int       # from §6.7
    target_words: int           # from §6.7

class RewriteRequest(BaseModel):
    language: Literal["en", "bn"]
    strictness: Literal["light", "clean", "polish"]
    glossary: list[str]
    context_before: list[str]
    context_after: list[str]
    utterances: list[UtteranceIn]

class Candidate(BaseModel):
    length: Literal["short", "target", "long"]   # target-8% / target / target+8%
    phrases: list[str]          # same count as input phrases; "" if that phrase was pure filler
    edits: list[Edit]           # type + src/dst, for changes.json

class UtteranceOut(BaseModel):
    id: str
    candidates: list[Candidate]  # exactly 3

class RewriteResponse(BaseModel):
    utterances: list[UtteranceOut]
```
If the model cannot keep the phrase structure (possible in `polish`), it returns a single phrase. That utterance then fits as one piece (§6.9).

**Selection (code, not the model):**
1. **Hard gates** reject a candidate when:
   - its language or script differs from the input;
   - a protected token is missing or changed: glossary terms and numbers (compared after normalisation), and names (proper nouns found in the original);
   - the negation count changed. Bangla markers: না নি নেই নয় নাই. English markers: not, n't, no, never.
   - it is a Bangla candidate containing sadhu verb forms (pattern list).
2. **Fit:** the predicted duration (§6.7) must lie inside the acceptance window `[min_fill × target, (1 + tolerance) × target]`.
3. **Pick** the in-tolerance candidate with the fewest edits at the chosen strictness. On a tie, pick the closest to target.
4. **Feedback loop:** if no candidate fits, send numeric feedback, up to 3 rounds. Example: *"u_0042 phrase 2 is 23 syllables; it must be 16–20."* Keep only candidates that move closer to target.
5. **Meaning check** (Haiku 5.5): `{same_meaning: bool, issues: [str]}` comparing the original with the chosen text. On failure:
   - retry once at the same level;
   - then step down a level (polish → clean → light);
   - if `light` still fails, use the **deterministic light edit**: the verbatim transcript minus the filler-hint tokens and immediate word repetitions. The segment gets `meaning_check_failed`.

### 6.7 Time budget and duration model
- **Slot:** `[first_word_start − 50 ms, min(next_utt_start − 80 ms, last_word_end + borrow)]`.
  - `borrow = max(0, min(0.5 × gap, gap − 150 ms))`.
  - `borrow = 0` when the next utterance is by another speaker or a `cut` lies inside the gap.
- **Filler pre-marking (deterministic):** before the rewrite, code marks *probable* filler time in each phrase, made of:
  - standalone filler-hint tokens (§6.6);
  - immediate word repetitions;
  - vendor audio-event tags;
  - the gaps next to any of the above, up to 150 ms each.
- **Target duration per phrase:** phrase span minus marked filler time, at least 0.6 × the phrase span. The utterance target is the sum over its phrases. Time a removed filler occupied stays as **silence at its original position**, so text is never padded to fill it.
- **Acceptance window:** a predicted or measured duration is accepted if it lies in `[min_fill × target, (1 + tolerance) × target]`.
  - Defaults: `min_fill = 0.75`, `tolerance = 0.10`.
  - Short is tolerated more than long, because a missing word becomes a pause while extra words would overrun the next sentence.
- **Duration model** (per voice and language): `predicted_sec = syllables / rate + k × pause_marks + c`. `pause_marks` counts commas, dandas and periods inside the text.
  - **Seed values:**

    | Voice language | `rate` (syllables/s) | `k` | `c` |
    |---|---|---|---|
    | English | 5.0 | 0.15 s | 0.10 s |
    | Bangla | 5.5 | 0.15 s | 0.10 s |

  - **Refit:** after every take, by least squares on that voice's (syllables, pause_marks, measured speech duration) history, once at least 5 takes exist.
- **Syllable counting:**
  - **English:** a vendored `cmudict.dict` (BSD-licensed data, read by our own loader), falling back to vowel-group counting for words not in the dictionary.
  - **Bangla:** our own rule-based counter that follows Epitran's `ben-Beng` rules.
    - Vowel signs and independent vowels each count as a nucleus.
    - A consonant with no vowel sign carries an inherent vowel. That vowel is deleted before a vowel, word-finally after a single consonant, and in the middle of a VC_CV pattern.
    - A word-final conjunct keeps its vowel.
    - Hasanta (্) and ৎ kill the vowel. ং, ঃ and ঁ add no syllable.
    - Expected accuracy is about 90–97% per word; the per-voice refit absorbs the bias.
    - Latin-script words inside Bangla text are counted with the English counter.
- `target_syllables = round((target_sec − k × pause_marks_original − c) × rate)`. `pause_marks_original` counts the pause marks in the original transcript.
- `target_words = round(target_syllables / spw)`. `spw` is the original utterance's own syllables-per-word ratio, after removing pre-marked fillers.

### 6.8 TTS text normalisation (`lang` packs)
Display text (shown to the user and used in subtitles) and **TTS text** (sent to the voice service) are kept separately, with an index map between them.

**Bangla TTS text:**
1. **ZWJ and khanda ta:**
   - Map a legacy ত্‍ (ta + hasanta + ZWJ) to ৎ.
   - Keep ZWJ in র‍্য.
   - Drop all other ZWJ and ZWNJ characters.
2. **NFC normalisation.** NFC decomposes ড় ঢ় য় into base letter + nukta; that form is accepted.
3. **Expand numbers with our own code:**
   - Merge lakh-style comma groups (১,২৫,০০০) before parsing.
   - Integers → words with lakh/koti grouping in colloquial forms (দুশো, পাঁচশো).
   - Decimals → digit by digit after দশমিক.
   - ৳ / টাকা / পয়সা, %, times (১০:৩০ → দশটা ত্রিশ), dates (২৫/১০/২০২৬ → পঁচিশে অক্টোবর দুই হাজার ছাব্বিশ), and ordinals (১ম → প্রথম).
   - `num2words(lang="bn")` and `bangla-text-normalizer` are used only as **test oracles**. Each has known bugs (dropped minus signs, broken lakh commas, unexpanded ৳), and num2words is LGPL.
4. Run `bnunicodenormalizer` (MIT) per Bengali word, after expansion, because it strips ৳ and %. It runs with `allow_english=True` and guards against a `None` result.

**English TTS text:** expand numbers, currency, dates, times and abbreviations, and keep the case of acronyms.

### 6.9 Synthesis and fit

**Synthesis, by the voice's `duration_control`:**

| Control | Strategy |
|---|---|
| `exact` | One take per utterance with SSML `mstts:audioduration` set to the target. |
| `rate` | First take at `rate = predicted / target`, clamped to the voice's range. Measure it; if it falls outside the silent band, make one more take with a corrected rate. |
| `none` (ElevenLabs v4) | One take. If outside the silent band, make up to 2 more takes; the second is preceded by a fresh rewrite (§6.6 step 4) when the miss exceeds 12%. Keep the best by `|log(α)|`. |

- Each request carries `previous_text` / `next_text`, where the connector supports it, and a fixed `seed`. The neighbours' final text is used when it is already chosen; otherwise their original text.
- The whole utterance is synthesised in one request, for natural prosody.

**Fit:**
1. **Trim** leading and trailing silence; the threshold is the voice's measured noise floor + 6 dB.
2. **Find internal pauses** in the take with VAD and an energy check (≥ 120 ms). This works for every voice service and needs no word timing from the provider.
3. **Phrase time map:** if the candidate kept the phrase structure and the take has at least `phrases − 1` internal pauses, the pauses at phrase boundaries become breakpoints, chosen as the pauses nearest each phrase boundary's proportional character position. Each piece is then mapped onto the corresponding original phrase interval. Otherwise the utterance is one piece.
4. **Pause shaping:**
   - A pause at a phrase boundary is resized toward the original pause length.
   - Other internal pauses are compressed to 80 ms (120 ms before sentence-final punctuation) if the take is too long, or left alone otherwise.
5. **Stretch each piece** with factor α = target_len / current_len, using Signalsmith with `timeFactor = 1/α`. Note the semantics: output length = input length / `timeFactor`.

   **Piece too long (α < 1):**

   | Band | α range | Action |
   |---|---|---|
   | Silent | 0.88 ≤ α < 1 | Compress. |
   | Flagged | 0.80 ≤ α < 0.88 | Compress and set `stretch_flagged`. |
   | Out of band | α < 0.80 | Do not stretch; go to the fallback chain (§6.10). |

   **Piece too short (α > 1):**
   - Leave the leftover time as silence after the piece.
   - Expand only when the piece would still be shorter than `min_fill × target`: up to α = 1.08 silently, or up to 1.12 with `stretch_flagged`.
   - If it is still below `min_fill` after that, go to the fallback chain, which starts with a longer rewrite.
6. **Placement inside the phrase:** each piece starts at the phrase's first non-filler word start, so leftover time and removed-filler time become pauses where the speaker originally paused or hesitated.

### 6.10 Fallback chain (when a take can't fit)
1. **Shorter or longer rewrite** with a hard syllable cap (or floor). This runs inside the 3-round limit of §6.6.
2. **Borrow more silence:** up to 120 ms of lead-in before the first word, if the gap allows and there is no cut.
3. **Exact-timing voice:** synthesise with the fallback voice (§5.2, rule 3) and set `voice_fallback`.
4. **Keep the original audio** for the segment and set `original_kept` + `overflow_review`. The audio passes through the Voice Isolator only if the user later calls `segment.use_original {clean:true}`.

### 6.11 Place and mix
1. **Initialise the stem** with N samples of silence (`ambience:"clean"`), or with the looped original room tone using 200 ms crossfades (`"keep"`).
2. **Place each utterance** so its first phrase starts at the original first-word start, within −20 / +40 ms. Later phrases are anchored by the time map.
   - Fade in 5 ms and fade out 15 ms.
   - Use a 20 ms equal-power crossfade where a take meets kept original audio.
3. **Loudness per speaker:** gain the takes so the speaker's dub matches that speaker's original integrated loudness. Loudness is measured BS.1770-4 over speech regions, implemented in numpy (K-weighting biquads), so there is no scipy dependency.
4. **Final limiter:** ffmpeg `alimiter` at −1 dBTP.
5. **Assert** the stem length equals N exactly; anything else is a bug and fails the job.

## 7. Editing loop (after the automatic run)

| Action | What happens | Cost |
|---|---|---|
| `segment.update_text` | <ol><li>Normalise the text and predict its duration.</li><li>If it is over tolerance, return `warning:"text_too_long"` with the maximum syllables and still synthesise it.</li><li>Run §6.9–6.11 for this segment.</li><li>Re-render only `[slot.start − 50 ms, slot.end + 50 ms]` of the stem.</li><li>Emit `segment.updated`.</li></ol> | TTS only |
| `segment.regenerate same_text` | New take with a new `seed`. | TTS |
| `segment.regenerate new_rewrite` | Re-run §6.6 for this utterance, then a take. | LLM + TTS |
| `segment.revert` | Restore the previous version's text and take from cache. | Free |
| `segment.use_original` | Original audio for the slot, optionally isolated. | Free, or isolator |

Every version (text plus take) is kept in the job store, so reverting never needs another call to a service.

## 8. Deliverables (`job.export`)

| Format key | File | Notes |
|---|---|---|
| `stem` | `dub_stem.wav` | Mono, 48 kHz, 24-bit PCM, **N samples**. `bext` TimeReference = `timeline.start_sample`. Description and RIFF `ICMT` read "Contains AI-generated voice (redub-engine)". |
| `clips` | `clips/{segment_id}.wav` + `manifest.json` | One clip per segment with its exact `start_sample`, so the editor can place clips individually. |
| `srt`, `vtt` | `captions.srt`, `captions.vtt` | <ul><li>UTF-8 (SRT has an optional BOM). SRT uses `HH:MM:SS,mmm`; VTT uses a `WEBVTT` header, `HH:MM:SS.mmm` and escapes `&` and `<`. Times are rounded from samples to milliseconds.</li><li>Cues follow utterances, split at phrase boundaries. Defaults follow the Netflix English and Bangla style guides: ≤ 2 lines, ≤ 42 characters per line, ≤ 20 characters/s (en) or ≤ 22 (bn), and 0.83–7 s per cue.</li><li>Characters are counted as **extended grapheme clusters** (`regex` `\X`), so ক্ষ counts as one. Text is NFC-normalised, and ZWJ/ZWNJ are kept.</li><li>Times come from the **final placed audio**. For ElevenLabs takes, character alignment refines split points where available.</li></ul> |
| `changes` | `changes.json` | Per segment: original text, final text, edits, status and flags. This is the audit trail. |
| `qc` | `qc_report.json` | Per segment: α, start error, voice, takes, provider, spend. Job level: fit rate, flag counts, total spend. |

## 9. Safety, consent and privacy
- **Consent gate:** cloning requires `consent:{confirmed_by, confirmed_at}` per speaker, and the record is stored in the job. The editor's UI must show the speaker's name and a statement that the user has the right to clone this voice.
- **Clone lifecycle:** clones are created per job and deleted at `job.delete` (or kept on request). The reference audio lives only in the job folder.
- **Disclosure:**
  - Exported audio carries the AI-voice note in its metadata (§8).
  - `changes.json` records every change.
  - C2PA manifests come in a later version.
- **Data flows:**

  | Recipient | What it receives |
  |---|---|
  | ElevenLabs | Audio (transcription, cloning reference, isolation) and text (TTS) |
  | Azure | Audio (transcription) and text (TTS), only when that key is configured |
  | Anthropic | Text only |

  The editor shows this list in its settings screen.
- **Secrets:**
  - Keys are passed in only via `engine.configure` and held in memory.
  - They are never logged; log lines are redacted against all configured keys.
  - They are never placed in argv or the environment. ffmpeg is spawned with a scrubbed environment and an argument list, never a shell.
  - The editor stores the keys with Electron `safeStorage` (async API) or, in Tauri, the `keyring` crate.

## 10. Cost model (list prices, 2026-10; the price table is configurable)

Per minute of English or Bangla speech (about 900 characters of final text):

| Item | Low | High |
|---|---|---|
| Transcription (Scribe v2 $0.22/h, or MAI-Transcribe-2 $0.10–0.54/h) | $0.002 | $0.009 |
| Rewrite (Opus 5.5 at $4/$20 per MTok) + meaning check (Haiku 5.5) | $0.05 | $0.30 |
| TTS (ElevenLabs $0.08 per 1K chars × 1–3 takes; Azure $15 per 1M chars) | $0.07 | $0.22 |
| **Total** | **≈ $0.12** | **≈ $0.53** |
| Optional Voice Isolator on kept segments | +$0.12 per isolated minute | |

`job.analyze` returns this estimate for the actual job. `job.run` pauses at `spend_cap_usd` (§4.5).

## 11. Testing

### 11.1 Unit (no network)
- **Sample math:**
  - slot and borrow rules;
  - frame-rate parsing;
  - output length equals N for random inputs (property-based).
- **Bangla:**
  - syllable counter against a hand-labelled list of 500 words;
  - normaliser: ZWJ, khanda ta, nukta, numbers, ৳, %, dates and times, compared against oracle tests.
- **English:** syllable counter against held-out CMUdict entries.
- **Duration model:** fit and refit.
- **Stretch bands:** α decisions, and Signalsmith `timeFactor` semantics.
- **Selection gates:** protected tokens, negation count, sadhu patterns.

### 11.2 Connector tests (recorded)
Each connector has JSON fixtures recorded from real responses, including errors (401, 403, 429, 5xx, quota). The suite replays them with an `httpx` mock transport and runs in CI with no keys and no network.

### 11.3 Pipeline tests
- **End-to-end CLI run** (`redub run in.wav --lang en`) against a fake connector set that returns deterministic transcripts and synthetic speech-like audio. It asserts:
  - sample-exact output;
  - start errors within tolerance;
  - a consistent flags list;
  - working revert and regenerate.
- **Protocol tests:** drive the engine over real stdin/stdout. Cover framing, unknown methods, invalid params, cancellation mid-job, and exit on EOF.
- **Live smoke tests:** run only when keys are present in the environment, on three 30-second clips: English, Bangla and Banglish.

### 11.4 Bake-off and quality evaluation (M2 gate)
- **Data:** 2–3 hours of the product owner's own clips: Bangladeshi Bangla (formal and colloquial), Banglish, English, noisy, and two-speaker. For 150 utterances, word boundaries are labelled by hand.
- **Tool:** a `redub-eval` CLI (dev-only dependencies) that computes:
  - WER and CER (`jiwer`);
  - word-boundary error against the labels;
  - fit rate and the α distribution;
  - sentence start error;
  - CER of the dub when re-transcribed.

  It also exports a blind rating sheet (CSV + audio pairs) for native raters, covering meaning, naturalness and "sounds like the speaker".
- **Decisions it drives:**
  1. Default Bangla ASR: Scribe v2 vs MAI-Transcribe-2.
  2. Default Bangla voice path: ElevenLabs v4 clone vs Azure bn-BD stock, or a decision to add a Sarvam or Gemini connector later.
  3. Opus 5.5 effort level.
  4. Tolerance and stretch-band defaults.

## 12. Milestones

| ID | Deliverable | Exit check |
|---|---|---|
| M0 | Foundations: `rpc` loop, job store, `audio` (ffmpeg I/O, resample, fades, loudness, limiter), `timing` math, VAD, CLI skeleton, fake connectors | Protocol and unit tests pass; the fake end-to-end run is sample-exact |
| M1 | English end-to-end: Scribe v2, Claude rewrite + selection + meaning check, ElevenLabs v4 (clone + stock), fit, place, mix, all exports | Live English smoke test passes; ≥ 85% of English sentences fit without flags on a 10-minute test video |
| M2 | Bangla: `lang/bn` (normaliser, syllable counter, rules, spelling table), Azure MAI and Azure neural connectors with self-tests, the `redub-eval` tool, the bake-off | Bake-off report produced; Bangla defaults chosen; Bangla targets in §2 met or a documented decision to add a connector |
| M3 | Editing loop and cost: `segment.*` methods, region re-render, versions, `job.analyze` estimate, spend cap | Editing-loop tests pass; regenerating one sentence takes under 10 s end-to-end on a Creator-tier key |
| M4 | Packaging: PyInstaller onedir builds (Windows x64, macOS arm64/x64), LGPL ffmpeg, signing and notarization, `THIRD_PARTY_LICENSES.md`, Electron and Tauri integration examples | Signed builds launch from the sample Electron and Tauri apps and pass the protocol test suite |

**Later (not v1):** lip-sync, Sarvam and Gemini TTS connectors, more languages, local or offline models, C2PA, separating music from mixed dialogue, and a per-speaker stem export.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Bangla transcription errors on colloquial or Banglish speech become wrong "corrections" | Low-confidence words are marked `[?]` and protected from rewording; flags appear in the editor; bake-off vendor choice; glossary keyterms. |
| Bangla cloned voices sound off (Bengali-reference clones on ElevenLabs are unverified) | Bake-off in M2; stock voices with rate control as an alternative; connector design allows adding Sarvam or Gemini. |
| No speed control on ElevenLabs v4 hurts sync | Rewrite-to-budget with code-measured syllables; up to 3 takes; bounded stretch; exact-timing Azure fallback; original kept with a flag as the last resort. |
| Vendor churn | MAI price promo ends 2026-12-31 and the model is in preview; ElevenLabs models change. Capability-flagged connectors, a configurable price table, startup self-tests and probes. |
| Meaning drift, or changed names, numbers or negations | Hard gates plus a meaning check, step-down levels, a deterministic light fallback, and a full `changes.json` audit. |
| Licence contamination | The exclusion list in §3.2, a licence register, and a CI check that fails on new dependencies with GPL, AGPL or NC licences. |
| Consent and deepfake misuse | Consent gate, per-job clone deletion, metadata disclosure. |
