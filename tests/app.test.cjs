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
    setAttribute() {}, addEventListener(type, fn) { this[type] = fn; }, getContext: () => context,
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
  vm.runInNewContext(code.replace('  resize();\n  if', '  window.inspect = () => ({ flocks, backgroundTone, backgroundEnergy, beatCooldown, mode });\n  resize();\n  if'), sandbox);
  return { nodes, events, document, frames, counts: () => ({ stopped, closed, released, requestCount }),
    image: () => image, inspect: () => window.inspect(),
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
  const caches = { keys: async () => ['sensor-cache', 'starlight-bell-soundanimation-v0', 'starlight-bell-soundanimation-v2026.10.17.12'],
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
test('manifest paths and icon dimensions stay within app; no audio recording APIs', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(manifest.scope, './'); assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) {
    const data = fs.readFileSync(path.join(root, icon.src));
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(data.readUInt32BE(16), size); assert.equal(data.readUInt32BE(20), size);
  }
  assert.doesNotMatch(code, /MediaRecorder|indexedDB/);
  // The time correction preserves the 60fps filters at 30fps and 120fps.
  for (const decay of [.999, .992, .88, .65, .94, .85]) {
    for (const fps of [30, 60, 120]) assert.ok(Math.abs(Math.pow(Math.pow(decay, 60 / fps), fps) - Math.pow(decay, 60)) < 1e-12);
  }
});

test('frequency regions select independent flocks, coloured particles and background', async () => {
  async function render(bin) {
    const f = fixture(async stream => stream, { spectrum: data => { data.fill(0); data[bin] = 255; } });
    await f.nodes['#start'].click();
    for (let i = 0; i < 90; i++) await f.tick();
    const state = f.inspect();
    assert.equal(state.flocks.filter(g => g.presence > .5).length, 1);
    const active = state.flocks.find(g => g.presence > .5);
    assert.ok(active.particles.some(p => p.alpha > .5));
    for (const g of state.flocks) for (const p of g.particles) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.ok(p.x >= 0 && p.x <= 390 && p.y >= 0 && p.y <= 740);
    }
    f.nodes['#stop'].click(); return { id: active.id, tone: state.backgroundTone };
  }
  const bass = await render(4), treble = await render(900);
  assert.notEqual(bass.id, treble.id);
  assert.ok(treble.tone > bass.tone);
});
test('bass onset pulses every flock once, sustained sound does not retrigger, silence fades', async () => {
  let volume = 0;
  const f = fixture(async stream => stream, { spectrum: data => data.fill(volume) });
  await f.nodes['#start'].click(); await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.presence === 0));
  volume = 180; await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.pulse === 1));
  for (let i = 0; i < 90; i++) await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.pulse < .01 && g.presence > .5));
  volume = 0;
  for (let i = 0; i < 360; i++) await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.presence < .001));
  assert.ok(f.inspect().backgroundEnergy < .001);
  f.nodes['#stop'].click();
});
test('flocks vary in scale and ball size, travel widely, then converge visibly before fading', async () => {
  let volume = 160;
  const f = fixture(async stream => stream, { spectrum: data => data.fill(volume) });
  await f.nodes['#start'].click();
  const positions = [];
  for (let i = 0; i < 180; i++) { await f.tick(); positions.push(f.inspect().flocks[0].x); }
  assert.ok(Math.max(...positions) - Math.min(...positions) > 100);
  const active = f.inspect().flocks;
  assert.ok(Math.max(...active.map(g => g.scale)) / Math.min(...active.map(g => g.scale)) > 1.3);
  assert.ok(active.every(g => g.particles.filter(p => p.alpha > .5).length > 64));
  const sizes = active[0].particles.map(p => p.size);
  assert.ok(Math.max(...sizes) / Math.min(...sizes) > 4);
  volume = 0;
  for (let i = 0; i < 90; i++) await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.collapse > .8 && g.presence > .8), 'contraction is visible before fade');
  for (let i = 0; i < 90; i++) await f.tick();
  assert.ok(f.inspect().flocks.every(g => Math.hypot(g.x - 195, g.y - 370) < 3 && g.presence < .01));
  volume = 160;
  for (let i = 0; i < 60; i++) await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.collapse < .01 && g.presence > .9));
  f.nodes['#stop'].click();
});

test('mode switch preserves the running microphone; stop resets flocks', async () => {
  const f = fixture(async stream => stream);
  await f.nodes['#start'].click(); await f.tick();
  f.nodes['#animation'].value = 'stars'; f.nodes['#animation'].change(); await f.tick();
  assert.equal(f.inspect().mode, 'stars');
  f.nodes['#animation'].value = 'flocks'; f.nodes['#animation'].change(); await f.tick();
  assert.equal(f.frames.size, 1); assert.equal(f.counts().requestCount, 1);
  f.nodes['#stop'].click();
  assert.ok(f.inspect().flocks.every(g => g.presence === 0 && g.pulse === 0));
});

test('visible version identifies the running script and matches cached asset URLs', () => {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const version = f.nodes['#version'].textContent;
  assert.match(version, /^v\d{4}\.\d{2}\.\d{2}\.\d+$/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(html.includes('id="version"'));
  for (const asset of ['app.js', 'style.css']) {
    assert.ok(html.includes(`./${asset}?v=${version.slice(1)}`));
    assert.ok(sw.includes(`./${asset}?v=${version.slice(1)}`));
  }
  assert.ok(sw.includes(`PREFIX + '${version}'`));
});
