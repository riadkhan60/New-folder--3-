> **Note:** This briefing came from a multi-agent research sweep on 2026-10-25. It was written *before* the product decisions in [the design spec](../specs/2026-10-25-voice-redub-engine-design.md). Some of its recommendations were overridden by those decisions: a hybrid with local alignment, mandatory review, splice-first rendering and third-party editor plugins. **Where the two disagree, the spec wins.** Keep this file as background evidence and as a source list.

# Same-Language Voice Beautifier and Re-Dubber: Architecture Briefing (English + Bangla)

Prepared 2026-10-25 for planning; nothing has been built yet.

**How to read this briefing**
- **Linked statements** come from the research findings. The ASR, TTS and editor findings went through a separate fact-check, and the corrections are applied here (see the Appendix). The rewrite, audio and market findings did not get a separate fact-check pass, so their numbers are marked **[reported]**.
- **(inference)** marks my own design judgment or estimate.
- **[uncertain]** marks a claim the fact-check could not confirm.
- Claude model prices and API constraints were re-checked against Anthropic's model table (cached 2026-10-06, [pricing](https://platform.claude.com/docs/en/about-claude/pricing)).

**Bottom line**
1. **English can be built to a high standard today.** For Bangla, a reviewed, assisted product works well on clean one- or two-speaker content (vlogs, tutorials, interviews). It is still weak on drama ("natok"), strong dialects, music-heavy audio and overlapping speech.
2. **Recommended MVP: a hybrid.** A local engine owns audio, timing and the round-trip with the video editor. Cloud APIs supply the transcript, the rewrite and the cloned voice, each behind an adapter so it can be swapped for a local model later.
3. **Sync comes from fitting the text to the time slot before synthesis, not from stretching audio afterwards.** The method is:
   - rewrite with a duration budget;
   - generate several candidates and pick one;
   - apply only a small, bounded time-stretch;
   - when the only edits are deletions (fillers, false starts), reuse the original audio instead of re-synthesising.
4. **Three Bangla unknowns decide vendor choice and need a 2-week bake-off first:** accuracy of transcription on conversational Bangladeshi speech, quality of cloned voices with a Bangladeshi accent, and accuracy of Bangla word timing.
5. **Ship in this order:** a no-plugin export bundle first (works in every editor), then an Adobe Premiere Pro panel, then a DaVinci Resolve Studio plugin.

---

## 1. Feasibility verdict

### English: yes, to a high standard
- **Transcription** with word-level timestamps is close to solved:
  - Cloud models report FLEURS WER of 2.6–3.2% ([MAI-Transcribe-2 model card](https://microsoft.ai/pdf/MAI-Transcribe-2-Model-Card.pdf)).
  - Local stacks are mature ([WhisperX](https://github.com/m-bain/whisperX), [Parakeet-TDT-0.6B-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)).
- **Cloned-voice TTS** is offered by many vendors.
- **The hard parts are the same in every language:** fitting new wording into the original time slots, and visible lip mismatch on camera.
- **English alone is not a differentiator.** Descript already ships this workflow for English. Its "Reword for flow" plus Regenerate is limited to English audio and 250 characters per action ([Descript help](https://help.descript.com/hc/en-us/articles/13832955606413)).

### Bangla: yes as an assisted, reviewed product; not yet as unattended one-click output

| Stage | English | Bangla | Where Bangla is weaker |
|---|---|---|---|
| Transcription (text) | Mature | Usable with review | Vendor Bengali numbers (MAI 4.8%, Gemini 3.5 5.0%, Scribe v2 6.9%) are all measured on FLEURS. Its only Bengali config is `bn_in`, which is read speech ([FLEURS README](https://huggingface.co/datasets/google/fleurs/raw/main/README.md)). On Bangladeshi drama audio the best open models score 27–38% WER ([Bengali-Loop](https://arxiv.org/html/2602.14291v1), [WhisperAlign](https://arxiv.org/html/2603.04809v1)). No vendor publishes Bangladeshi conversational or Banglish results. |
| Word timestamps | Mature | Must be built in-house | WhisperX has no Bengali aligner and raises an error ([alignment.py](https://raw.githubusercontent.com/m-bain/whisperX/main/whisperx/alignment.py)). ElevenLabs' Forced Alignment API excludes Bengali ([docs](https://elevenlabs.io/docs/capabilities/forced-alignment)). The most robust multilingual aligner (MMS) is CC-BY-NC ([MMS_FA](https://docs.pytorch.org/audio/2.8/generated/torchaudio.pipelines.MMS_FA.html)). Latin-script English words and digits fall outside Bengali-script model vocabularies. |
| Speaker separation (diarization) | Good | Weak on drama | Pretrained pyannote scores about 40% DER on Bengali drama, about 27% after fine-tuning ([Bengali-Loop](https://arxiv.org/html/2602.14291v1), [DL Sprint](https://arxiv.org/html/2602.21741v1)). |
| Grammar/wording rewrite | Strong | Good but unproven | No study measures Bangla same-language grammar polishing. On WMT25's preliminary EN→BN ranking, Gemini-2.5-Pro scored above GPT-4.1 and Claude-4 [reported] ([arXiv 2508.14909](https://arxiv.org/abs/2508.14909)). Register (colloquial cholito vs literary sadhu), Bangladesh vs West Bengal spelling and vocabulary, and Banglish need explicit rules. |
| Cloned TTS | Strong | Available, unproven | No independent benchmark of Bengali voice clones exists. The only Bengali MOS found comes from a vendor-adjacent router: 12 raters, no clones tested ([caller.digital](https://caller.digital/blog/indic-tts-benchmark-bulbul-elevenlabs-sarvam-google-ai4bharat-2026)). ElevenLabs' clone docs promise clones only in Flash v2.5 / Multilingual v2 languages, which exclude Bengali [uncertain] ([IVC](https://elevenlabs.io/docs/product-guides/voices/voice-cloning/instant-voice-cloning)). Every clone product found is bn-IN; none is bn-BD. |
| Control of output duration | Several engines offer it | Scarce | ElevenLabs v3/v4 have no speed control ([playground docs](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech)). Sarvam clones have no pace parameter. The only open Bengali model with exact duration control (OmniVoice) has non-commercial weights ([HF](https://huggingface.co/k2-fsa/OmniVoice)). |
| Separation, enhancement, mixing | Language-agnostic | Same | No Bangla benchmark exists. This is unlikely to matter (inference). |
| Editor built-in AI | Partial | None | Premiere Speech to Text has no Bengali ([Adobe](https://www.adobe.com/products/premiere/speech-to-text.html)). FCP Generate Captions is US English only ([Apple](https://support.apple.com/en-us/102825)). This is a gap and also the opportunity. |
| Competitors | Descript, Vozo | None found doing same-language re-voice in Bangla | Vozo Voice Studio lists 29+ languages without Bengali [reported] ([Vozo](https://www.vozo.ai/voice-studio)). |

**Bangla weak points, ranked by impact (inference):**
1. Transcription of conversational, dialect and Banglish speech.
2. Cloned-voice quality with a Bangladeshi accent, and the missing duration control.
3. Bangla word timing.
4. Speaker separation on multi-speaker content.
5. Rewrite register and locale. This is manageable with rules and checks.

**Expected quality by content type (inference):**
- **Good:** a single speaker with a clean lavalier mic (vlog, tutorial, talking head).
- **OK with review:** a two-person interview.
- **Poor:** drama/natok, music beds under dialogue, heavy regional dialect, overlapping speech, 3 or more speakers.

---

## 2. Stage-by-stage picks

| Stage | Cloud-first pick | Fully-local pick | Fallback | Licence / commercial note |
|---|---|---|---|---|
| Speech detection and pause map | Run locally even in cloud mode: Silero VAD. It is cheap and gives the pause structure the dub must reproduce. | Silero VAD | pyannote segmentation | Silero is MIT ([LICENSE](https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE)) |
| Transcription, English | MAI-Transcribe-2 via Azure Fast Transcription (`transcribeStyle=verbatim`, `timestamps=word`, diarization on). FLEURS en 2.7%; words, timings and speakers in one call ([Learn](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)). | WhisperX (faster-whisper large-v3 + wav2vec2 aligner + pyannote). Mature and robust to accents. | ElevenLabs Scribe v2: $0.22/h, 32 speakers, laughter/applause tags ([pricing](https://elevenlabs.io/pricing/api)). Local: Parakeet-TDT-0.6B-v3 with native word times. | MAI is proprietary. Its $0.10/h is a promo ending at the end of 2026, with no list price or GA status published, so budget at $0.22–0.30/h. WhisperX is BSD-2; Parakeet is CC-BY-4.0. Do not use OpenAI gpt-transcribe: it returns no word timestamps, and whisper-1 and the 4o family shut down on 26 Feb 2027 ([OpenAI](https://developers.openai.com/docs/guides/speech-to-text)). |
| Transcription, Bangla | MAI-Transcribe-2 with `locales` left unset for Banglish. Best reported score: FLEURS bn 4.8% (vendor chart). | bengaliAI tugstugi Whisper-medium in faster-whisper. Best documented model on Bangladeshi long-form audio: 34.07% WER on Bengali-Loop ([HF](https://huggingface.co/bengaliAI/tugstugi_bengaliai-asr_whisper-medium)). | Gemini 3.5 Transcribe with `bn-BD`, VERBATIM mode, about $0.005/min ([docs](https://ai.google.dev/gemini-api/docs/generate-content/transcribe), [pricing](https://ai.google.dev/gemini-api/docs/pricing)). Request text without timestamps, since Google warns timestamps degrade accuracy. Also Scribe v2, and Deepgram Nova-3 multilingual (Bengali is in its code-switch set, [Deepgram](https://developers.deepgram.com/docs/models-languages-overview)) as bake-off entrants. | tugstugi is Apache-2.0 with an empty model card. Avoid vanilla Whisper (46.4% FLEURS bn), AssemblyAI (">50% WER" tier) and Sarvam as a timing source (timestamps are chunk-level only). |
| Word alignment (the source of timing truth) | Run our own forced alignment locally, as in the local column. Cloud word times are used only as a cross-check: flag any word where the difference exceeds 150 ms. | English: wav2vec2 960H. Bangla: Tahsin-Mayeesha/wav2vec2-bn-300m or ai4bharat indicwav2vec_v1_bengali, run per speech region through torchaudio ≥2.10 `forced_align` or ctc-forced-aligner. | Cloud word times, then character-proportional interpolation inside the speech region, flagged for review. | wav2vec2-bn-300m is Apache-2.0; indicwav2vec is MIT (gated). The MMS aligners are CC-BY-NC: use them only as a reference to benchmark against. ctc-forced-aligner code is BSD-2, but its default model is non-commercial, so pass our own. torchaudio `forced_align` was kept in 2.10 ([release notes](https://github.com/pytorch/audio/releases/tag/v2.10.0)). |
| Speaker separation (diarization) | Use what MAI or Scribe return. Switch to pyannoteAI Precision-3 (€0.112/h) if that is weak ([pricing](https://www.pyannote.ai/pricing)). | pyannote speaker-diarization-community-1 with `exclusive_speaker_diarization` | Separate per-microphone tracks from the editor, plus a speaker-correction UI | community-1 is CC-BY-4.0, gated, and requires attribution ([HF](https://huggingface.co/pyannote/speaker-diarization-community-1)) |
| Bangla text normalisation | Local in both modes | Unicode NFC, then bnunicodenormalizer (`allow_english=True`, guard against `None`), then bangla-text-normalizer to spell out numbers and dates. Keep separate display text and TTS text. | Hand-written rule tables | Both libraries are MIT ([1](https://pypi.org/project/bnunicodenormalizer/), [2](https://pypi.org/project/bangla-text-normalizer/)). Avoid the csebuetnlp normalizer, which is non-commercial. |
| Rewrite LLM | Claude Opus 5.5 with structured outputs, returning 3 length-targeted candidates per call. Code, not the model, measures length and selects. The Bangla vendor is decided by a blind A/B against current Gemini Pro and GPT-5.x. | Qwen3/Gemma/Llama-class model on vLLM with JSON-constrained decoding. For Bangla, limit it to light/clean edits until it passes native-rater testing. | Downgrade the edit level (polish, then clean, then light), then keep the original audio | Opus 5.5 costs $4/$20 per MTok, cache reads $0.20, Batch API 50% off. Its default effort is `medium`. `temperature`/`top_p` return a 400 on API version 2026-10-21, and forced `tool_choice` returns a 400, so candidate diversity has to come from explicit length targets in the prompt. Prompt-only length control is weak: Claude-4.1-Opus stayed within the syllable budget only 27–46% of the time in HOMURA [reported] ([arXiv](https://arxiv.org/html/2601.10187)). |
| Meaning check (judge) | A code check that protected tokens (names, numbers, negations) survive, plus LaBSE similarity, plus a rubric judge on Claude Haiku 5.5 ($0.10/$0.50) or Sonnet 5.5 ($2/$10) | Same checks with a local judge model, plus a BanglaBERT paraphrase classifier | Human review queue | Similarity thresholds must be calibrated on about 300 labelled pairs per language (inference) |
| Cloned TTS, English | ElevenLabs Eleven v4 instant clone, built from 1–2 min of the speaker's clean audio, $0.08 per 1K characters ([models](https://elevenlabs.io/docs/overview/models)) | Chatterbox Multilingual V3 (MIT, PerTh watermark) or Qwen3-TTS (Apache-2.0) | Azure Personal Voice (gated) or Gemini 3.8 Flash TTS voice replication | v4 has no speed, style or SSML control, so timing must come from text length, candidate selection and stretching |
| Cloned TTS, Bangla | Bake-off between ElevenLabs v4 instant clone and Sarvam Instant Voice Cloning. Sarvam: bn-IN listed, clones work across languages, Roman-script code-mix accepted, ₹2 per 1K characters, beta ([Sarvam](https://docs.sarvam.ai/api/api-guides-tutorials/voice-cloning/supported-languages.md)). Compliance-oriented alternates: Azure Personal Voice bn-IN ([Learn](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-how-to-use)) and Gemini 3.8 voice replication. | IndicF5 for Bengali (F5's `fix_duration` and word-level `speech_edit`), pending licence review ([HF](https://huggingface.co/ai4bharat/IndicF5)). Svara-TTS voiceclone-beta (Apache-2.0) as alternate. | Exact-timing path: a prebuilt voice with duration control (Azure bn-BD with `mstts:audioduration` [untested on bn-BD]; Sarvam preset pace 0.5–2.0; Chirp 3 HD bn-IN `speaking_rate`), then voice conversion to the speaker's timbre | ElevenLabs Bengali-reference clones [uncertain]. No clone product is listed for the bn-BD locale. Sarvam is reported to capture Bangladesh rhythm less well than Kolkata rhythm [reported]. OmniVoice is the best technical fit (`duration` argument, FLEURS bn CER 3.08%) but its weights are CC-BY-NC. Higgs v3 and Fish S2 Pro are non-commercial or research licences. |
| Voice conversion | None usable for Bengali: ElevenLabs Voice Changer does not list it ([docs](https://elevenlabs.io/docs/capabilities/voice-changer)) | RVC trained per speaker (needs at least 10 min of audio), or OpenVoice V2 zero-shot | kNN-VC; Seed-VC server-side only | RVC, OpenVoice and kNN-VC code is MIT (check RVC's pretrained base checkpoints separately). Seed-VC is GPL-3.0. |
| Dialogue/music/effects separation | Skip it when the editor exports a dialogue-only stem. Otherwise use MVSep DnR v3 ensemble (speech SDR 12.81 dB on MVSep's own leaderboard) [reported] or AudioShake. | Bandit v2 checkpoint-multi (separates dialogue, music and effects) ([repo](https://github.com/kwatcharasupat/bandit-v2)) | audio-separator with BS-RoFormer plus a debleed model | Bandit code is Apache-2.0; its weights are CC BY-SA 4.0. Licences of UVR community weights are unstated. The Demucs repo is archived (use the adefossez fork), and its weight licence is disputed. |
| Enhancement | ElevenLabs Voice Isolator ($0.12/min), used only to clean clone reference audio | DeepFilterNet3 with `atten_lim_db` 12–18 dB. ClearerVoice SR-48k to upsample low-rate TTS output. | Use the raw reference if cleaning lowers speaker similarity | Denoising a reference can lower clone similarity [reported] ([arXiv](https://arxiv.org/pdf/2607.23938)). DeepFilterNet is MIT/Apache (releases are stale); ClearerVoice is Apache-2.0. |
| Timing fit | Control duration at synthesis where the engine allows it; otherwise generate candidates and apply a bounded stretch (Section 4) | Same | ffmpeg atempo | Rubber Band R3 is GPL or a paid licence. Signalsmith Stretch (MIT) is the stretcher for closed-source builds. |
| Mixing and scene match | Local in both modes | pyloudnorm, ffmpeg loudnorm two-pass in linear mode, our own long-term-spectrum EQ, blind RT60 estimate with a pyroomacoustics room response, room-tone fill | "Studio clean" mode | pyloudnorm is MIT. Avoid matchering and pedalboard (GPLv3) inside a closed plugin. Re-adding room and background raised naturalness in Amazon's dubbing study [reported] ([arXiv](https://arxiv.org/pdf/2001.06785)). |
| Editor integration | Export bundle, then Premiere UXP panel, then Resolve Studio plugin | Same | Bundle only | OpenTimelineIO 0.18.1 is Apache-2.0 ([PyPI](https://pypi.org/project/OpenTimelineIO/)) |
| Lip-sync (Phase 2, optional) | sync.so lipsync-2 at $0.04–0.05 per second ([docs](https://sync.so/docs/models/lipsync)) | LatentSync 1.6 with InsightFace replaced, or MuseTalk 1.5 (MIT) for previews | Restrict close-ups to minimal edits | Wav2Lip is non-commercial. LatentSync's licence is inconsistent (Apache repo, openrail++ model card). InsightFace models are non-commercial. |

---

## 3. Architecture approaches

**A. Cloud SaaS orchestrator.** A thin client uploads the dialogue to our server, which calls vendor APIs for every stage (transcription with vendor timestamps, cloud separation, LLM, cloned TTS) and returns the bundle.

**B. Fully local open-source engine on GPU.** Everything runs on the user's machine: faster-whisper with Bengali fine-tunes, CTC alignment, pyannote, a local LLM, IndicF5/Chatterbox TTS, RVC, Bandit, and the DSP stages.

**C. Hybrid: local engine with pluggable cloud intelligence (recommended).**
- A desktop or tray engine (Python, plus a 127.0.0.1 service) owns audio input/output, speech detection, separation, forced alignment, the sync algorithm, mixing and the editor round-trip.
- Only three things go to the cloud: speech snippets for transcription, text for the rewrite, and text plus reference audio for cloned TTS.
- Every stage sits behind an adapter that declares its capabilities (word timestamps, diarization, exact duration, rate, cloning, languages, max length), so each stage can later be swapped for a local model.

| | A. Cloud orchestrator | B. Fully local | C. Hybrid (recommended) |
|---|---|---|---|
| Quality, English | High | Medium-high | High |
| Quality, Bangla | Best available, but timing depends on vendor word times nobody has validated for Bangla | Clearly lower. Transcription is in the 27–38% WER class on drama; Bangla rewrite limited to light/clean; commercially safe cloners are unverified or don't clone | Best available, and we own the timing (local Bengali alignment, cross-checked against the vendor) |
| Cost per video-minute (rough, inference) | About $0.2–0.8. Transcription and diarization: $0.002–0.006. LLM: $0.10–0.45 (about 6 Opus 5.5 calls per minute, output-dominated; about half that with Batch or Sonnet 5.5). TTS: $0.08–0.30 (about 0.9–1K characters per minute × 1–3.5 for candidates and re-synthesis at $0.08/1K) or about $0.03–0.09 with Sarvam. Cloud separation is extra. | About $0.01–0.05 of GPU time on a rented 24 GB card (1–3 min of processing per video-minute at about $0.5–1/h, both assumptions); close to zero on the user's own GPU | Same as A, minus cloud separation |
| Optional lip-sync | +$2.40–8.00/min (sync.so) | Local LatentSync needs an 18 GB GPU | Same as A |
| Privacy | The whole dialogue track leaves the machine | Nothing leaves | Speech snippets, text and voice references leave. These are still biometric and personal data, so consent is needed. |
| Licensing exposure | Mostly vendor terms: consent clauses, Azure intake form, Google allowlist | High: non-commercial weights (OmniVoice, MMS, F5 base), GPL (Rubber Band, Seed-VC), CC BY-SA (Bandit), unclear (IndicF5, Demucs) | Moderate. Needs GPL-free DSP for a closed plugin, attribution for pyannote and Bandit, and legal review of a few weights. |
| Engineering effort (rough, inference) | Medium. The same sync engine is needed, plus server infrastructure, upload, accounts and billing. | High. Model packaging per OS and GPU, fine-tuning, much more quality work for Bangla. | Medium. Engine plus bundle is about 3–4 engineer-months; the Premiere panel adds about 1–2. |
| Fit with editor plugins | Plugins still need a local helper | Native | Native: Premiere's UXP panel needs a pre-running local service anyway |

**Recommendation for the MVP: C.**
- **Bangla quality:** it gives the best Bangla quality available today.
- **Timing control:** it keeps timing under our control. Cloud word timestamps for Bangla are unproven, and Google documents that its timestamps degrade accuracy.
- **Editor fit:** a local process is required for editor round-trips regardless.
- **Upgrade path:** privacy-sensitive customers can later move individual stages local without a rewrite.
- **Hosted variant:** A can be added later as a server-hosted version of the same engine.
- **B is a later tier:** use it for a privacy SKU, once local Bangla models are licensed and validated.

**MVP scope (inference):**
- **In scope:**
  - English and Bangla (bn-BD and bn-IN, with Banglish preserved), 1–2 speakers, talking-head, vlog, tutorial and interview content.
  - Strictness: "light" and "clean" by default; "polish" opt-in and off-screen only.
  - Rendering: splice-first (deletion-only edits reuse the original audio).
  - Review: a mandatory transcript diff review before any TTS.
  - Delivery: the bundle export.
- **Out of scope:** lip-sync, drama with 3 or more speakers, music-heavy mixes, live or real-time use.

**Decision gate before vendor lock-in:** a 2-week bake-off on 2–3 hours of labelled clips. Cover formal and colloquial Bangladeshi Bangla, West Bengal Bangla, Banglish, noisy clips and multi-speaker clips, and use native raters from both Bangladesh and West Bengal. Measure:

- **Transcription:** WER and CER (normalised and orthographic).
- **Timing:** word-boundary error against 100–200 hand-aligned utterances.
- **Speaker separation:** DER.
- **Voices:**
  - blind MOS and "sounds like the speaker" for cloned voices, including clones built only from Bengali reference audio;
  - speaker similarity (ECAPA);
  - CER when the TTS output is transcribed back.
- **Fit:** share of segments that fit with a stretch inside the silent band.
- **Rewrite:** meaning, fluency and register scores in an A/B across LLM vendors.

Proposed pass targets, which the product owner should confirm (inference):
- median word-boundary error ≤100 ms;
- at least 85% of segments fit without leaving the silent stretch band;
- meaning preserved (score ≥4.5/5) on at least 95% of segments.

---

## 4. Sync algorithm

### 4.1 Principles
- **Use one exact clock.** Keep all time as integer samples at 48 kHz, with a rational frame rate and a drop-frame flag. Convert to timecode or ticks only at export.
- **Separate what was said from when it was said.** Take text from the best transcription model in verbatim mode, so fillers and false starts stay in. Take timing from local CTC forced alignment, cross-checked against cloud word times.
- **Budget duration before writing.** Character-length parity is a weak proxy for timing (r=0.279 with time overlap in human dubs [reported], [Brannon et al. TACL 2023](https://arxiv.org/abs/2212.12137)). Budget in predicted syllables or phonemes, calibrated per speaker and per TTS voice.
- **Keep the speaker's natural speaking rate.** Human dubbers miss timing rather than change rate [reported]. Absorb slack as silence, and treat stretching as a last, bounded step.
- **Reuse the original audio whenever possible.** Edits that only delete words never need TTS.

### 4.2 Steps
1. **Ingest.**
   - Take the dialogue stem from the editor at 48 kHz/24-bit; prefer per-speaker or per-mic tracks when available.
   - Make a 16 kHz mono copy for transcription, speech detection and alignment.
   - Record the source timecode, frame rate and drop-frame flag.
2. **Pause map.**
   - Run Silero VAD with threshold 0.5, min speech 150 ms, min silence 200 ms, pad 50 ms.
   - Merge gaps under 200 ms. Split regions over about 28 s at the lowest-energy point. Never cut at fixed windows: fixed 30 s cuts caused 2.3 word-boundary errors per cut, against 0.4 for silence-aware cuts ([DL Sprint](https://arxiv.org/html/2602.21741v1)).
   - Store every non-speech interval with its type (pause, music, laugh, breath).
3. **Words.** Transcribe verbatim, normalise the text (Bangla: NFC, nukta letters, spelled-out digits, transliterated or romanised Latin tokens), then force-align per speech region with 100–200 ms padding. Quality checks:
   - word starts must be monotonic;
   - minimum word length 40 ms;
   - snap boundaries to the nearest energy minimum within ±30 ms;
   - flag words that are unaligned, have a low alignment score, or differ from cloud times by more than 150 ms.

   Fall back in order: cloud times, then interpolation.
4. **Segmentation.**
   - A **phrase** (breath group) runs between pauses of at least 300 ms. This is the timing unit; the 300 ms definition comes from Amazon's dubbing work [reported] ([Tam et al.](https://arxiv.org/abs/2112.08548)).
   - An **utterance** ends at a speaker change or a sentence end (`।` `.` `?` `!`) and lasts at most 12–15 s or about 20 words.
   - The **LLM chunk** is 2–4 sentences, sent with the previous 2 rewritten phrases and the next 2 raw phrases as read-only context. About 4 sentences per chunk was most stable in the DRES disfluency benchmark [reported].
5. **Slots and budgets.**
   - **Slot** = [first word start − 50 ms, min(next segment start − 80 ms, last word end + borrowable gap)].
   - **Borrowable gap** = min(0.5 × gap, gap − 150 ms). It is zero at a shot cut or when the next speaker starts.
   - **Speaker rate** r_spk = syllables of fluent words ÷ their duration, excluding pauses and fillers.
   - **Voice rate** r_voice comes from about 50 calibration sentences per language with the actual cloned voice, refitted after every synthesis (inference).
   - **Per-phrase target:**
     - In light mode, the target is the summed duration of the kept words; deleted words become silence in place.
     - In clean and polish modes, the target is slot speech time minus filler and false-start time, clamped to [0.6 × slot, slot + borrowable gap].
   - **Units for the LLM:** target_units = target_sec × r_voice. Also give a word-count target, since LLMs follow word counts better (inference).
6. **Rewrite-to-fit loop.** This follows the Duration-based Translation loop [reported] ([Won et al., EMNLP 2025 demo](https://aclanthology.org/2025.emnlp-demos.37)).
   - The LLM returns 3 candidates (tight = target − 8%, target, loose = target + 8%), with mapping to source phrases and an edit list.
   - Code counts syllables:
     - English: CMUdict with a vowel-group fallback.
     - Bangla: espeak-ng `bn` or a rule-based count of vowel nuclei with heuristics for the silent inherent vowel; the accuracy of either is unverified.
   - Hard gates: placeholders intact, phrase mapping valid, same language and script, colloquial (cholito) register, locale lexicon respected, no new numbers or entities.
   - Pick the candidate inside tolerance with the highest meaning score. Tolerance is ±10% on-screen and ±20% off-screen (inference).
   - If none fits, give numeric feedback ("p2 is 23 syllables, need 16–20") for up to 3 rounds, keeping only candidates that move closer.
   - The winner must pass the meaning check. If it fails, retry once, then drop to a lighter edit level.
7. **Render decision for each utterance.**
   - **Deletions only:** cut the original audio at word boundaries with 10–30 ms crossfades. On camera, leave removed time as room tone in place, because the mouth is moving. Off camera, the gap may be closed.
   - **Replacements or insertions:** regenerate the minimal span plus 1–2 context words on each side and splice it in. If the splice sounds discontinuous, regenerate the whole utterance.
   - **On-camera with large changes:** cap at light/clean, or flag for Phase-2 lip-sync.
8. **Duration control during TTS, by engine capability.**

| Engine capability | Engines (verified) | Strategy |
|---|---|---|
| Exact duration | OmniVoice `duration` (non-commercial); F5/IndicF5 `fix_duration` (IndicF5 exposure unverified); Azure prebuilt voices `mstts:audioduration` 0.5×–2× (not available on Personal Voice; untested on bn-BD) | Request the slot length directly |
| Rate only | Sarvam preset voices: pace 0.5–2.0. Chirp 3 HD: `speaking_rate` 0.25–2.0. Azure Personal Voice: prosody `rate`. Cartesia: 0.6–1.5, treated as guidance only. Gemini 3.8: coarse "speaking rapidly/slowly" ([docs](https://ai.google.dev/gemini-api/docs/speech-generation)). | Derive the rate from the first take's duration, then regenerate once |
| No control | ElevenLabs v3/v4; Sarvam clones | Generate 3 candidates and trim silence. Score = 0.4 × duration fit + 0.3 × (1 − CER when transcribed back) + 0.3 × speaker similarity. |

9. **Fit the chosen take.**
   - Force-align the TTS output.
   - Redistribute pauses: map TTS phrase breaks onto original pauses ≥150 ms, compress internal TTS pauses down to 80 ms (120 ms at sentence ends), or stretch them toward the original lengths.
   - Compute α = target length ÷ current length.
   - Stretch with a time map anchored at phrase onsets (Rubber Band `-M`, or our own slicing with Signalsmith), so each phrase starts where the original phrase started.
10. **Place and stitch.**
    - Anchor the start at the original onset, allowing −20 to +40 ms.
    - Allow overflow into silence up to the hard limit. Allow +300 ms more when the speaker is off-screen, the relaxation used in Virkar 2022 [reported].
    - Fade in over 5 ms and out over 15 ms. Use 20 ms equal-power crossfades against kept original audio. Fill gaps with room tone.
    - Match level, EQ and reverb (BS.1770 short-term loudness; spectrum-difference EQ at 70% strength; re-reverb from the RT60 estimate when it is ≥0.25 s).
11. **Emit and check.**
    - Emit a full-length stem with exactly the same sample count as the input.
    - Emit per-utterance clips padded so content lands sample-exact while each clip starts on a frame boundary.
    - Emit subtitles timed from the forced alignment of the final audio.
    - Add a marker for every changed or flagged line.

### 4.3 Thresholds (defaults to calibrate with a listening test in English and Bangla)

| Parameter | Default | Basis |
|---|---|---|
| Pause that forms a phrase boundary | ≥300 ms | Amazon isochrony work [reported] |
| Utterance maximum | 12–15 s, about 20 words | DRES; VideoLingo `max_split_length` 20 [reported] |
| Length tolerance | ±10% on-screen, ±20% off-screen | inference (±10% echoes the IWSLT isometric setting) |
| LLM refinement rounds / TTS re-synthesis rounds | ≤3 / ≤2 | DT loop [reported] / inference |
| Silent stretch band | α in [0.88, 1.08] (compress up to 12%, expand up to 8%) | inference, consistent with ffmpeg atempo's author, Signalsmith's 0.75–1.5× "modest" range, and ElevenLabs' 0.7–1.2 speed clamp [reported]. Slowed speech sounds unnatural sooner, hence the asymmetry. |
| Flagged stretch band | α in [0.80, 0.88) or (1.08, 1.12] | inference |
| Beyond the flagged band | Rewrite again, then the fallback chain | inference |
| Timestamp disagreement flag | Difference >150 ms | inference |
| Pause floor after compression | 80 ms (120 ms at sentence end) | inference |
| Edges | Fade in 5 ms, fade out 15 ms, 20 ms equal-power crossfade | inference |

### 4.4 Sketch

```
prepare:
  vad    = silero(asr16)
  words  = forced_align(verbatim_text, vad_regions)   # start, end, score, source
  utts   = segment(words, speakers, vad)              # speaker turn, pause >= 300 ms, <= 15 s
  r_spk  = per-speaker fluent syllable rate;  r_voice = calibrated, refit online

for u in utts (time order):
  slot   = [u.start - 50ms, min(next.start - 80ms, u.end + borrow(gap, cut, next_speaker))]
  budget = per-phrase target_sec(mode) -> units = target_sec * r_voice
  edit   = rewrite_fit(u, budget)          # 3 candidates, code selects, <= 3 rounds, meaning gate, downgrade on fail
  if edit.only_deletions:
      audio = splice_original(u, edit)     # removed time -> room tone in place if on-screen
  else:
      audio = synth(engine, edit.tts_text, by capability: exact / rate / 3 candidates)
      audio = redistribute_pauses(force_align(audio), u.source_pauses)
      a = target_len / len(audio)
      if   0.88 <= a <= 1.08: audio = timemap_stretch(audio, phrase_onsets)
      elif 0.80 <= a <= 1.12: audio = timemap_stretch(...); flag("stretch")
      else: retry rewrite with measured feedback (<= 2 TTS rounds) -> fallback_chain(u)
  place(audio, at=u.onset +[-20, +40] ms); fades; room tone; match level/EQ/reverb
emit: full-length stem (same sample count) + frame-padded clips + subtitles + markers + QC report
```

### 4.5 Fallback chain (in order)
1. Shorter rewrite with a hard syllable cap.
2. Borrow up to 120 ms of lead-in when the mouth is not visible.
3. Shift the next segment if it has slack.
4. Switch to the exact-timing voice path: a prebuilt voice with duration control, then voice conversion to the speaker's timbre.
5. Keep the original audio for the segment (enhanced only) and add a red "OVERFLOW/REVIEW" marker.
6. On camera only: queue for Phase-2 lip-sync.

### 4.6 Quality metrics logged per segment
- Speech overlap SO = 1 − abs(d_src − d_dub) ÷ d_src.
- Absolute error of phrase start times.
- Share of segments within tolerance.
- Distribution of the stretch factor α.
- CER when the dub is transcribed back.
- ECAPA speaker similarity to the original.
- Leftover original speech in the background stem.
- Loudness and true peak.

As a sanity baseline, human dubs average 0.658 overlap fraction [reported].

---

## 5. Editor integration

### 5.1 Recommendation
1. **Phase 0, MVP for every editor: a no-plugin export bundle** (Section 5.2). It works in Premiere, Resolve Free and Studio, Final Cut, Avid, CapCut and Filmora from day one.
2. **Phase 1, first plugin: an Adobe Premiere Pro UXP panel.**
   - UXP has been GA since 25.6, and CEP is being phased out: no new submissions from Dec 2027, disabled by default Dec 2028, removed Dec 2029 ([Adobe](https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications)).
   - Every primitive needed for the round trip is verified:
     - `EncoderManager.exportSequence` (export the range)
     - `getInPoint` / `getOutPoint` / `getZeroPoint` / `getVideoFrameRate` (read the range and timebase)
     - `importFiles` (bring the dub back in)
     - `createOverwriteItemAction` with a `TickTime` (place clips at exact times)
     - `AudioTrack.setMute` (mute the original track)
     - `createSetNameAction` (name the dub track)
     - `createAddMarkerAction` (mark changed lines)
     - `Transcript.importFromJSON` (push the corrected transcript)

     ([changelog](https://developer.adobe.com/premiere-pro/uxp/changelog), [SequenceEditor](https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/sequenceeditor)).
   - Premiere's built-in Speech to Text lacks Bengali, so the value is obvious there.
   - Premiere's 254,016,000,000 ticks per second divide evenly by 48 kHz (5,292,000 ticks per sample).
   - Use 26.3 as the hard floor (the `lockedAccess` requirement) and 26.5 as the preferred version (`WorkAreaUtils`).
3. **Phase 2: DaVinci Resolve Studio Workflow Integration plugin.**
   - Render audio only with MarkIn/MarkOut.
   - Place results with `ImportMedia`, `AddTrack('audio')`, then `AppendToTimeline` with `trackIndex`/`recordFrame`.
   - Use `AddMarker` with `customData` to carry utterance IDs ([API mirror](https://wiki.dvresolve.com/developer-docs/scripting-api)).
   - Workflow Integration plugins were already Studio-only before 21.1, and 21.1 made external and advanced scripting Studio-only too ([readme](https://www.blackmagicdesign.com/support/content/readme/baf7c071c0524fbf8ccc961925c9f443)). Free Resolve users stay on the bundle.
4. **Phase 3:** Final Cut via FCPXML (version 1.14 since FCP 12.0) and Avid via AAF. CapCut and Filmora stay bundle-only; do not build on unofficial draft-file hacks.

**Premiere gotchas to design around (verified in the fact-check):**
- **No plain HTTP on macOS.** Premiere disallows `http://` URLs on macOS ([network recipe](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/network)). Serve the engine over https/wss on 127.0.0.1 with an installer-created trusted certificate, or use a UXP hybrid C++ add-on (official since 26.2). Test early whether localhost is exempt.
- **The panel cannot launch the engine with arguments.** Ship the engine as a tray app, wake it with a `dubfix://` URL scheme via `shell.openExternal`, and remember the user's consent.
- **Export can render the work area instead of In/Out** (bug DVAPR-4265965). Clear the work area with `WorkAreaUtils` (26.5) and verify the rendered sample count. Try `ExportType.IMMEDIATELY` before assuming Adobe Media Encoder is required [uncertain].
- **Track creation is only documented for insert.** Passing an out-of-range track index creates a track for `createInsertProjectItemAction`; for overwrite this is undocumented. Test it, fall back to insert with `limitShift`, and never ripple the user's edit.
- **UXP has no `createCaptionTrack`.** Import the SRT as a project item for the user to drag, or add a small CEP companion that works until 2029.
- **Edits must run inside `project.lockedAccess` plus `executeTransaction`.** Keep edits few and in separate transactions; a crash was reported in 26.3.2 after repeated overwrites.

**Resolve gotchas:**
- `ImportIntoTimeline` applies `insertWithOffset` only when `insertAdditionalTracks=False`, which is not the default. Prefer `AppendToTimeline` as the main return path.
- Scripted OTIO import is unconfirmed, so prefer FCP7 XML or AAF.

### 5.2 No-plugin fallback path (the universal bundle)
**User steps:**
1. Solo the dialogue track(s) and set In/Out.
2. Export a 48 kHz/24-bit WAV of that range.
3. Drop the WAV into the tool.
4. Review and approve the script diff.
5. Import the bundle, place `dub_stem.wav` at the same In point on a new track, and mute the original.

**Bundle contents:**
- **`dub_stem.wav`:** mono, 48 kHz/24-bit BWF, with exactly the same sample count as the input (this is the sync guarantee). The bext TimeReference holds the start sample. Optionally one stem per speaker.
- **`clips/NNNN_spkX.wav`:** one clip per changed utterance, padded so each starts on a frame boundary (`pre_pad = audio_start − record_frame × samples_per_frame`), plus 250 ms room-tone handles.
- **Captions:** `captions_corrected.srt/.vtt` and `captions_original.srt`, in UTF-8. Bangla text appears only here, in markers and in the CSV. Media file names stay ASCII.
- **Timeline files:**
  - `timeline.xml` (FCP7 xmeml) for Premiere and Resolve;
  - `timeline.fcpxml` for Final Cut;
  - `timeline.aaf` for Avid and Resolve;
  - `timeline.otio`;
  - an EDL only as a last resort (single track, 8-character reels, no Bangla).
- **`changes.csv`** (original vs new text, edit type, rationale) plus `qc_report.json`. This is the audit trail.

**Timecode rules (verified math):**
- **29.97 drop-frame:** labels skip frame numbers 0 and 1 each minute except every 10th minute, so `01:00:00;00` DF is frame 107,892.
- **23.976 is never drop-frame:** a timecode hour lasts 3,603.6 s of real time.
- **Default timeline start:** Resolve usually starts at `01:00:00:00`, Premiere at `00:00:00:00`.
- **Captions use wall-clock time.** SRT and VTT are wall-clock milliseconds, so emit both range-relative and timeline-zero variants.
- **Validate with a null test:** a pass-through render inverted against the original should cancel.

---

## 6. Top risks and mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | Bangla transcription errors on conversational, Bangladeshi and Banglish speech turn into wrong "corrections" | High | Mandatory diff review. Never edit words with confidence <0.5 without a flag. Bake-off on our own clips (FLEURS bn is read speech, India-only config). Later, fine-tune the Bengali Whisper on logged corrections. |
| 2 | Cloned Bangla voices sound wrong, especially with a Bangladeshi accent. ElevenLabs Bengali-reference clones [uncertain]; no bn-BD clone product exists. | High | Test 4 vendors in week 1 (ElevenLabs v4, Sarvam IVC, Azure Personal Voice, Gemini 3.8). Route by language and dialect through the engine router. Splice-first rendering reduces how much synthetic speech is used at all. Voice-conversion fallback. |
| 3 | Sync failure: LLMs lengthen text (outputs ran 1.35–1.84× the target length in HOMURA [reported]), and the best Bangla engines lack speed control | High | Code-enforced duration loop with candidates; duration predictor calibrated per voice; bounded stretch; exact-timing voice plus voice-conversion path; overflow markers. |
| 4 | Meaning drift, over-editing, or loss of the speaker's authenticity (e.g. dropped negations such as না/নি/নেই, changed numbers) | High | Protected-token placeholders, LaBSE and judge checks, edit levels (light/clean/polish), automatic downgrade, an accept/reject UI per sentence, and light/clean as the default. |
| 5 | Visible lip mismatch on camera after rewording | Medium-high | On-screen detection (face detection or an editor flag). Cap close-ups at light/clean. Leave removed time as silence where lips move. Phase-2 lip-sync as a paid add-on. |
| 6 | Licence traps | High (legal) | Keep a licence register. Treat as non-shipping: MMS, OmniVoice, F5 base, Higgs, Fish, CrisperWhisper, Wav2Lip, InsightFace. For a closed plugin, replace GPL Rubber Band, matchering and Seed-VC (Signalsmith; server-only VC). Get legal review of IndicF5, Bandit's CC BY-SA weights, Demucs and RVC pretrained checkpoints, and pyannote attribution. |
| 7 | Consent, deepfake misuse and regulation | High | Recorded consent per cloned speaker (several vendors require scripted consent clips). Block cloning of third parties and public figures. C2PA manifest plus watermark from v1: the EU Art. 50(2) grace period to 2 Dec 2026 applies only to systems on the market before 2 Aug 2026 ([Art. 111](https://artificialintelligenceact.eu/article/111/)). India's labelling rules have applied since 20 Feb 2026. Bangladesh's Cyber Security Ordinance 2025 [uncertain]. Whether "standard editing" exemptions cover cloned re-voicing is unclear, so get a legal opinion. Encrypt voice references and expire them automatically. |
| 8 | Vendor churn and pricing changes | Medium | MAI's $0.10/h promo ends end-2026. OpenAI transcription models shut down 26 Feb 2027 and its TTS models on 6 Jan 2027. ElevenLabs Dubbing Studio is in maintenance mode. Sarvam Bulbul v3 reaches end of life on Voice Agents on 10 Nov 2026 ([Sarvam](https://docs.sarvam.ai/llms.txt)). Mitigations: capability-flagged adapters, budgeting at post-promo prices, and building on primitives rather than vendors' dubbing products. |
| 9 | "Ghost voice": original speech bleeding through the rebuilt background | Medium | Prefer the editor's own dialogue track. Use a dialogue/music/effects separator, not a music separator. Check the background for leftover speech (speech detection plus transcription) and run a second pass or flag. Set background = mix − speech so the sum reproduces the mix exactly. |
| 10 | Wrong speaker assignment, so the wrong cloned voice is used | Medium | Per-mic tracks when available, min/max speaker hints from the editor, a speaker-correction UI, and flags on overlapping speech. |
| 11 | Unicode, numeral and script inconsistency in Bangla (nukta letters, ZWJ, Banglish written in Latin or Bengali script) | Medium | A normalisation layer; separate display and TTS text with an index map; test both scripts against every TTS engine. |
| 12 | Fragile editor integration (Premiere API bugs and gaps, macOS http restriction, frame-quantised placement) | Medium | The bundle always works. Test matrix across 23.976, 24, 25, 29.97 DF/NDF, 30 and 59.94 fps, and both timeline zero points. Null test. Frame-padded clips. |
| 13 | Incumbents follow quickly (Descript adds Bengali; Resolve 21's 10-second voice cloning; ElevenLabs or HeyGen accept same-language jobs) | Medium | The moat is Bangla and Banglish quality, BD/WB locale control, splice-first authenticity, and a native round-trip with the editor, not the pipeline idea itself. |

---

## 7. Open questions for the product owner

1. **Full re-voice or minimal-edit splice by default?** The request says "completely recreate with the same timeline". Splicing (keep original audio, regenerate only changed spans) gives better sync and authenticity at lower cost. Full re-voice gives uniform "studio" sound but more sync and lip risk. *Proposed default:* splice for on-camera speech, full re-voice opt-in for off-screen and voice-over.
2. **Who are the first users, and which editor do they use?** Premiere vs Resolve Free vs CapCut decides the plugin order and whether a plugin is worth building early. Free Resolve and CapCut users can only use the bundle.
3. **May dialogue audio leave the user's machine?** This decides between C and B for some customers, and whether enterprise or regional endpoints are needed.
4. **Distribution and business model.** Closed desktop plugin, SaaS, or open source? This decides which GPL and CC BY-SA components are acceptable, and whether a Rubber Band commercial licence or Signalsmith is needed.
5. **Whose voice may be cloned?** Only the account holder, or also guests and interviewees? This sets the consent flow, cloning limits, watermark and disclosure defaults, and target regions (EU/India labelling).
6. **Bangla variety priority and policy.**
   - Bangladesh vs West Bengal first.
   - Banglish policy: keep English words as spoken, Bengali-ise them, or formalise.
   - Spelling standard: Bangla Academy vs Paschimbanga Bangla Akademi.
   - Digit display: Bengali vs Latin digits.
7. **How aggressive may rewrites be, and is human approval mandatory?** This defines the light/clean/polish defaults and whether any unattended mode exists.
8. **Is lip-sync in scope, and at what price?** sync.so adds about $2.40–8 per video-minute, while the core pipeline costs about $0.2–0.8 (inference).
9. **Target content.** Vlogs and tutorials vs interviews vs drama/natok, music-heavy or multi-speaker content. This changes the transcription, diarization and separation picks and the quality promises.
10. **Price point, cost ceiling and turnaround.** Batch (enables the 50% Batch API and more candidates) vs near-real-time preview. For reference, competitors charge about $0.45–3 per minute [reported] (Sarvam dubbing ₹40/min; Rask about $1.56–3; Dubverse about $1.44).
11. **Bake-off resources.** Can you supply 2–3 hours of representative Bangla and English clips with transcripts, plus native raters from both Bangladesh and West Bengal, within two weeks? Vendor choice depends on this.
12. **Platforms and hardware.** Windows and macOS (Apple silicon?), and whether a local NVIDIA GPU can be assumed for the local or privacy tier.

---

## Appendix: fact-check corrections applied
- **torchaudio:** `forced_align` and `MMS_FA` were not removed in 2.9; they are kept in 2.10+. The licensing problem is the non-commercial MMS weights, not the API.
- **pyannote:** the hosted model is now Precision-3 (€0.112/h Developer, €0.096/h Starter). Precision-2 is no longer on the pricing page.
- **Google Chirp 3:** its Bengali locales are Preview and transcription-only, with no diarization.
- **Deepgram Nova-3:** its multilingual (code-switch) set includes Bengali. It is still only a bake-off entrant, since no Bengali WER is published.
- **Sarvam pricing:** speech-to-text is ₹0.49/min, or ₹0.59/min with diarization (not ₹45/h).
- **Sarvam voice cloning:** the clone API explicitly lists bn-IN and supports code-mixed text.
- **ElevenLabs:** it is not "the only vendor with Bengali and English in one cloned voice". Its own clone docs leave Bengali reference audio [uncertain].
- **Gemini 3.8 TTS:** it does have coarse pace control. OpenAI TTS does have a `speed` parameter, but it is still unusable for Bangla.
- **Demucs:** the repo was archived on 1 Jan 2025.
- **FLEURS:** the Bengali set is confirmed to be the India-only `bn_in` config.
- **Premiere UXP:** `http://` is disallowed on macOS, and `WorkAreaUtils` (26.5) addresses the work-area export bug.
- **Resolve:** `insertWithOffset` only applies when `insertAdditionalTracks=False`, and Workflow Integration plugins were Studio-only before 21.1.
- **Still unverified:**
  - Bangladesh Cyber Security Ordinance specifics;
  - Premiere Generative Extend limits;
  - CapCut/Filmora import specifics;
  - Resolve 21.1 "AI dialogue replacement";
  - IndicF5 commercial terms and its `fix_duration` support;
  - Azure `audioduration` on bn-BD voices;
  - Google Speech-to-Text v2 per-minute pricing.
- **Not separately fact-checked:** the rewrite, audio and market findings (HOMURA, WMT25, Brannon, DRES, MVSep SDR, competitor prices). Treat them as [reported].

