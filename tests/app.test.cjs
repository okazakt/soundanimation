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
  vm.runInNewContext(code.replace('  resize();\n  if', '  window.inspect = () => ({ flocks, backgroundTone, backgroundEnergy, beatCooldown, mode, rhythm });\n  window.stepBeatExpression = (flock, dt) => updateBeatExpression(flock, dt);\n  window.stepRhythm = (values, dt) => { energies.set(values); updateRhythm(dt); };\n  resize();\n  if'), sandbox);
  return { nodes, events, document, frames, counts: () => ({ stopped, closed, released, requestCount }),
    image: () => image, inspect: () => window.inspect(), stepRhythm: (values, dt) => window.stepRhythm(values, dt),
    stepBeatExpression: (flock, dt) => window.stepBeatExpression(flock, dt),
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
  const caches = { keys: async () => ['sensor-cache', 'starlight-bell-soundanimation-v0', 'starlight-bell-soundanimation-v2026.10.18.1'],
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
    const voices = state.flocks.filter(g => g.presence > .5);
    assert.ok(voices.length >= 1 && voices.length <= 2);
    assert.equal(new Set(voices.map(g => g.region)).size, 1);
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
  assert.ok(f.inspect().flocks.every(g => g.pulse < .01));
  volume = 0;
  for (let i = 0; i < 360; i++) await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.presence < .001));
  assert.ok(f.inspect().backgroundEnergy < .001);
  f.nodes['#stop'].click();
});
test('flocks vary in scale, population and motion, with gathering and dispersing exits', async () => {
  let volume = 160;
  const f = fixture(async stream => stream, { spectrum: data => data.fill(volume) });
  await f.nodes['#start'].click();
  const positions = [];
  for (let i = 0; i < 180; i++) { await f.tick(); positions.push(f.inspect().flocks[0].x); }
  assert.ok(Math.max(...positions) - Math.min(...positions) > 100);
  const active = f.inspect().flocks;
  assert.ok(new Set(active.map(g => Math.floor(g.shape))).size >= 3, 'different motion families coexist');
  assert.ok(Math.max(...active.map(g => g.scale)) / Math.min(...active.map(g => g.scale)) > 1.3);
  assert.ok(active.some(g => g.particles.filter(p => p.alpha > .5).length > 64));
  assert.ok(new Set(active.filter(g => g.active).map(g => g.population)).size > 1);
  const sizes = active[0].particles.map(p => p.size);
  assert.ok(Math.max(...sizes) / Math.min(...sizes) > 4);
  const live = active.filter(g => g.active);
  const retiring = new Map(live.map(g => [g, g.particles.filter(p => p.alpha > .5)]));
  // Exercise all four disappearance styles on voices that are currently lit.
  live.forEach((g, i) => { g.exitStyle = i % 4; });
  assert.equal(new Set(live.map(g => g.exitStyle)).size, 4);
  volume = 0;
  for (let i = 0; i < 90; i++) await f.tick();
  assert.ok(live.every(g => g.exiting && g.collapse > .8 && g.presence > .8), 'exit choreography remains visible');
  for (let i = 0; i < 90; i++) await f.tick();
  assert.ok(live.every(g => g.presence < .02));
  for (const g of live) {
    if (g.exitStyle % 2 === 0) {
      assert.ok(retiring.get(g).every(p => Math.hypot(p.x - 195, p.y - 370) < 8), 'gathering exits reach the centre');
    } else {
      assert.ok(retiring.get(g).some(p => p.x < 0 || p.x > 390 || p.y < 0 || p.y > 740), 'dispersal exits travel offscreen');
    }
  }
  volume = 160;
  for (let i = 0; i < 60; i++) await f.tick();
  assert.ok(f.inspect().flocks.some(g => g.active && g.collapse < .01 && g.presence > .9));
  f.nodes['#stop'].click();
});

test('beat response stays immediate while speed and heading change with inertia', async () => {
  let volume = 0;
  const f = fixture(async stream => stream, { spectrum: data => data.fill(volume) });
  await f.nodes['#start'].click(); await f.tick();
  volume = 200;
  const before = f.inspect().flocks.map(g => ({ speed: g.phaseSpeed, heading: g.heading }));
  await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.pulse === 1), 'beat lights remain immediate');
  f.inspect().flocks.forEach((g, i) => {
    assert.ok(g.phaseSpeed - before[i].speed < .02, 'travel does not jump on the beat');
    assert.ok(Math.abs(g.heading - before[i].heading) <= 1.6 / 60 + 1e-9);
  });
  for (let i = 0; i < 150; i++) {
    const previous = f.inspect().flocks.map(g => ({ speed: g.phaseSpeed, heading: g.heading }));
    volume = i % 30 < 5 ? 200 : 0;
    await f.tick();
    f.inspect().flocks.forEach((g, j) => {
      assert.ok(Math.abs(g.heading - previous[j].heading) <= 1.6 / 60 + 1e-9);
      assert.ok(Math.abs(g.phaseSpeed - previous[j].speed) < .08);
      assert.ok(Number.isFinite(g.vx) && Number.isFinite(g.vy));
    });
  }
  f.nodes['#stop'].click();
});

test('independent phrase lifetimes vary flock counts, symmetry and colour without fixed pairing', async () => {
  const f = fixture(async stream => stream, { spectrum: data => data.fill(160) });
  await f.nodes['#start'].click();
  const counts = new Set(), shapes = new Set(), symmetry = new Set();
  for (let i = 0; i < 120; i++) {
    await f.tick(.1);
    const voices = f.inspect().flocks.filter(g => g.active);
    counts.add(voices.length);
    voices.forEach(g => { shapes.add(Math.floor(g.shape) % 5); symmetry.add(g.mirrorType); });
  }
  assert.ok(counts.size > 2, 'voice count changes during sustained music');
  assert.equal(shapes.size, 5);
  assert.ok(symmetry.has(0) && symmetry.size >= 3, 'solo and multiple symmetry modes coexist');
  const voices = f.inspect().flocks;
  assert.ok(new Set(voices.map(g => g.colorShift.toFixed(2))).size > 3);
  assert.ok(new Set(voices.map(g => g.speedScale.toFixed(2))).size > 3);
  f.nodes['#stop'].click();
});

test('each particle carries its velocity through disturbances with bounded acceleration', async () => {
  const f = fixture(async stream => stream, { spectrum: data => data.fill(160) });
  await f.nodes['#start'].click();
  for (let i = 0; i < 45; i++) await f.tick();
  const g = f.inspect().flocks.find(g => g.active && g.presence > .9);
  const p = g.particles[0];
  p.x += 40; p.vx = 80; p.vy = -35;
  const before = { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
  await f.tick();
  const maxDelta = 350 / 60;
  assert.ok(Math.hypot(p.vx - before.vx, p.vy - before.vy) <= maxDelta + 1e-6);
  assert.ok(Math.abs((p.x - before.x) - before.vx / 60) < .15, 'position is integrated from its own velocity');
  assert.ok(new Set(g.particles.slice(0, 40).map(p => Math.hypot(p.vx, p.vy).toFixed(1))).size > 20, 'individuals have distinct speeds');
  const neighbour = g.particles[1];
  const d0 = Math.hypot(p.x - neighbour.x, p.y - neighbour.y);
  for (let i = 0; i < 30; i++) await f.tick();
  assert.ok(Math.abs(Math.hypot(p.x - neighbour.x, p.y - neighbour.y) - d0) > 1, 'pair distances evolve rather than rotating rigidly');
  f.nodes['#stop'].click();
});

test('mode switch preserves the running microphone; stop resets flocks', async () => {
  const f = fixture(async stream => stream);
  await f.nodes['#start'].click(); await f.tick();
  f.nodes['#next-mode'].click(); await f.tick();
  assert.equal(f.inspect().mode, 'stars');
  assert.equal(f.nodes['#theme-title'].textContent, '星空');
  f.nodes['#previous-mode'].click();
  assert.equal(f.nodes['#theme-title'].textContent, '光の群れ'); await f.tick();
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

function rhythmFixture() {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const values = new Float64Array(512);
  return { f, step(dt, accent = false, silent = false, high = false) {
    values.fill(silent ? 0 : .012);
    if (accent) for (let i = high ? 330 : 0; i < (high ? 512 : 205); i++) values[i] = .65;
    f.stepRhythm(values, dt); return f.inspect().rhythm;
  } };
}
test('tempo recognition follows 90, 120 and 150 BPM across frame rates', () => {
  for (const fps of [30, 60, 120]) for (const bpm of [90, 120, 150]) {
    const { step } = rhythmFixture();
    let state;
    for (let i = 0; i < fps * 10; i++) {
      const phase = (i / fps) % (60 / bpm);
      state = step(1 / fps, phase < .06);
    }
    assert.ok(Math.abs(state.bpm - bpm) < 3, `${fps}fps ${bpm} BPM: ${state.bpm}`);
    assert.ok(state.confidence > .45, `${bpm} BPM confidence: ${state.confidence}`);
  }
});
test('clock bridges a missing kick, recognises treble rhythm, and releases in silence', () => {
  const { f, step } = rhythmFixture();
  for (let i = 0; i < 60 * 8; i++) step(1 / 60, (i % 30) < 3, false, true);
  assert.ok(Math.abs(f.inspect().rhythm.bpm - 120) < 3);
  let predicted = 0;
  for (let i = 0; i < 60; i++) { const r = step(1 / 60); if (r.beat) predicted++; assert.equal(r.onset, false); }
  assert.ok(predicted >= 1 && predicted <= 3);
  for (let i = 0; i < 180; i++) step(1 / 60, false, true);
  assert.ok(f.inspect().rhythm.confidence < .01);
  assert.ok(f.inspect().rhythm.pulse < .001);
});
test('sustained sound and irregular accents do not assert a confident tempo', () => {
  const { f, step } = rhythmFixture();
  for (let i = 0; i < 600; i++) step(1 / 60);
  assert.equal(f.inspect().rhythm.bpm, 0);
  assert.equal(f.inspect().rhythm.confidence, 0);
  const times = [.1, .41, 1.29, 1.51, 2.38, 2.75, 3.92, 4.19, 4.61, 5.47, 6.64, 7.01, 7.79, 8.1];
  for (let i = 0; i < 600; i++) step(1 / 60, times.some(t => i / 60 >= t && i / 60 < t + .04));
  assert.ok(f.inspect().rhythm.confidence < .3);
  f.nodes['#next-mode'].click();
  assert.equal(f.inspect().rhythm.confidence, 0);
});

test('recognised beats bend trajectories and change hue smoothly, fading with confidence', () => {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const { rhythm, flocks } = f.inspect();
  const g = flocks[0];
  rhythm.period = .5;
  const turns = [], hues = [];
  for (let i = 0; i < 480; i++) {
    const cycles = i / 30;
    rhythm.beatCount = Math.floor(cycles); rhythm.phase = cycles % 1; rhythm.confidence = 1;
    const before = g.beatTurn;
    f.stepBeatExpression(g, 1 / 60);
    turns.push(g.beatTurn); hues.push(g.beatHue);
    assert.ok(Math.abs(g.beatTurn - before) < .03, 'steering changes gradually');
  }
  assert.ok(Math.max(...turns) - Math.min(...turns) > .5);
  assert.ok(Math.max(...hues) - Math.min(...hues) > 40);
  rhythm.confidence = 0;
  for (let i = 0; i < 240; i++) f.stepBeatExpression(g, 1 / 60);
  assert.ok(Math.abs(g.beatTurn) < .001 && Math.abs(g.beatHue) < .001);
});
