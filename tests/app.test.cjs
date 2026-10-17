const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function fixture(getMicrophone, options = {}) {
  let image, now = 0;
  const events = {}, nodes = {}, frames = new Map();
  let nextFrame = 0, stopped = 0, closed = 0, released = 0, requestCount = 0;
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
    putImageData(data) { image = data; }
  }, { get(target, key) { return target[key] || (() => gradient); } });
  const node = () => ({ disabled: false, textContent: '', classList: { add() {}, remove() {} },
    addEventListener(type, fn) { this[type] = fn; }, getContext: () => context,
    getBoundingClientRect: () => ({ width: options.width || 390, height: options.height || 740 }) });
  const stream = { getTracks: () => [{ stop() { stopped++; } }], getAudioTracks: () => [{ addEventListener() {} }] };
  const document = { hidden: false, querySelector: selector => nodes[selector] ||= node(), createElement: node,
    addEventListener(type, fn) { events[type] = fn; } };
  class Audio {
    constructor() { this.state = 'running'; this.sampleRate = 48000; }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { if (this.state !== 'closed') closed++; this.state = 'closed'; }
    createAnalyser() { return { frequencyBinCount: 2048, getByteFrequencyData(data) { if (options.spectrum) options.spectrum(data); else data.fill(100); } }; }
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
    image: () => image,
    async tick(dt = 1 / 60) { now += dt * 1000; const [id, fn] = frames.entries().next().value; frames.delete(id); fn(now); } };
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

const alphas = f => Array.from(f.image().data).filter((_, i) => i % 4 === 3);
test('all backing pixels including edges can glow; assignments stay fixed on resize', async () => {
  const f = fixture(async stream => stream, { width: 64, height: 48, spectrum: data => data.fill(255) });
  assert.ok(alphas(f).every(a => a === 0), 'no pre-existing idle stars');
  await f.nodes['#start'].click();
  for (let i = 0; i < 10; i++) await f.tick();
  assert.equal(f.image().width, 128); assert.equal(f.image().height, 96);
  assert.ok(alphas(f).every(a => a > 0), 'every pixel is an emission candidate');
  const before = Array.from(f.image().data);
  f.events.resize();
  assert.deepEqual(Array.from(f.image().data), before, 'resize does not randomize the field');
  f.nodes['#stop'].click();
  assert.ok(alphas(f).every(a => a === 0));
});
test('different frequencies illuminate different points throughout the field', async () => {
  async function render(bin) {
    const f = fixture(async stream => stream, { width: 64, height: 48,
      spectrum: data => { data.fill(0); data[bin] = 255; } });
    await f.nodes['#start'].click();
    for (let i = 0; i < 8; i++) await f.tick();
    const lit = alphas(f).map(a => a > 0);
    const { width, height } = f.image();
    for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
      assert.ok(lit.some((on, i) => on && Math.floor((i % width) / (width / 2)) === qx &&
        Math.floor(Math.floor(i / width) / (height / 2)) === qy));
    }
    f.nodes['#stop'].click(); return lit;
  }
  assert.notDeepEqual(await render(4), await render(900));
});
test('silence fades continuously for seconds and release is independent of frame rate', async () => {
  async function fade(fps) {
    let signal = 255;
    const f = fixture(async stream => stream, { width: 24, height: 16, spectrum: data => data.fill(signal) });
    await f.nodes['#start'].click();
    for (let i = 0; i < 30; i++) await f.tick();
    const peak = Math.max(...alphas(f)); signal = 0;
    let previous = peak;
    for (let i = 0; i < fps * 5; i++) {
      await f.tick(1 / fps);
      const current = Math.max(...alphas(f));
      assert.ok(current <= previous, 'no flickering or rebound during release');
      if (i === fps - 1) assert.ok(current > peak * .5, 'still glows after one second');
      previous = current;
    }
    assert.ok(previous > peak * .04 && previous < peak * .08, 'gentle five-second afterglow');
    f.nodes['#stop'].click(); return previous;
  }
  assert.ok(Math.abs(await fade(30) - await fade(120)) <= 1);
});
