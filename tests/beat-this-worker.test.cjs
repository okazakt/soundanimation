const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { summarize } = require('../beat-this-rhythm.js');
const core = require('../beatnet-core.js');
const empty = () => ({ beats: [], downbeats: [], beatConfidence: [], downbeatConfidence: [] });
function fixture(analyze) {
  const timers = new Map(), messages = [], windows = []; let next = 0;
  const self = { location: { href: 'https://example.test/app/beat-this-worker.js' }, BeatNetCore: core, BeatThisRhythm: { summarize }, postMessage: m => messages.push(m) };
  const fakeTracker = { async analyze(pcm) { windows.push(pcm); return analyze ? analyze(pcm) : empty(); } };
  const code = fs.readFileSync(require.resolve('../beat-this-worker.js'), 'utf8').replace(/^import .*;$/gm, '') + '\ntracker = fakeTracker; resampler = new self.BeatNetCore.Resampler(inputRate);';
  vm.runInNewContext(code, { self, fakeTracker, Float32Array, URL, performance: { now: () => 0 }, setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) });
  return { timers, messages, windows, async send(audioTime, pcm, extra = {}) { await self.onmessage({ data: { type: 'pcm', audioTime, pcm, ...extra } }); },
    async feed(start, seconds, rate = 22050, skew = 0) {
      const length = Math.round(seconds * rate); let count = 0, block = 0;
      while (count < length) { const n = Math.min(16384, length - count); await this.send(start + count / rate + skew * block++, Float32Array.from({ length: n }, (_, i) => count + i), { rate }); count += n; }
    }, async run() { const [id, fn] = timers.entries().next().value; timers.delete(id); return fn(); } };
}
test('worker drains queued capture before inference and keeps only the latest bounded window', async () => {
  const f = fixture(); await f.feed(100, 21);
  assert.equal(f.timers.size, 1); assert.equal(f.windows.length, 0); await f.run();
  assert.equal(f.windows.length, 1); assert.equal(f.windows[0].length, 16 * 22050);
  assert.equal(f.windows[0][0], 5 * 22050); assert.equal(f.windows[0].at(-1), 21 * 22050 - 1);
  const state = f.messages.find(m => m.type === 'result').state;
  assert.equal(state.audioTime, 121); assert.equal(state.windowSeconds, 16);
  assert.ok(!f.messages.some(m => m.type === 'error'));
  await f.send(121, Float32Array.of(NaN)); assert.match(f.messages.at(-1).message, /不正/);
});
test('small consecutive timestamp differences cannot accumulate into a false interruption failure', async () => {
  const f = fixture();
  for (let i = 0; i < 220; i++) await f.send(100 + i * 1000 / 22050 + i * .001, new Float32Array(1000));
  await f.run();
  assert.ok(!f.messages.some(m => ['error', 'resync'].includes(m.type)));
  const state = f.messages.find(m => m.type === 'result').state;
  assert.ok(Math.abs(state.audioTime - (100 + 220000 / 22050 + .219)) < 1e-8);
});
test('a real gap cancels queued old-window inference and automatically collects a fresh window', async () => {
  const f = fixture(); await f.feed(100, 9);
  await f.feed(112, 2); // Three-second source gap, with an inference timer pending.
  assert.equal(f.timers.size, 0); assert.equal(f.windows.length, 0);
  assert.equal(f.messages.filter(m => m.type === 'resync').length, 1);
  await f.feed(114, 7); await f.run();
  const state = f.messages.find(m => m.type === 'result').state;
  assert.equal(state.resyncCount, 1); assert.equal(state.windowSeconds, 9); assert.equal(state.audioTime, 121);
  assert.ok(!f.messages.some(m => m.type === 'error'));
});
test('in-flight results from before a gap are discarded; capture-rate changes recover without reloading the model', async () => {
  let resolve; const f = fixture(() => new Promise(done => { resolve = done; }));
  await f.feed(100, 9); const pending = f.run();
  await f.feed(111, .2, 48000);
  resolve(empty()); await pending;
  assert.equal(f.messages.filter(m => m.type === 'result').length, 0);
  assert.equal(f.messages.filter(m => m.type === 'resync').length, 1);
  // Discontinuity can be explicit even if the block timestamp itself looks continuous.
  await f.send(111.2, new Float32Array(2048), { rate: 48000, discontinuity: true });
  assert.equal(f.messages.filter(m => m.type === 'resync').length, 2);
  assert.ok(!f.messages.some(m => m.type === 'error'));
});
test('invalid model bytes are evicted so a bad cached download cannot fail permanently', async () => {
  const deleted = [], messages = [];
  const self = { location: { href: 'https://example.test/app/beat-this-worker.js' }, BeatNetCore: core, postMessage: m => messages.push(m) };
  const code = fs.readFileSync(require.resolve('../beat-this-worker.js'), 'utf8').replace(/^import .*;$/gm, '');
  vm.runInNewContext(code, { self, Float32Array, Uint8Array, URL, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(5) }),
    crypto: { subtle: { digest: async () => new ArrayBuffer(32) } }, caches: { async open() { return { async delete(url) { deleted.push(url); } }; } } });
  await self.onmessage({ data: { type: 'load', rate: 22050 } });
  assert.deepEqual(deleted, ['https://example.test/app/vendor/beat-this/beat-this.onnx']);
  assert.match(messages.at(-1).message, /次の開始時.*再取得/);
});
