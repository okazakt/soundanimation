const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { summarize } = require('../beat-this-rhythm.js');
const root = path.resolve(__dirname, '..');
function fixture(meter, duration = 16) {
  const beats = Array.from({ length: duration * 2 }, (_, i) => .2 + i * .5);
  return { beats, downbeats: beats.filter((_, i) => i % meter === 0),
    beatConfidence: Array(duration * 50 + 1).fill(.9), downbeatConfidence: Array(duration * 50 + 1).fill(.8) };
}
test('vendored ONNX export matches pinned release checksum', () => {
  const model = fs.readFileSync(path.join(root, 'vendor/beat-this/beat-this.onnx'));
  const manifest = require('../vendor/beat-this/model.json');
  assert.equal(model.length, manifest.model.bytes);
  assert.equal(createHash('sha256').update(model).digest('hex'), manifest.model.sha256);
});
test('bundled frontend matches pinned browser-port reference including chunk boundaries', async () => {
  const { extractFeatures, postprocess } = await import('../vendor/beat-this/beat-this.mjs');
  const golden = require('./beat-this-preprocessing-reference.json');
  for (const { length, sha256 } of golden) {
    const pcm = Float32Array.from({ length }, (_, i) => Math.sin(i * .037) * .2 + Math.cos(i * .011) * .1);
    const actual = extractFeatures(pcm);
    assert.equal(createHash('sha256').update(new Uint8Array(actual.buffer)).digest('hex'), sha256);
    const frames = Math.floor(length / 441) + 1, streamed = new Float32Array(frames * 128);
    for (let first = 0; first < frames; first += 100) {
      const count = Math.min(100, frames - first), begin = Math.max(0, first * 441 - 1024), end = Math.min(length, (first + count) * 441 + 1024);
      streamed.set(extractFeatures(pcm.subarray(begin, end), first, count, length, begin), first * 128);
    }
    assert.deepEqual(streamed, actual);
  }
  assert.deepEqual(postprocess(Float32Array.of(-1, 1, -1, -1, -1, -1, -1, -1, 1), Float32Array.of(1, -1, -1, -1, 1, -1, -1, -1, -1)), { beats: [.02, .16], downbeats: [.02] });
});
for (const meter of [2, 3, 4]) test(`${meter}-beat bar summary preserves audio-clock offset and excludes uncertain end boundary`, () => {
  const s = summarize(fixture(meter), 100, 16);
  assert.equal(s.bpm, 120); assert.equal(s.meter, meter); assert.equal(s.meterConfidence, 1);
  assert.equal(s.audioTime, 116); assert.equal(s.lastBeatAudioTime, 115.2);
  assert.ok(s.beatInBar >= 1 && s.beatInBar <= meter);
});
test('no unsupported meter or confident tempo for silence, short excerpts or irregular peaks', () => {
  const empty = summarize({ beats: [], downbeats: [], beatConfidence: [], downbeatConfidence: [] }, 0, 16);
  assert.equal(empty.confidence, 0); assert.equal(empty.meterConfidence, 0); assert.equal(empty.beatInBar, 0);
  const short = summarize(fixture(4, 3), 0, 3); assert.ok(short.meterConfidence < .6);
  const noBars = fixture(3); noBars.downbeats = [];
  assert.equal(summarize(noBars, 0, 16).meter, 0);
  const broken = fixture(4); broken.beats = [1, 1.3, 2.2, 2.9, 4, 4.4, 5.4, 5.7];
  assert.ok(summarize(broken, 0, 16).confidence < .55);
});
