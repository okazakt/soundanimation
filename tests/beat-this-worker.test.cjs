const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { summarize } = require('../beat-this-rhythm.js');
test('worker drains queued capture before inference and keeps only the latest bounded window', async () => {
  const timers = [], messages = [], windows = [];
  const self = { location: { href: 'https://example.test/app/beat-this-worker.js' }, BeatThisRhythm: { summarize }, postMessage: m => messages.push(m) };
  const fakeTracker = { async analyze(pcm) { windows.push(pcm); return { beats: [], downbeats: [], beatConfidence: [], downbeatConfidence: [] }; } };
  const code = fs.readFileSync(require.resolve('../beat-this-worker.js'), 'utf8').replace(/^import .*;$/gm, '') + '\ntracker = fakeTracker; resampler = { process: x => x };';
  vm.runInNewContext(code, { self, fakeTracker, Float32Array, URL, performance: { now: () => 0 }, setTimeout: fn => timers.push(fn) });
  const send = async (first, count) => self.onmessage({ data: { type: 'pcm', audioTime: 100 + first / 22050,
    pcm: Float32Array.from({ length: count }, (_, i) => first + i) } });
  // Model may block a worker while the main thread continues sending PCM.
  // Simulate the pending capture queue draining before its inference timer runs.
  let count = 0;
  while (count < 22050 * 21) { const n = Math.min(16384, 22050 * 21 - count); await send(count, n); count += n; }
  assert.equal(timers.length, 1); assert.equal(windows.length, 0);
  await timers.shift()();
  assert.equal(windows.length, 1); assert.equal(windows[0].length, 16 * 22050);
  assert.equal(windows[0][0], 5 * 22050); assert.equal(windows[0].at(-1), 21 * 22050 - 1);
  const state = messages.find(m => m.type === 'result').state;
  assert.equal(state.audioTime, 121); assert.equal(state.windowSeconds, 16);
  assert.ok(!messages.some(m => m.type === 'error'));
  await self.onmessage({ data: { type: 'pcm', audioTime: 121, pcm: Float32Array.of(NaN) } });
  assert.match(messages.at(-1).message, /不正/);
});
