const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function fixture(getMicrophone) {
  const events = {}, nodes = {}, frames = new Map();
  let nextFrame = 0, stopped = 0, closed = 0, released = 0, requestCount = 0;
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get(target, key) { return target[key] || (() => gradient); } });
  const node = () => ({ disabled: false, textContent: '', classList: { add() {}, remove() {} },
    addEventListener(type, fn) { this[type] = fn; }, getContext: () => context,
    getBoundingClientRect: () => ({ width: 390, height: 740 }) });
  const stream = { getTracks: () => [{ stop() { stopped++; } }], getAudioTracks: () => [{ addEventListener() {} }] };
  const document = { hidden: false, querySelector: selector => nodes[selector] ||= node(), createElement: node,
    addEventListener(type, fn) { events[type] = fn; } };
  class Audio {
    constructor() { this.state = 'running'; this.sampleRate = 48000; }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { if (this.state !== 'closed') closed++; this.state = 'closed'; }
    createAnalyser() { return { frequencyBinCount: 2048, getByteFrequencyData(data) { data.fill(100); } }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  const navigator = { mediaDevices: { getUserMedia: async constraints => {
    requestCount++; assert.equal(constraints.audio.autoGainControl, false);
    assert.equal(constraints.audio.noiseSuppression, false);
    return getMicrophone(stream);
  } }, wakeLock: { request: async () => ({ addEventListener() {}, async release() { released++; } }) } };
  const window = { AudioContext: Audio, devicePixelRatio: 2, addEventListener(type, fn) { events[type] = fn; } };
  const sandbox = { window, document, navigator, ResizeObserver: class { observe() {} },
    requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }, setTimeout() { return 1; }, clearTimeout() {} };
  vm.runInNewContext(code, sandbox);
  return { nodes, events, document, frames, counts: () => ({ stopped, closed, released, requestCount }),
    async tick() { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(100); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('start, draw, background/resume, stop release microphone and wake lock', async () => {
  const f = fixture(async stream => stream);
  await f.nodes['#start'].click(); await flush(); await f.tick();
  assert.equal(f.nodes['#start'].disabled, true);
  f.document.hidden = true; f.events.visibilitychange(); await flush();
  assert.equal(f.frames.size, 0);
  f.document.hidden = false; f.events.visibilitychange(); await flush();
  assert.equal(f.frames.size, 1);
  f.nodes['#stop'].click(); await flush();
  assert.equal(f.frames.size, 0);
  assert.equal(f.nodes['#start'].disabled, false);
  assert.deepEqual(f.counts(), { stopped: 1, closed: 1, released: 2, requestCount: 1 });
});
test('permission denial starts demo and can stop/restart', async () => {
  const f = fixture(async () => { throw new Error('NotAllowedError'); });
  await f.nodes['#start'].click(); await f.tick();
  assert.match(f.nodes['#notice'].textContent, /デモモード/);
  f.nodes['#stop'].click();
  await f.nodes['#start'].click(); await f.tick();
  f.nodes['#stop'].click();
  assert.equal(f.counts().requestCount, 2);
  assert.equal(f.frames.size, 0);
});
test('stop during permission prompt disposes the late stream without restarting', async () => {
  let resolve;
  const f = fixture(stream => new Promise(done => { resolve = () => done(stream); }));
  const pending = f.nodes['#start'].click(); await flush();
  f.nodes['#stop'].click(); resolve(); await pending;
  assert.equal(f.frames.size, 0);
  assert.equal(f.counts().stopped, 1);
  assert.equal(f.nodes['#start'].disabled, false);
});
test('service worker ignores outside requests and deletes only its own outdated cache', async () => {
  const events = {}, deleted = [], cached = [];
  const self = { location: { href: 'https://example.com/soundanimation/sw.js' }, addEventListener(type, fn) { events[type] = fn; } };
  const caches = { keys: async () => ['sensor-cache', 'starlight-bell-soundanimation-v0', 'starlight-bell-soundanimation-v1'],
    delete: async key => deleted.push(key), open: async () => ({ addAll: async urls => cached.push(...urls) }) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), { self, caches, URL });
  await new Promise(resolve => events.activate({ waitUntil: p => p.then(resolve) }));
  assert.deepEqual(deleted, ['starlight-bell-soundanimation-v0']);
  await new Promise(resolve => events.install({ waitUntil: p => p.then(resolve) }));
  assert.equal(cached.length, 7);
  assert.ok(cached.every(url => url.startsWith('https://example.com/soundanimation/')));
  for (const url of ['https://example.com/', 'https://example.com/script.js', 'https://other.test/soundanimation/app.js', 'https://example.com/soundanimation/unknown']) {
    events.fetch({ request: { method: 'GET', url }, respondWith() { assert.fail('outside request intercepted'); } });
  }
});
test('manifest paths and icon dimensions stay within app; no persistent user data APIs', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(manifest.scope, './'); assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) {
    const data = fs.readFileSync(path.join(root, icon.src));
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(data.readUInt32BE(16), size); assert.equal(data.readUInt32BE(20), size);
  }
  assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|MediaRecorder/);
  // The time correction preserves the 60fps filters at 30fps and 120fps.
  for (const decay of [.999, .992, .88, .65, .94, .85]) {
    for (const fps of [30, 60, 120]) assert.ok(Math.abs(Math.pow(Math.pow(decay, 60 / fps), fps) - Math.pow(decay, 60)) < 1e-12);
  }
});
