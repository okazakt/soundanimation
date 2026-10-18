const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('vendored ONNX export matches pinned release checksum', () => {
  const model = fs.readFileSync(path.join(root, 'vendor/beat-this/beat-this-small0.onnx'));
  const manifest = require('../vendor/beat-this/model.json');
  assert.equal(model.length, manifest.model.bytes);
  assert.equal(createHash('sha256').update(model).digest('hex'), manifest.model.sha256);
});
test('bundled frontend matches pinned browser-port reference including chunk boundaries', async () => {
  const { extractFeatures, postprocess } = await import('../vendor/beat-this/beat-this-cpu.mjs');
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
