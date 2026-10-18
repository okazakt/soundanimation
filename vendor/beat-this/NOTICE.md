# Beat This! — browser experiment

Original authors: Francesco Foscarin, Jan Schlüter, Gerhard Widmer.
Original implementation and published weights: https://github.com/CPJKU/beat_this
Paper: “Beat This! Accurate Beat Tracking Without DBN Postprocessing”, ISMIR 2024.

Browser port by Johannes Gorset, MIT:
https://github.com/jgorset/beat-this/tree/fce42003a8f74933b68a9aed7f6349340c0138d1
Package @jgorset/beat-this 1.0.0, adapted for low-memory CPU use.
Checkpoint: official small0 (GTZAN excluded), exported to ONNX without changing weights.
ONNX export source and hash manifest:
https://github.com/Kanebos9/riffsheet/tree/d7783e09a8e9aa3d6fbe853c3471aa8287769a9e/shell/Resources/models/beat-this
https://github.com/Kanebos9/riffsheet/blob/d7783e09a8e9aa3d6fbe853c3471aa8287769a9e/shell/Resources/models/MANIFEST.sha256
10,555,597 bytes. SHA-256 and export provenance: model.json.
The exported ONNX bytes, preprocessing constants and minimal postprocessor are unchanged.
The browser port is bundled with esbuild after applying scripts/beat-this-low-memory.patch:
CPU-only ORT import, direct model byte input (no Blob/fetch duplicate), basic graph
optimization, sequential execution, no CPU memory arena, memory pattern or prepacking.

Runtime: ONNX Runtime Web 1.23.2, Microsoft, MIT (ONNXRUNTIME-LICENSE.txt,
ONNXRUNTIME-NOTICES.txt); fft.js 4.0.4, Fedor Indutny, MIT (FFT-LICENSE.txt).
Original and port copyright notices and MIT terms: LICENSE.

App adaptations: bounded rolling microphone buffer, existing anti-aliasing
resampler from the BeatNet integration (CC BY 4.0; ../beatnet/NOTICE.md),
8-second initial collection, up to 16-second noncausal windows, at least
3 seconds between analyses, inferred tempo/meter and current phase prediction,
CPU-only execution, cancellation, timing diagnostics and conventional fallback.
These adaptations have not been evaluated on the paper's benchmarks. The
published paper's accuracy does not describe this live experiment.

The upstream MIT license explicitly covers both code and published weights.
Upstream additionally notes that training recordings may have copyright or
restricted licenses and asks users to assess implications for their use case:
https://github.com/CPJKU/beat_this#license
https://github.com/CPJKU/beat_this/issues/18
No training audio is distributed. No endorsement by the original authors.

Rebuild browser bundle from the pinned browser-port checkout:

    git apply --unidiff-zero /path/to/soundanimation/scripts/beat-this-low-memory.patch
    npm ci
    npx esbuild@0.28.2 src/index.ts --bundle --format=esm --platform=browser --minify --legal-comments=eof --outfile=beat-this-cpu.mjs

Copy the matching ort-wasm-simd-threaded.mjs/.wasm from
node_modules/onnxruntime-web/dist/ alongside the bundle. Trailing whitespace in the runtime glue is stripped; runtime code is unchanged. These assets are served
locally. The four required assets total about 23 MB.
They are checked on page view and downloaded before app interaction when missing. A dedicated worker reports byte-based progress, verifies hashes and persists complete files in a separate cache-first resource cache. The large final0 cache is removed after the new small0 resources are fully saved; unchanged small0 files require no re-download; failed setup can retry using completed files. The cache is retained across app-shell upgrades; unchanged assets are reused on reload and offline. Cache availability is shown in the debug UI. Source-clock interruptions reset capture history and phase automatically without reloading model weights.
Microphone audio is kept briefly in RAM only and is not uploaded or persisted.
