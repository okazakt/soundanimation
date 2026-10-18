const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const nodes = {}, workers = [], events = {}, dispatched = [];
  const node = id => nodes[id] ||= { hidden: false, textContent: '', attributes: {},
    setAttribute(k,v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; if (k === 'value') delete this.value; },
    focus() { this.focused = true; }, addEventListener(type, fn) { this[type] = fn; } };
  class Worker { constructor() { workers.push(this); } postMessage() {} terminate() { this.terminated = true; } emit(data) { this.onmessage?.({ data }); } }
  class Event { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  const window = { Worker, addEventListener: (name, fn) => events[name] = fn, dispatchEvent: e => dispatched.push(e) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../model-setup.js'), 'utf8'), { window, Worker, URL, Event, CustomEvent: Event,
    document: { baseURI: 'https://example.test/app/', querySelector: node } });
  return { nodes, workers, events, dispatched, state: window.ModelSetup };
}
test('page view blocks controls and shows byte percentage until preparation actually completes', () => {
  const f = fixture(); assert.equal(f.workers.length, 1);
  assert.ok(f.nodes['#app-shell'].hidden && f.nodes['#app-shell'].inert && f.nodes['#start'].disabled);
  f.workers[0].emit({ type: 'progress', phase: 'downloading', percent: 25, loaded: 25000000, total: 100000000, label: 'モデル' });
  assert.equal(f.nodes['#setup-percent'].textContent, '25.0%'); assert.equal(f.nodes['#setup-amount'].textContent, '25.0 / 100.0 MB');
  f.workers[0].emit({ type: 'progress', phase: 'saving', percent: 100, loaded: 100000000, total: 100000000 });
  assert.equal(f.state.complete, false); assert.equal(f.nodes['#start'].disabled, true);
  f.workers[0].emit({ type: 'ready' }); assert.equal(f.state.complete, true);
  assert.equal(f.nodes['#model-setup'].hidden, true); assert.equal(f.nodes['#app-shell'].hidden, false); assert.equal(f.nodes['#start'].disabled, false);
});
test('failure keeps operations blocked; retry ignores results from the previous worker', () => {
  const f = fixture(), old = f.workers[0]; old.emit({ type: 'error', message: '通信失敗' });
  assert.ok(f.nodes['#setup-retry'].focused); assert.equal(f.state.complete, false); assert.equal(f.nodes['#start'].disabled, true);
  f.nodes['#setup-retry'].click(); assert.equal(f.workers.length, 2);
  old.emit({ type: 'ready' }); assert.equal(f.state.complete, false);
  f.workers[1].emit({ type: 'ready' }); assert.equal(f.state.complete, true);
});
test('returning from the back-forward cache resumes an interrupted page setup', () => {
  const f = fixture(); f.events.pagehide(); assert.ok(f.workers[0].terminated);
  f.events.pageshow({ persisted: true }); assert.equal(f.workers.length, 2); assert.equal(f.state.complete, false);
});
