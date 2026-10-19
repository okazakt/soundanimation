const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function clientFixture(autoReady = true, options = {}) {
  const workers = [], nodes = [], states = [], statuses = [], storage = [], attacks = [];
  let clock = 0;
  class Worker {
    constructor() { this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); if (message.type === 'load' && autoReady) queueMicrotask(() => this.emit({ type: 'ready' })); }
    emit(data) { this.onmessage?.({ data }); }
    terminate() { this.terminated = true; }
  }
  class AudioWorkletNode {
    constructor() { this.port = {}; nodes.push(this); }
    connect() {}
    disconnect() { this.disconnected = true; }
  }
  const context = { sampleRate: 48000, audioWorklet: { async addModule() {} },
    createBiquadFilter: () => ({ frequency: {}, connect() {}, disconnect() {} }),
    createGain: () => ({ gain: {}, connect() {}, disconnect() {} }), destination: {} };
  const source = { connections: new Set(), connect(node) { this.connections.add(node); }, disconnect(node) { this.connections.delete(node); } };
  const window = { Worker, AudioWorkletNode, BeatThisAudio: require('../beat-this-audio.js') };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../beat-this-client.js'), 'utf8'), {
    window, Worker, AudioWorkletNode, document: { baseURI: 'https://example.test/soundanimation/' }, URL,
    setTimeout, clearTimeout, performance: { now: () => clock++ }, ...options
  });
  const client = new window.BeatThisClient(state => states.push(state), status => statuses.push(status), value => storage.push(value), () => {}, time => attacks.push(time));
  return { client, context, source, workers, nodes, states, statuses, storage, attacks,
    capture(data = { pcm: new Float32Array(2048), firstFrame: 0 }) { nodes[0].port.onmessage({ data }); } };
}
test('Beat This cancellation during large-model load cannot start capture later', async () => {
  const f = clientFixture(false), pending = f.client.start(f.context, f.source);
  f.client.stop(); await assert.rejects(pending, /Beat This!停止/);
  f.workers[0].emit({ type: 'ready' });
  assert.ok(f.workers[0].terminated); assert.equal(f.nodes.length, 0);
});
test('CPU inference permits a bounded audio queue and fails cleanly on overload', async () => {
  const f = clientFixture(); await f.client.start(f.context, f.source);
  for (let i = 0; i < 256; i++) f.capture();
  assert.equal(f.client.pending, 256); assert.ok(!f.client.stopped);
  f.workers[0].emit({ type: 'ack' }); f.capture(); assert.equal(f.client.pending, 256);
  f.capture(); assert.ok(f.client.stopped && f.workers[0].terminated);
  assert.equal(f.source.connections.size, 0);
  assert.match(f.statuses.at(-1), /追いつきません.*リズム判定を停止/);
});
test('delayed inference results are timestamped, but excessively stale results are rejected', async () => {
  const f = clientFixture(); await f.client.start(f.context, f.source);
  f.context.currentTime = 20;
  f.workers[0].emit({ type: 'result', state: { audioTime: 17, windowSeconds: 16 } });
  assert.equal(f.states.at(-1).receivedAudioTime, 20);
  f.workers[0].emit({ type: 'result', state: { audioTime: 9, windowSeconds: 16 } });
  assert.ok(f.client.stopped); assert.equal(f.states.at(-1), null);
});
test('cancellation while registering the shared capture worklet cannot reconnect the source', async () => {
  const f = clientFixture(); let resolve;
  f.context.audioWorklet.addModule = () => new Promise(done => { resolve = done; });
  const pending = f.client.start(f.context, f.source);
  await new Promise(done => setImmediate(done)); f.client.stop(); resolve(); await pending;
  assert.equal(f.nodes.length, 0); assert.equal(f.source.connections.size, 0);
});
test('source clock/rate metadata override the context estimate; resync clears state without destroying inference', async () => {
  const f = clientFixture(); await f.client.start(f.context, f.source);
  f.capture({ pcm: new Float32Array(2048), firstFrame: 999, audioTime: 10, sampleRate: 44100, discontinuity: true });
  const sent = f.workers[0].messages.at(-1);
  assert.equal(sent.audioTime, 10); assert.equal(sent.rate, 44100); assert.equal(sent.discontinuity, true);
  f.workers[0].emit({ type: 'resync', gapMs: 200, rate: 44100 });
  assert.equal(f.states.at(-1), null); assert.match(f.statuses.at(-1), /自動再同期/);
  assert.ok(!f.client.stopped && !f.workers[0].terminated); f.client.stop();
});
test('model readiness verifies all four persisted files and reports saved or unavailable storage', async () => {
  for (const saved of [true, false]) {
    const f = clientFixture(true, { caches: { async open(name) { assert.match(name, /beat-this-small0-ort-1.23.2-cpu-v2$/); return { async match() { return saved ? { status: 200 } : undefined; } }; } } });
    await f.client.start(f.context, f.source); await new Promise(resolve => setImmediate(resolve));
    assert.match(f.storage.at(-1), saved ? /保存済み/ : /保存未完了/); f.client.stop();
  }
});
test('stop while waiting for the first service-worker controller prevents a late model download', async () => {
  const events = {};
  const serviceWorker = { controller: null, ready: new Promise(() => {}),
    addEventListener: (type, fn) => events[type] = fn, removeEventListener: type => delete events[type] };
  const f = clientFixture(true, { navigator: { serviceWorker } });
  const pending = f.client.start(f.context, f.source); f.client.stop(); await pending;
  assert.equal(f.workers.length, 0); assert.equal(events.controllerchange, undefined);
});
test('an app update waits for its cache-capable controller before downloading the model', async () => {
  const events = {}, old = {}, fresh = {};
  const serviceWorker = { controller: old, ready: Promise.resolve(),
    async register() { return { installing: fresh }; },
    addEventListener: (type, fn) => events[type] = fn, removeEventListener: type => delete events[type] };
  const f = clientFixture(true, { navigator: { serviceWorker } });
  const pending = f.client.start(f.context, f.source); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.workers.length, 0);
  serviceWorker.controller = fresh; events.controllerchange(); await pending;
  assert.equal(f.workers.length, 1); f.client.stop();
});
test('offline cached startup does not wait on an unreachable service-worker registration', async () => {
  const serviceWorker = { controller: {}, register() { assert.fail('offline startup must not register'); } };
  const f = clientFixture(true, { navigator: { onLine: false, serviceWorker } });
  await f.client.start(f.context, f.source); assert.equal(f.workers.length, 1); f.client.stop();
});
test('stop cancels even an unresolved online service-worker registration before any worker starts', async () => {
  const serviceWorker = { controller: {}, register: () => new Promise(() => {}) };
  const f = clientFixture(true, { navigator: { serviceWorker } });
  const pending = f.client.start(f.context, f.source); f.client.stop(); await pending;
  assert.equal(f.workers.length, 0);
});
test('attack correction uses source timestamps and rejects stale delivery backlogs', async () => {
  const f = clientFixture(); await f.client.start(f.context, f.source);
  f.context.currentTime = 20;
  f.capture({ pcm: new Float32Array(2048), audioTime: 19.9, attacks: [18, 19.6, 19.95, 21, NaN] });
  assert.deepEqual(f.attacks, [19.6, 19.95]);
  const deliver = f.nodes[0].port.onmessage;
  f.client.stop();
  deliver({ data: { pcm: new Float32Array(2048), attacks: [20] } });
  assert.deepEqual(f.attacks, [19.6, 19.95]);
});
