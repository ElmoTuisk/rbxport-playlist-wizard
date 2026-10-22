# Audio analysis

Enable **Analyze local audio for energy and transitions** when generating. Essentia is the default backend; Advanced offers Basic as an explicit alternative. Analysis does not upload audio, download songs, alter host BPM/key, rewrite tags, cues or beat grids, or create a playlist. Dependency setup downloads code, not analysis results.

## Essentia backend

The checksum-pinned Essentia.js 0.1.3 UMD/WebAssembly build runs inside a Node worker. No Python, npm lifecycle script, TensorFlow runtime or pretrained model is required. FFmpeg decodes the complete local file to 44.1 kHz mono PCM. A bounded collector retains at most 30 seconds each from the beginning, midpoint and end. A track shorter than 30 seconds uses its whole signal for all three windows; windows can overlap on shorter tracks.

The full decode has a 180-second deadline and a 30-minute audio limit. Decoded duration must agree with host metadata within the larger of three seconds or 2%; a measured mismatch blocks generation until corrected. The worker's feature computation has a 90-second deadline and can be terminated on cancellation. File stamps and current library/device identity are checked around analysis. No decoded PCM is saved to disk.

Essentia computes Danceability, OnsetRate, DynamicComplexity/loudness and frame-wise spectral centroid and low-frequency energy ratio. The middle window also runs RhythmExtractor2013 with the `multifeature` method at 44.1 kHz, and KeyExtractor with the `edma` tonal profile. Loudness is the DynamicComplexity algorithm's dB estimate, not EBU R128 LUFS. Stored descriptors retain their raw units.

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

Body energy guides the curve. Transition costs also compare sampled outgoing/incoming energy, brightness, danceability and dynamics. These are soft costs, without new hidden hard requirements. They do not establish cue-aligned or phrase-aligned mixes. Changes outside the excerpts can be missed. Manual corrections override body energy and survive backend changes.

## Tempo/key evidence

Valid host BPM/key always win. Estimates fill missing fields inside the draft only:

- BPM: 60–208 BPM, raw multifeature confidence at least 1.5, and beat-interval regularity at least 0.6 over at least eight intervals. Regularity is `clamp(1 − intervalCV / 0.2)`.
- Key: recognized major/minor key and raw strength at least 0.6.

These thresholds are policy choices, not calibrated accuracy claims. Raw beat/key strength is not a percentage. Low values remain unknown. A host/accepted-estimate disagreement is reported while retaining the host value. Half/double-time equivalence is considered when flagging tempo disagreement. Strict harmonic mode still refuses unknown or incompatible keys.

## Cache, failures and Basic fallback

Cache entries bind file stamps, library/device namespace, backend and analyzer version. Basic caches do not count as Essentia analysis. Manual corrections use separate, backend-independent keys. Changed files and versions invalidate results. Cached measured duration cannot silently contradict newly edited host duration.

Missing or modified runtime files fail before source scanning/decoding. Re-run setup, or explicitly choose Basic. Per-file decode/feature failures leave unavailable features unknown and are reported; no heuristic is silently substituted. Measured duration mismatch and library/device changes stop generation. Cancellation keeps completed, validated cache entries.

Basic retains the complete-file, 8 kHz heuristic using envelope activity, waveform brightness, bass ratio, crest factor and active coverage. It supplies no new BPM/key estimate. Both energy mappings need representative listening calibration; richer descriptors alone do not prove that the sets flow better.

## Upstream references

- [Essentia.js source and Node usage](https://github.com/MTG/essentia.js)
- [RhythmExtractor2013](https://essentia.upf.edu/reference/std_RhythmExtractor2013.html)
- [KeyExtractor](https://essentia.upf.edu/reference/std_KeyExtractor.html)
- [Danceability](https://essentia.upf.edu/reference/std_Danceability.html)
- [DynamicComplexity](https://essentia.upf.edu/reference/std_DynamicComplexity.html)

Pinned sources and license obligations are recorded in [THIRD_PARTY.md](../THIRD_PARTY.md).
