"""Export BeatNet model 1 unchanged to float32 for the browser port.
Requires numpy, scipy and CPU PyTorch; runtime needs no Python or package install.
Usage: python scripts/export-beatnet.py /path/to/pinned/BeatNet
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
from scipy.fft import fft
import torch

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = Path(sys.argv[1])
REVISION = '81cedd4beeb7235262db80969a0c9ce9a48a0ed4'
assert subprocess.check_output(['git', '-C', str(UPSTREAM), 'rev-parse', 'HEAD'], text=True).strip() == REVISION
OUTPUT = ROOT / 'vendor/beatnet'
OUTPUT.mkdir(parents=True, exist_ok=True)
source = UPSTREAM / 'src/BeatNet/models/model_1_weights.pt'
state = torch.load(source, map_location='cpu', weights_only=True)
layout, arrays, offset = {}, [], 0
for name, tensor in state.items():
    data = tensor.detach().numpy().astype('<f4').ravel()
    layout[name] = {'offset': offset, 'shape': list(tensor.shape), 'length': len(data)}
    arrays.append(data)
    offset += len(data)
weights = np.concatenate(arrays).tobytes()
(OUTPUT / 'model-1.f32').write_bytes(weights)

# Reproduce madmom's unique, area-normalized log filterbank exactly, including
# the odd-length STFT's bin-frequency convention (705 bins represented as 1410).
frame_size, hop, sr = 1411, 441, 22050
bin_hz = np.fft.fftfreq((frame_size // 2) * 2, 1 / sr)[:frame_size // 2]
left = np.floor(np.log2(30 / 440) * 24)
right = np.ceil(np.log2(17000 / 440) * 24)
frequencies = 440 * 2 ** (np.arange(left, right) / 24)
frequencies = frequencies[(frequencies >= 30) & (frequencies <= 17000)]
bins = np.clip(np.searchsorted(bin_hz, frequencies), 1, len(bin_hz) - 1)
bins -= frequencies - bin_hz[bins - 1] < bin_hz[bins] - frequencies
bins = np.unique(bins)
filters = []
for start, centre, stop in zip(bins[:-2], bins[1:-1], bins[2:]):
    if stop - start < 2:
        centre, stop = start, start + 1
    values = np.concatenate((np.linspace(0, 1, centre - start, endpoint=False), np.linspace(1, 0, stop - centre, endpoint=False))).astype(np.float32)
    values /= np.sum(values)
    filters.append({'start': int(start), 'values': values.tolist()})
assert len(filters) == 136
frontend = {'sampleRate': sr, 'frameSize': frame_size, 'hopSize': hop, 'fftBins': 705,
            'logBase': 10, 'differenceFrames': 1, 'filters': filters}
(OUTPUT / 'frontend.json').write_text(json.dumps(frontend, separators=(',', ':')) + '\n')
manifest = {'name': 'BeatNet model 1 (GTZAN excluded)', 'source': 'https://github.com/mjhydri/BeatNet',
            'revision': REVISION, 'sourceWeights': 'src/BeatNet/models/model_1_weights.pt',
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'sha256': hashlib.sha256(weights).hexdigest(), 'license': 'CC-BY-4.0',
            'dtype': 'float32-le', 'inputSize': 272, 'hiddenSize': 150, 'layers': 2,
            'weights': layout, 'bytes': len(weights)}
(OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

# Golden outputs from the original PyTorch model, with persistent LSTM state.
spec = importlib.util.spec_from_file_location('beatnet_model', UPSTREAM / 'src/BeatNet/model.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
model = module.BDA(272, 150, 2, 'cpu').eval()
model.load_state_dict(state)
rng = np.random.default_rng(42)
features = rng.uniform(0, 1.2, (12, 272)).astype(np.float32)
with torch.no_grad():
    logits = model(torch.from_numpy(features)[None])[0].T
    probabilities = torch.softmax(logits, dim=1).numpy()
# A deterministic real-valued PCM signal for independent FFT/filter/difference checks.
t = np.arange(frame_size + hop * 5) / sr
pcm = (.12 * np.sin(2 * np.pi * 220 * t) + .06 * np.sin(2 * np.pi * 733 * t)
       + .03 * np.random.default_rng(9).standard_normal(len(t))).astype(np.float32)
expected_features, previous = [], np.zeros(136, dtype=np.float32)
for index in range(6):
    spectrum = fft(pcm[index * hop:index * hop + frame_size] * np.hanning(frame_size))[:705].astype(np.complex64)
    magnitude = np.abs(spectrum)
    filtered = np.array([np.dot(magnitude[f['start']:f['start'] + len(f['values'])], np.array(f['values'], dtype=np.float32)) for f in filters], dtype=np.float32)
    log = np.log10(filtered + 1).astype(np.float32)
    difference = np.maximum(0, log - previous) if index else np.zeros(136, dtype=np.float32)
    expected_features.append(np.concatenate((log, difference)).tolist())
    previous = log
fixture = {'sourceRevision': REVISION, 'features': features.tolist(), 'probabilities': probabilities.tolist(),
           'pcm': pcm.tolist(), 'expectedFeatures': expected_features}
(ROOT / 'tests/beatnet-reference.json').write_text(json.dumps(fixture, separators=(',', ':')) + '\n')
(OUTPUT / 'LICENSE.txt').write_bytes((UPSTREAM / 'LICENSE').read_bytes())
print(json.dumps({'bytes': len(weights), 'filters': len(filters), 'sha256': manifest['sha256']}))
