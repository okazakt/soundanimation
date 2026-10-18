# Beat This! — browser experiment

Original authors: Francesco Foscarin, Jan Schlüter, Gerhard Widmer.
Original implementation and published weights: https://github.com/CPJKU/beat_this
Paper: “Beat This! Accurate Beat Tracking Without DBN Postprocessing”, ISMIR 2024.

Browser port by Johannes Gorset, MIT:
https://github.com/jgorset/beat-this/tree/fce42003a8f74933b68a9aed7f6349340c0138d1
Package @jgorset/beat-this 1.0.0, checkpoint final0 (GTZAN excluded).
Model: https://github.com/jgorset/beat-this/releases/download/v1.0.0/beat-this.onnx
83,008,106 bytes. SHA-256 and export provenance: model.json.
The ONNX model is unmodified. The port is bundled with esbuild; model weights,
preprocessing constants and minimal postprocessor are unchanged.

Runtime: ONNX Runtime Web 1.23.2, Microsoft, MIT (ONNXRUNTIME-LICENSE.txt,
ONNXRUNTIME-NOTICES.txt); fft.js 4.0.4, Fedor Indutny, MIT (FFT-LICENSE.txt).
Original and port copyright notices and MIT terms: LICENSE.

App adaptations: bounded rolling microphone buffer, existing anti-aliasing
resampler from the BeatNet integration (CC BY 4.0; ../beatnet/NOTICE.md),
8-second initial collection, up to 16-second noncausal windows, at least
3 seconds between analyses, inferred tempo/meter and current phase prediction,
CPU/GPU selection, cancellation, timing diagnostics and conventional fallback.
These adaptations have not been evaluated on the paper's benchmarks. The
published paper's accuracy does not describe this live experiment.

The upstream MIT license explicitly covers both code and published weights.
Upstream additionally notes that training recordings may have copyright or
restricted licenses and asks users to assess implications for their use case:
https://github.com/CPJKU/beat_this#license
https://github.com/CPJKU/beat_this/issues/18
No training audio is distributed. No endorsement by the original authors.

Rebuild browser bundle from the pinned browser-port checkout:

    npm ci
    npx esbuild@0.28.2 src/index.ts --bundle --format=esm --platform=browser --minify --legal-comments=eof --outfile=beat-this.mjs

Copy the matching ort-wasm-simd-threaded.asyncify.mjs/.wasm from
node_modules/onnxruntime-web/dist/ alongside the bundle. These assets are served
locally and fetched only after selecting Beat This! and starting the microphone.
They are cached on first selected use in a separate, cache-first service-worker cache. The cache is retained across app-shell upgrades; unchanged assets are reused on reload and offline. Cache availability is shown in the debug UI. Source-clock interruptions reset capture history and phase automatically without reloading model weights.
Microphone audio is kept briefly in RAM only and is not uploaded or persisted.
