# Contributing

Use Node.js 24. Read [AGENTS.md](AGENTS.md), [architecture](docs/architecture.md) and [validation](docs/validation.md). Provision the pinned backend with `node scripts/Install-Essentia.mjs`, then run `node --test test/*.test.mjs`. Set `FFMPEG` for real generated-audio decoding/Essentia tests. Setup extracts the verified runtime without npm lifecycle scripts; no `npm install` is needed.

Use mock host connections, private temporary fixture libraries and synthetic audio. Do not use real USBs or a live music collection for routine checks. Describe what your checks establish and any skips. Numeric constraint checks do not establish musical quality.

For host changes, pin the upstream version and command shapes, test wrong-library/device rejection, and preserve native protection errors. For writes, exercise stale previews, interruption, response loss, exact-order readback and safe resume. Never add direct database fallbacks.

Before publishing: update version fields together, record Windows/Linux results, inspect the independent source-only setup archive for private data, and use a matching version tag. The workflow publishes only after both test platforms pass. See the validation record for actual release evidence.
