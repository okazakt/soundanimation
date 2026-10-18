const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { summarize, Tracker } = require('../beat-this-rhythm.js');
const core = require('../beat-this-audio.js');
const empty = () => ({ beats: [], downbeats: [], beatConfidence: [], downbeatConfidence: [] });
function fixture(analyze) {
  const timers = new Map(), messages = [], windows = []; let next = 0;
  const self = { location: { href: 'https://example.test/app/beat-this-worker.js' }, BeatThisAudio: core, BeatThisRhythm: { Tracker }, ModelAssets: require('../model-assets.js'), BeatThisRhythm: { summarize, Tracker }, postMessage: m => messages.push(m) };
  const fakeTracker = { async analyze(pcm) { windows.push(pcm); return analyze ? analyze(pcm) : empty(); } };
  const code = fs.readFileSync(require.resolve('../beat-this-worker.js'), 'utf8').replace(/^import .*;$/gm, '') + '\ntracker = fakeTracker; resampler = new self.BeatThisAudio.Resampler(inputRate);';
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
  assert.equal(f.windows.length, 1); assert.equal(f.windows[0].length, 8 * 22050);
  assert.ok(f.windows[0].every(Number.isFinite)); assert.ok(Math.abs(f.windows[0].at(-1)) <= .951);
  const state = f.messages.find(m => m.type === 'result').state;
  assert.equal(state.audioTime, 121); assert.equal(state.windowSeconds, 8);
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
  assert.equal(f.timers.size, 1); assert.equal(f.windows.length, 0);
  assert.equal(f.messages.filter(m => m.type === 'resync').length, 1);
  await f.feed(114, 7); await f.run();
  const state = f.messages.find(m => m.type === 'result').state;
  assert.equal(state.resyncCount, 1); assert.equal(state.windowSeconds, 8); assert.equal(state.audioTime, 121);
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
  await f.send(111.2, new Float32Array(2048).fill(.1), { rate: 48000, discontinuity: true });
  assert.equal(f.messages.filter(m => m.type === 'resync').length, 2);
  assert.ok(!f.messages.some(m => m.type === 'error'));
});
test('invalid model bytes are evicted so a bad cached download cannot fail permanently', async () => {
  const deleted = [], messages = [];
  const self = { location: { href: 'https://example.test/app/beat-this-worker.js' }, BeatThisAudio: core, BeatThisRhythm: { Tracker }, ModelAssets: require('../model-assets.js'), postMessage: m => messages.push(m) };
  const code = fs.readFileSync(require.resolve('../beat-this-worker.js'), 'utf8').replace(/^import .*;$/gm, '');
  vm.runInNewContext(code, { self, Float32Array, Uint8Array, URL, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(5) }),
    crypto: { subtle: { digest: async () => new ArrayBuffer(32) } }, caches: { async open() { return { async delete(url) { deleted.push(url); } }; } } });
  await self.onmessage({ data: { type: 'load', rate: 22050 } });
  assert.deepEqual(deleted, ['https://example.test/app/vendor/beat-this/beat-this-small0.onnx']);
  assert.match(messages.at(-1).message, /次の開始時.*再取得/);
});
test('model initialization passes verified bytes directly to CPU runtime without a Blob or GPU attempt', async () => {
  const bytes = Uint8Array.of(1, 2, 3, 4), messages = [], calls = [];
  const file = { name: 'small.onnx', bytes: bytes.length, sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex') };
  const self = { location: { href: 'https://example.test/app/beat-this-worker.js' }, BeatThisAudio: core, BeatThisRhythm: { Tracker },
    ModelAssets: { ...require('../model-assets.js'), FILES: [file] }, postMessage: m => messages.push(m) };
  const code = fs.readFileSync(require.resolve('../beat-this-worker.js'), 'utf8').replace(/^import .*;$/gm, '');
  vm.runInNewContext(code, { self, Float32Array, Uint8Array, URL,
    crypto: require('node:crypto').webcrypto,
    fetch: async url => { calls.push(url); return new Response(bytes); },
    createBeatThis: async options => { assert.deepEqual([...options.modelData], [...bytes]); assert.equal(options.executionProvider, 'wasm'); assert.equal(options.modelUrl, undefined); return {}; }
  });
  await self.onmessage({ data: { type: 'load', rate: 22050 } });
  assert.deepEqual(calls, ['https://example.test/app/vendor/beat-this/small.onnx']);
  assert.equal(messages.at(-1).type, 'ready'); assert.equal(messages.at(-1).provider, 'wasm');
});
test('warmup begins at two seconds, expands to eight, and waits one second between starts', async () => {
  const f = fixture();
  await f.feed(0, 1); assert.equal(f.timers.size, 0);
  await f.feed(1, 1); assert.equal(f.timers.size, 1); await f.run();
  assert.equal(f.windows[0].length, 2*22050);
  await f.feed(2, .5); assert.equal(f.timers.size, 0);
  await f.feed(2.5, .5); assert.equal(f.timers.size, 1); await f.run();
  assert.equal(f.windows[1].length, 3*22050);
  await f.feed(3, 6); await f.run(); assert.equal(f.windows[2].length, 8*22050);
});
test('quiet microphone windows skip model inference and clear confidence', async () => {
  const f = fixture();
  for(let i=0;i<4;i++) await f.send(i*.5,new Float32Array(11025));
  await f.run(); assert.equal(f.windows.length,0);
  const s=f.messages.find(m=>m.type==='result').state;
  assert.equal(s.confidence,0);assert.equal(s.meter,0);assert.equal(s.inputGain,0);
});

test('reported iPhone music level RMS .001 is normalized and sent to the model instead of gated',async()=>{
  const f=fixture();
  for(let i=0;i<4;i++) await f.send(i*.5,Float32Array.from({length:11025},(_,j)=>Math.SQRT2*.001*Math.sin(2*Math.PI*100*j/22050)));
  await f.run();assert.equal(f.windows.length,1);
  const state=f.messages.find(m=>m.type==='result').state;
  assert.ok(Math.abs(state.inputRms-.001)<1e-6);assert.ok(state.inputGain>90);
  assert.equal(state.quiet,0);
});
