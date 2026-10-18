const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function clientFixture(autoReady = true) {
  const workers = [], nodes = [], states = [], statuses = [];
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
    createGain: () => ({ gain: {}, connect() {}, disconnect() {} }), destination: {} };
  const source = { connections: new Set(), connect(node) { this.connections.add(node); }, disconnect(node) { this.connections.delete(node); } };
  const window = { Worker, AudioWorkletNode };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../beat-this-client.js'), 'utf8'), {
    window, Worker, AudioWorkletNode, document: { baseURI: 'https://example.test/soundanimation/' }, URL,
    setTimeout, clearTimeout, performance: { now: () => clock++ }
  });
  const client = new window.BeatThisClient(state => states.push(state), status => statuses.push(status));
  return { client, context, source, workers, nodes, states, statuses,
    capture() { nodes[0].port.onmessage({ data: { pcm: new Float32Array(2048), firstFrame: 0 } }); } };
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
  assert.match(f.statuses.at(-1), /追いつきません.*従来方式/);
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
