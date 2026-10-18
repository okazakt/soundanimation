# BeatNet attribution and changes

BeatNet: CRNN and Particle Filtering for Online Joint Beat Downbeat and Meter Tracking.
Mojtaba Heydari, Frank Cwitkowitz and Zhiyao Duan, ISMIR 2021.
Original author contact: Mojtaba Heydari <mheydari@ur.rochester.edu>.
Source: https://github.com/mjhydri/BeatNet
Paper: https://arxiv.org/abs/2108.03576
License: Creative Commons Attribution 4.0 International (CC BY 4.0).
https://creativecommons.org/licenses/by/4.0/
Full legal text: LICENSE.txt in this directory.

Pinned upstream revision: 81cedd4beeb7235262db80969a0c9ce9a48a0ed4.
Model: src/BeatNet/models/model_1_weights.pt (GTZAN excluded from training).
Model parameters are unchanged, converted to little-endian float32. Source and
export SHA-256 hashes and the tensor layout are recorded in manifest.json.

Changes in this application (October 2026):
- Reimplemented the Conv1d / max-pool / projection / two-layer causal LSTM /
  softmax network in JavaScript, with persistent recurrent state in a Worker.
- Reproduced the 22050 Hz, 1411-sample Hann, 441-sample hop, 136-band normalized
  logarithmic filterbank and positive spectral difference frontend.
- Added streaming anti-alias resampling and AudioWorklet capture.
- Adapted the two-stage particle cascade (1500 beat, 250 bar particles), retaining
  the 55–215 BPM state space, 2/3/4 meter hypotheses, transition priors and neural
  observation gates. Particle injection is resampled to a fixed budget; skipped
  activations do not advance the bar state several times within one beat.
- Added confidence, bounded message queues, silence/staleness checks, fallback
  and a renderer clock. These are application adaptations, not upstream results.

The frontend and state-space conventions originate in madmom by Sebastian Böck,
Florian Krebs and contributors: https://github.com/CPJKU/madmom . Its BSD-3-Clause
code license is reproduced in MADMOM-LICENSE.txt. No madmom pretrained models
are included or used. The exported filterbank contains numeric coefficients.

No endorsement by the original authors is implied. Published research accuracy
figures must not be attributed to this JavaScript adaptation without evaluation.
