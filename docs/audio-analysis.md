# Audio analysis

Enable **Analyze local audio for energy and transitions** when generating. Essentia is the default backend; Advanced offers Basic as an explicit alternative. Analysis does not upload audio, download songs, alter host BPM/key, rewrite tags, cues or beat grids, or create a playlist. Dependency setup downloads code, not analysis results.

## Essentia backend

The checksum-pinned Essentia.js 0.1.3 UMD/WebAssembly build runs inside a Node worker. No Python, npm lifecycle script, TensorFlow runtime or pretrained model is required. FFmpeg decodes the complete local file to 44.1 kHz mono PCM. A bounded collector retains at most 30 seconds each from the beginning, midpoint and end. A track shorter than 30 seconds uses its whole signal for all three windows; windows can overlap on shorter tracks.

The full decode has a 180-second deadline and a 30-minute audio limit. Decoded duration must agree with host metadata within the larger of three seconds or 2%; a measured mismatch blocks generation until corrected. The worker's feature computation has a 90-second deadline and can be terminated on cancellation. File stamps and current library/device identity are checked around analysis. No decoded PCM is saved to disk.

Essentia computes Danceability, OnsetRate, DynamicComplexity/loudness and frame-wise spectral centroid and low-frequency energy ratio. When BPM is missing from host metadata, the middle window also runs RhythmExtractor2013 with the `multifeature` method at 44.1 kHz. When a recognized host key is missing, it runs KeyExtractor with the `edma` tonal profile. These two estimates do not contribute to the energy descriptors, which are always measured. Loudness is the DynamicComplexity algorithm's dB estimate, not EBU R128 LUFS. Stored descriptors retain their raw units.

## Energy and transitions

Essentia supplies descriptors. Wizard's 1–10 score is a separate, experimental mapping, not an Essentia-provided trained energy classifier:

| Descriptor | Weight | Normalization |
| --- | --- | --- |
| Onset rate | 35% | rate / 5 |
| Danceability | 25% | value / 3 |
| Median spectral centroid | 20% | Hz / 5,000 |
| Median 20–250 Hz energy ratio | 10% | ratio / 0.6 |
| Dynamic complexity | 10% | 1 − dB / 15 |

Each term is clamped to 0–1; the weighted sum maps to 1–10. Silence scores 1. A missing required descriptor leaves the score unknown. Shape descriptors use peak-normalized samples; absolute loudness is retained for inspection and does not directly raise energy. Raw danceability can exceed its usual range and remains unmodified in saved results even when its scoring contribution saturates.

Curve matching compares intro, body and outro energy against the requested curve at each excerpt's midpoint in the elapsed set. It averages the absolute mismatches and multiplies by three, preserving the previous scale for body-only/Basic evidence. Missing energy contributes the full possible nine-point mismatch rather than the former small fixed penalty. The existing middle/body score remains the editable track estimate; intro/outro dots on the chart expose stronger sections instead of hiding them behind that line. No new decode or cache invalidation is needed to use saved section descriptors.

After sequencing, review uses the final estimated mixed runtime. A visible opening notice identifies an unknown intro/body or an intro/body more than two energy points above its target. Notes count songs with any sampled section more than two points away in either direction. Two points is a review threshold, not a calibrated musical boundary or new hard constraint. Transition limits, locks, source coverage and the bounded search can still prevent a close curve fit. The curve remains a preference; a returned draft is not a verified warm-up set.

Transition costs also compare sampled outgoing/incoming energy, brightness, danceability and dynamics. They do not establish cue-aligned or phrase-aligned mixes. Changes outside the excerpts can be missed. A manual correction replaces automatic section scores for curve matching while retaining measured descriptors for inspection and transition costs; corrections survive backend changes.

## Tempo/key evidence

Valid host BPM/key always win. Estimates fill missing fields inside the draft only:

- BPM: 60–208 BPM, raw multifeature confidence at least 1.5, and beat-interval regularity at least 0.6 over at least eight intervals. Regularity is `clamp(1 − intervalCV / 0.2)`.
- Key: recognized major/minor key and raw strength at least 0.6.

These thresholds are policy choices, not calibrated accuracy claims. Raw beat/key strength is not a percentage. Low values remain unknown. New analysis does not calculate a second estimate solely to cross-check valid host metadata. If a previously cached accepted estimate disagrees with the host value, the disagreement is still reported and the host value retained. Half/double-time equivalence is considered when flagging tempo disagreement. Strict harmonic mode still refuses unknown or incompatible keys.

## Cache, failures and Basic fallback

Cache entries bind file stamps, library/device namespace, backend and analyzer version. Basic caches do not count as Essentia analysis. Manual corrections use separate, backend-independent keys. Changed files and versions invalidate results. Cached measured duration cannot silently contradict newly edited host duration. The descriptor algorithms/version are unchanged by the performance improvement, so existing caches stay usable. New entries record which BPM/key estimates were attempted; if missing host metadata needs an estimate that was skipped, the next requested analysis refreshes that entry. Analysis disabled still means no new computation.

Essentia uses at most two concurrent track tasks, each with its own decoder and disposable worker. The queue chooses one task when fewer than four logical CPUs or less than 768 MiB free system memory are available at generation start. It retains input order and counts completed tasks in progress. Every uncached track still rechecks current library/device identity before and after analysis and verifies its file stamp before caching. Cancellation or a fatal identity/duration error aborts and drains the active tasks before returning; work that completed and passed its checks remains cached. Basic analysis stays serial. No additional dashboard or settings are required.

For a reproducible offline timing check, set `FFMPEG`, install the pinned Essentia runtime, and run `node scripts/Benchmark-Analysis.mjs`. It generates two synthetic five-minute WAV files, processes four track requests twice for each scenario, checks descriptor equality and unchanged source bytes, and removes its temporary audio. Use `--format mp3` for 320 kbps stereo MP3 fixtures. `--baseline-directory <older-source-root>` compares the actual older implementation. Timings are synthetic machine-specific evidence, not a library-wide speed guarantee; see [validation](validation.md).

Missing or modified runtime files fail before source scanning/decoding. Re-run setup, or explicitly choose Basic. Per-file decode/feature failures leave unavailable features unknown and are reported; no heuristic is silently substituted. Measured duration mismatch and library/device changes stop generation. Cancellation keeps completed, validated cache entries.

Basic retains the complete-file, 8 kHz heuristic using envelope activity, waveform brightness, bass ratio, crest factor and active coverage. It supplies no new BPM/key estimate. Both energy mappings need representative listening calibration; richer descriptors alone do not prove that the sets flow better.

## Upstream references

- [Essentia.js source and Node usage](https://github.com/MTG/essentia.js)
- [RhythmExtractor2013](https://essentia.upf.edu/reference/std_RhythmExtractor2013.html)
- [KeyExtractor](https://essentia.upf.edu/reference/std_KeyExtractor.html)
- [Danceability](https://essentia.upf.edu/reference/std_Danceability.html)
- [DynamicComplexity](https://essentia.upf.edu/reference/std_DynamicComplexity.html)

Pinned sources and license obligations are recorded in [THIRD_PARTY.md](../THIRD_PARTY.md).
