const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Features, Network, Resampler, Tracker, FRAME, HOP } = require('../beatnet-core.js');
const root = path.resolve(__dirname, '..');
const frontend = JSON.parse(fs.readFileSync(path.join(root, 'vendor/beatnet/frontend.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor/beatnet/manifest.json')));
const reference = JSON.parse(fs.readFileSync(path.join(__dirname, 'beatnet-reference.json')));
const bytes = fs.readFileSync(path.join(root, 'vendor/beatnet/model-1.f32'));
const modelBuffer = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('exported weights retain the pinned upstream model and all recurrent outputs match PyTorch', () => {
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.equal(manifest.revision, reference.sourceRevision);
  const model = new Network(manifest, modelBuffer()); let maximum = 0;
  reference.features.forEach((features, i) => {
    const probabilities = model.process(Float32Array.from(features));
    for (let k = 0; k < 3; k++) maximum = Math.max(maximum, Math.abs(probabilities[k] - reference.probabilities[i][k]));
    assert.ok(Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-6);
  });
  assert.ok(maximum < 2e-5, `maximum probability error ${maximum}`);
  assert.throws(() => new Network(manifest, new ArrayBuffer(16)));
});
test('odd-length FFT, log filters and positive differences match the Python frontend', () => {
  const features = new Features(frontend); let maximum = 0;
  reference.expectedFeatures.forEach((expected, i) => {
    const actual = features.process(Float32Array.from(reference.pcm.slice(i * HOP, i * HOP + FRAME)));
    actual.forEach((value, k) => { maximum = Math.max(maximum, Math.abs(value - expected[k])); });
  });
  assert.ok(maximum < 2e-6, `maximum feature error ${maximum}`);
});
test('streaming resampling is independent of input chunk boundaries and keeps bounded memory', () => {
  const input = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i * .1));
  const whole = new Resampler(48000).process(input), chunked = new Resampler(48000), results = [];
  for (let start = 0; start < input.length; start += 128) results.push(...chunked.process(input.subarray(start, start + 128)));
  assert.equal(results.length, whole.length);
  for (let i = 0; i < whole.length; i++) assert.ok(Math.abs(results[i] - whole[i]) < 1e-5);
  assert.ok(chunked.buffer.length < 64);
  const highTone = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(2 * Math.PI * 15000 * i / 48000));
  const filtered = new Resampler(48000).process(highTone).subarray(100);
  const rms = Math.sqrt(filtered.reduce((sum, v) => sum + v * v, 0) / filtered.length);
  assert.ok(rms < .03, 'above-Nyquist microphone energy must not alias into the neural features');
});
test('particle filter keeps fixed budgets, infers pulse tempo and cannot assert meter without downbeats', () => {
  const tracker = new Tracker(); let state;
  for (let i = 0; i < 50 * 25; i++) {
    state = tracker.process(i % 25 < 2 ? [.92, .02, .06] : [.005, .005, .99]);
    assert.equal(tracker.particles.length, 1500); assert.equal(tracker.down.length, 250);
    assert.ok(Number.isFinite(state.bpm) && state.confidence >= 0 && state.confidence <= 1);
  }
  assert.ok(Math.abs(state.bpm - 120) < 4, `BPM ${state.bpm}`);
  assert.equal(state.meterConfidence, 0);
});


test('the neural observation particle cascade separates 2, 3 and 4 and preserves state across calls', () => {
  for (const meter of [2, 3, 4]) {
    const tracker = new Tracker(); let state;
    for (let i = 0; i < 50 * 30; i++) {
      const down = Math.floor(i / 25) % meter === 0;
      state = tracker.process(i % 25 < 2 ? (down ? [.02, .94, .04] : [.94, .02, .04]) : [.005, .005, .99]);
    }
    assert.equal(state.meter, meter);
    assert.ok(state.meterConfidence > .7);
    assert.ok(Math.abs(state.bpm - 120) < 4);
  }
});
