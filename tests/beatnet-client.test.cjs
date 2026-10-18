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
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../beatnet-client.js'), 'utf8'), {
    window, Worker, AudioWorkletNode, document: { baseURI: 'https://example.test/soundanimation/' }, URL,
    setTimeout, clearTimeout, performance: { now: () => clock++ }
  });
  const client = new window.BeatNetClient(state => states.push(state), status => statuses.push(status));
  return { client, context, source, workers, nodes, states, statuses,
    capture() { nodes[0].port.onmessage({ data: { pcm: new Float32Array(2048), firstFrame: 0 } }); } };
}
test('stopping during model load cancels readiness and prevents late audio capture', async () => {
  const f = clientFixture(false), pending = f.client.start(f.context, f.source);
  f.client.stop(); await assert.rejects(pending, /BeatNet停止/);
  f.workers[0].emit({ type: 'ready' });
  assert.ok(f.workers[0].terminated); assert.equal(f.nodes.length, 0);
});
test('capture backlog is bounded, resynchronizes without old results, then stops after repeated overload', async () => {
  const f = clientFixture(); await f.client.start(f.context, f.source);
  const worker = f.workers[0];
  for (let reset = 0; reset < 3; reset++) {
    const epoch = f.client.epoch;
    for (let i = 0; i < 5; i++) f.capture();
    assert.equal(f.client.pending, 4);
    assert.equal(worker.messages.filter(m => m.type === 'pcm').length, (reset + 1) * 4);
    assert.equal(f.states[f.states.length - 1], null);
    for (let i = 0; i < 4; i++) worker.emit({ type: 'result', epoch, latest: { bpm: 200 }, frames: 2, processingMs: 80 });
    if (reset < 2) {
      assert.equal(f.client.epoch, epoch + 1);
      const before = f.states.length;
      worker.emit({ type: 'result', epoch, latest: { bpm: 200 } });
      assert.equal(f.states.length, before, 'old worker epoch cannot restore old estimates');
    }
  }
  assert.ok(f.client.stopped && worker.terminated && f.nodes[0].disconnected);
  assert.equal(f.source.connections.size, 0);
  assert.match(f.statuses[f.statuses.length - 1], /処理が追いつきません.*従来方式/);
});
test('stopping during AudioWorklet registration cannot reconnect after the promise resolves', async () => {
  const f = clientFixture(); let resolve;
  f.context.audioWorklet.addModule = () => new Promise(done => { resolve = done; });
  const pending = f.client.start(f.context, f.source);
  await new Promise(done => setImmediate(done));
  f.client.stop(); resolve(); await pending;
  assert.equal(f.nodes.length, 0); assert.equal(f.source.connections.size, 0);
  assert.ok(f.workers[0].terminated);
});
