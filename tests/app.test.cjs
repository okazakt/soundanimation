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
    putImageData(data) { image = data; },
    quadraticCurveTo(...args) { options.curves?.push(args); }
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
    return getMicrophone(stream, constraints);
  }, enumerateDevices: options.enumerateDevices }, wakeLock: { request: async () => ({ addEventListener() {}, async release() { released++; } }) } };
  const window = { AudioContext: Audio, devicePixelRatio: 2, addEventListener(type, fn) { events[type] = fn; } };
  const sandbox = { window, document, navigator, ResizeObserver: class { observe() {} },
    requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }, setTimeout() { return 1; }, clearTimeout() {} };
  vm.runInNewContext(code.replace('  resize();\n  if', '  window.inspect = () => ({ flocks, backgroundTone, backgroundEnergy, beatCooldown, mode, rhythm, mood, focus, soundProfile });\n  window.splitParticle = (f, p) => splitParticle(f, p);\n  window.mergeParticles = (p, q) => mergeParticles(p, q);\n  window.stepSoundProfile = (values, dt) => { rawEnergies.set(values); updateSoundProfile(dt); };\n  window.particleSpeedLimit = () => particleSpeedLimit();\n  window.stepFocus = (dt, audible) => { elapsed += dt; updateFocus(dt, audible); };\n  window.stepColourBreath = (dt, audible) => { mood.time += dt; updateColourBreath(dt, audible); };\n  window.stepMood = (values, dt) => { rawEnergies.set(values); updateMood(dt); };\n  window.particleColour = (p, f) => particleColour(p, f);\n  window.chooseFlockGate = (f, wanted, audible, safety, now) => chooseFlockGate(f, wanted, audible, safety, now);\n  window.stepScene = (values, raw, dt) => { energies.set(values); rawEnergies.set(raw); elapsed += dt; updateRhythm(dt); updateFlocks(dt); };\n  window.recordParticleTail = (p, time) => recordParticleTail(p, time);\n  window.drawParticleTail = (p, now) => drawParticleTail(p, p.x, p.y, 1, 1, 120, 1, 4, now);\n  window.finishTransfers = moves => finishTransfers(moves);\n  window.stepBeatExpression = (flock, dt) => updateBeatExpression(flock, dt);\n  window.stepRhythm = (values, dt) => { energies.set(values); updateRhythm(dt); };\n  resize();\n  if'), sandbox);
  return { nodes, events, document, frames, counts: () => ({ stopped, closed, released, requestCount }),
    image: () => image, inspect: () => window.inspect(), stepRhythm: (values, dt) => window.stepRhythm(values, dt),
    stepBeatExpression: (flock, dt) => window.stepBeatExpression(flock, dt),
    finishTransfers: moves => window.finishTransfers(moves),
    split: (g, p) => window.splitParticle(g, p), merge: (p, q) => window.mergeParticles(p, q),
    stepSoundProfile: (values, dt) => window.stepSoundProfile(values, dt),
    speedLimit: () => window.particleSpeedLimit(), stepFocus: (dt, audible = true) => window.stepFocus(dt, audible),
    stepColourBreath: (dt, audible = true) => window.stepColourBreath(dt, audible),
    stepMood: (values, dt) => window.stepMood(values, dt), colour: (p, g) => window.particleColour(p, g),
    chooseGate: (...args) => window.chooseFlockGate(...args),
    stepScene: (values, raw, dt) => window.stepScene(values, raw, dt),
    recordTail: (p, time) => window.recordParticleTail(p, time), drawTail: (p, time) => window.drawParticleTail(p, time),
    async tick(dt = 1 / 60) { now += dt * 1000; const [id, fn] = frames.entries().next().value; frames.delete(id); fn(now); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('built-in microphone uses exact device ID and releases permission stream', async () => {
  const requests = [];
  const f = fixture(async (stream, constraints) => {
    requests.push(constraints);
    return stream;
  }, { enumerateDevices: async () => [
    { kind: 'audioinput', deviceId: 'car', label: 'Bluetooth' },
    { kind: 'audioinput', deviceId: 'phone', label: 'iPhone Microphone' }
  ] });
  f.nodes['#builtin-microphone'].checked = true;
  await f.nodes['#start'].click();
  assert.equal(requests[1].audio.deviceId.exact, 'phone');
  assert.match(f.nodes['#microphone-status'].textContent, /本体マイク指定：iPhone/);
  assert.equal(f.counts().stopped, 1);
  f.nodes['#stop'].click();
  assert.equal(f.counts().stopped, 2);
  assert.equal(f.nodes['#builtin-microphone'].disabled, false);
});
test('missing built-in microphone stops without Bluetooth fallback or demo', async () => {
  const f = fixture(async stream => stream, { enumerateDevices: async () => [
    { kind: 'audioinput', deviceId: 'car', label: 'Bluetooth' }
  ] });
  f.nodes['#builtin-microphone'].checked = true;
  await f.nodes['#start'].click();
  assert.equal(f.counts().requestCount, 1);
  assert.equal(f.counts().stopped, 1);
  assert.equal(f.frames.size, 0);
  assert.match(f.nodes['#microphone-status'].textContent, /指定できません/);
  assert.equal(f.nodes['#start'].disabled, false);
});
test('stop during device enumeration prevents another microphone request', async () => {
  let resolveDevices;
  const f = fixture(async stream => stream, { enumerateDevices: () => new Promise(resolve => { resolveDevices = resolve; }) });
  f.nodes['#builtin-microphone'].checked = true;
  const pending = f.nodes['#start'].click(); await flush();
  f.nodes['#stop'].click();
  resolveDevices([{ kind: 'audioinput', deviceId: 'phone', label: 'iPhone Microphone' }]);
  await pending;
  assert.equal(f.counts().requestCount, 1);
  assert.equal(f.counts().stopped, 1);
  assert.equal(f.frames.size, 0);
});
test('rejected exact selection or mismatched input stops without fallback', async () => {
  for (const mismatch of [false, true]) {
    const f = fixture(async (stream, constraints) => {
      if (!constraints.audio.deviceId) return stream;
      if (!mismatch) throw new Error('OverconstrainedError');
      return { ...stream, getAudioTracks: () => [{ getSettings: () => ({ deviceId: 'car' }) }] };
    }, { enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'phone', label: 'iPhone Microphone' }] });
    f.nodes['#builtin-microphone'].checked = true;
    await f.nodes['#start'].click();
    assert.equal(f.counts().requestCount, 2);
    assert.equal(f.counts().stopped, mismatch ? 2 : 1);
    assert.equal(f.frames.size, 0);
    assert.match(f.nodes['#microphone-status'].textContent, /指定できません/);
  }
});
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
  const caches = { keys: async () => ['sensor-cache', 'starlight-bell-soundanimation-v0', 'starlight-bell-soundanimation-v2026.10.18.10'],
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
    }
    assert.ok(voices.some(g => g.particles.some(p => p.alpha > .035 && p.x >= 0 && p.x <= 390 && p.y >= 0 && p.y <= 740)), 'audible bands retain visible particles while some may leave the screen');
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
  for (let i = 0; i < 180; i++) { await f.tick(); positions.push({ x: f.inspect().flocks[0].x, y: f.inspect().flocks[0].y }); }
  const distance = positions.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - positions[i - 1].x, p.y - positions[i - 1].y) : 0, 0);
  assert.ok(distance > 15 && distance <= f.speedLimit() * .68 * 3 + 1, 'leaders travel within the tempo ceiling');
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
      assert.ok(retiring.get(g).every(p => Math.hypot(p.x - f.inspect().focus.x, p.y - f.inspect().focus.y) < 16), 'gathering exits reach the centre');
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
  return { f, step(dt, accent = false, silent = false, high = false, strength = .65) {
    values.fill(silent ? 0 : .012);
    if (accent) for (let i = high ? 330 : 0; i < (high ? 512 : 205); i++) values[i] = strength;
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

test('sizes include fine dust and rare large individuals; migration preserves the same particle', () => {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const groups = f.inspect().flocks, all = groups.flatMap(g => g.particles);
  const sizes = all.map(p => p.size);
  assert.ok(Math.min(...sizes) < .25 && Math.max(...sizes) > 9);
  assert.ok(sizes.filter(s => s < .8).length > all.length * .25);
  assert.ok(sizes.filter(s => s >= 7).length > 0 && sizes.filter(s => s >= 7).length < all.length * .04);
  const owner = groups[0], host = groups[1];
  owner.active = host.active = true; host.population = 64;
  const particle = owner.particles[0];
  Object.assign(particle, { x: 2, y: 3, vx: 13, vy: -7, travelState: 2, travelTarget: host.id, size: .3, baseTone: .1 });
  const before = { x: particle.x, y: particle.y, vx: particle.vx, vy: particle.vy, size: particle.size, baseTone: particle.baseTone };
  f.finishTransfers([{ owner, particle, host }]);
  assert.ok(host.particles.includes(particle) && !owner.particles.includes(particle));
  for (const [key, value] of Object.entries(before)) assert.equal(particle[key], value);
  assert.equal(particle.travelState, 0);
  assert.ok(particle.guestUntil > 0);
  assert.ok(particle.band >= 103 && particle.band < 205);
  const after = groups.flatMap(g => g.particles);
  assert.equal(after.length, all.length); assert.equal(new Set(after).size, all.length);
  assert.ok(groups.every(g => g.particles.length === 128));
  // A full destination cannot accept another individual or lose the source.
  host.population = 128;
  const waiting = owner.particles[1]; waiting.travelState = 2;
  f.finishTransfers([{ owner, particle: waiting, host }]);
  assert.ok(owner.particles.includes(waiting));
  f.nodes['#next-mode'].click();
  assert.ok(f.inspect().flocks.every(g => g.particles.every(p => p.travelState === 0 && p.guestUntil === 0)));
});

test('human timing jitter and gradual tempo drift are absorbed without losing the beat', () => {
  const { f, step } = rhythmFixture();
  const beats = Array.from({ length: 32 }, (_, i) => .15 + i * .5 + Math.sin(i * 1.71) * .028);
  for (let i = 0; i < 60 * 16; i++) step(1 / 60, beats.some(t => i / 60 >= t && i / 60 < t + .04));
  assert.ok(Math.abs(f.inspect().rhythm.bpm - 120) < 5, `jitter BPM ${f.inspect().rhythm.bpm}`);
  assert.ok(f.inspect().rhythm.confidence > .4, `jitter confidence ${f.inspect().rhythm.confidence}`);
  const second = rhythmFixture();
  let time = .15;
  const ramp = [];
  for (let i = 0; i < 42; i++) { ramp.push(time + Math.sin(i * 1.3) * .012); time += 60 / (100 + Math.min(40, i * 1.3)); }
  let early;
  for (let i = 0; i < Math.floor(time * 60); i++) {
    second.step(1 / 60, ramp.some(t => i / 60 >= t && i / 60 < t + .04));
    if (i === 60 * 5) early = second.f.inspect().rhythm.bpm;
  }
  const final = second.f.inspect().rhythm;
  assert.ok(final.bpm > 127 && final.bpm < 147, `drift BPM ${final.bpm}, early ${early}`);
  assert.ok(final.bpm > early + 15);
  assert.ok(final.confidence > .3);
});
test('overall motion scale follows slow and fast tempi with gradual changes', () => {
  for (const bpm of [90, 150]) {
    const { f, step } = rhythmFixture();
    let previous = 1;
    for (let i = 0; i < 60 * 10; i++) {
      const r = step(1 / 60, (i / 60) % (60 / bpm) < .06);
      assert.ok(Math.abs(r.motionScale - previous) < .015); previous = r.motionScale;
    }
    const scale = f.inspect().rhythm.motionScale;
    assert.ok(bpm === 90 ? scale < .8 : scale > 1.15, `${bpm} BPM scale ${scale}`);
  }
});
test('soft wakes use bounded real position history and curved strokes, expiring after gaps', () => {
  const curves = [];
  const f = fixture(async stream => stream, { width: 8, height: 8, curves });
  const p = f.inspect().flocks[0].particles[0]; p.size = 2;
  for (let i = 0; i <= 60; i++) {
    p.x = i * .7; p.y = Math.sin(i * .1) * 4; f.recordTail(p, i / 60);
  }
  assert.equal(p.tailCount, 12); assert.equal(p.tail.length, 36);
  const snapshot = Array.from(p.tail);
  f.drawTail(p, 1);
  assert.ok(curves.length > 0 && curves.every(values => values.every(Number.isFinite)));
  assert.deepEqual(Array.from(p.tail), snapshot, 'rendering does not move stored points');
  curves.length = 0; f.drawTail(p, 2);
  assert.equal(curves.length, 0, 'no stale trail bridges a pause');
});

test('repeated accent patterns estimate three or four beats and the downbeat, without forcing equal accents', () => {
  for (const meter of [3, 4]) {
    const { f, step } = rhythmFixture();
    const aligned = [];
    for (let i = 0; i < 60 * 24; i++) {
      const strong = Math.floor(i / 30) % meter === 0;
      const r = step(1 / 60, i % 30 < 3, false, false, strong ? .9 : .28);
      if (strong && i % 30 === 5 && r.meterConfidence > .5) aligned.push(r.beatInBar);
    }
    const r = f.inspect().rhythm;
    assert.equal(r.meter, meter);
    assert.ok(r.meterConfidence > .5, `${meter} meter confidence ${r.meterConfidence}`);
    assert.ok(aligned.length >= 2 && aligned.every(beat => beat === 1), `downbeat ${aligned}`);
  }
  const { f, step } = rhythmFixture();
  for (let i = 0; i < 60 * 20; i++) step(1 / 60, i % 30 < 3);
  assert.ok(f.inspect().rhythm.meterConfidence < .2);
});
test('optional lifetimes wait for a fourth beat or downbeat, with silence and blank-screen overrides', () => {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const { rhythm: r, flocks } = f.inspect(), g = flocks[0];
  Object.assign(r, { confidence: 1, meter: 4, meterConfidence: .9, beat: false, beatInBar: 2 });
  assert.equal(f.chooseGate(g, true, true, false, 1), false);
  r.beat = true; r.beatInBar = 3;
  assert.equal(f.chooseGate(g, true, true, false, 1.5), false);
  r.beatInBar = 4;
  assert.equal(f.chooseGate(g, true, true, false, 2), true);
  r.beatInBar = 1;
  assert.equal(f.chooseGate(g, false, true, false, 2.5), true, 'minimum lifetime prevents busy flashing');
  r.beat = false;
  assert.equal(f.chooseGate(g, false, true, false, 6), true);
  r.beat = true; r.beatInBar = 1;
  assert.equal(f.chooseGate(g, false, true, false, 6.5), false);
  assert.equal(f.chooseGate(g, false, true, true, 6.6), true, 'safety restores visible music immediately');
  assert.equal(f.chooseGate(g, true, false, false, 6.7), false, 'real silence bypasses beat waiting');
});
test('sustained audible input stays visible after adaptation and during scheduled gaps, but silence clears', () => {
  const f = fixture(async stream => stream, { width: 140, height: 220 });
  const values = new Float64Array(512), raw = new Float64Array(512);
  raw.fill(.25, 0, 103); // A sustained bass note completely removed by adaptation.
  let blank = 0, longest = 0;
  for (let i = 0; i < 180; i++) {
    if (i === 90) for (const g of f.inspect().flocks) for (const p of g.particles) { p.x = -1000; p.alpha = .5; }
    f.stepScene(values, raw, .1);
    const visible = f.inspect().flocks.some(g => g.particles.some(p => p.alpha > .035 && p.x >= 0 && p.x <= 140 && p.y >= 0 && p.y <= 220));
    blank = visible ? 0 : blank + .1; longest = Math.max(longest, blank);
  }
  assert.ok(longest <= .5, `longest blank ${longest}`);
  raw.fill(0);
  for (let i = 0; i < 50; i++) f.stepScene(values, raw, .1);
  assert.ok(f.inspect().flocks.every(g => g.presence < .001));
});

test('mood continuously biases the full hue circle, with rare independent exceptions', () => {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const { mood, flocks } = f.inspect(); mood.confidence = 1;
  const all = flocks.flatMap(g => g.particles.map(p => ({ p, g })));
  const rebels = all.filter(({ p }) => p.colorRebel);
  assert.ok(rebels.length > 0 && rebels.length < all.length * .035);
  const normal = all.filter(({ p }) => !p.colorRebel);
  for (const warmth of [-1, -.6, -.2, 0, .2, .6, 1]) {
    mood.warmth = warmth;
    const colours = normal.map(({ p, g }) => f.colour(p, g));
    assert.equal(new Set(colours.map(c => Math.floor(c.hue / 30))).size, 12, 'every hue sector survives every mood');
    assert.ok(new Set(colours.map(c => Math.round(c.hue))).size > 250);
    assert.ok(colours.every(c => Number.isFinite(c.hue) && c.saturation >= 45 && c.lightness >= 48));
  }
  const centre = 125 - 115 + mood.activity * 35 + mood.tension * 65 + mood.keyBias * 25;
  const near = () => normal.filter(({ p, g }) => Math.abs(((f.colour(p, g).hue - centre + 540) % 360) - 180) < 60).length;
  mood.warmth = 0; const unbiased = near();
  mood.warmth = 1; assert.ok(near() > unbiased + normal.length * .1, 'mood changes preference, not availability');
  const { p, g } = normal[10];
  let previous;
  for (let warmth = -1; warmth <= 1; warmth += .01) {
    mood.warmth = warmth; const hue = f.colour(p, g).hue;
    if (previous !== undefined) assert.ok(Math.abs(((hue - previous + 540) % 360) - 180) < 4, 'no categorical colour switch');
    previous = hue;
  }
  for (const { p, g } of rebels) {
    const exception = f.colour(p, g).hue; p.colorRebel = false;
    const ordinary = f.colour(p, g).hue; p.colorRebel = true;
    assert.ok(Math.abs(((exception - ordinary + 540) % 360) - 180) > 90);
  }
});
test('audio mood responds slowly to contrasting timbres and returns cleanly on restart', () => {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const low = new Float64Array(512), high = new Float64Array(512);
  low.fill(.22, 10, 100); high.fill(.22, 390, 500);
  for (let i = 0; i < 200; i++) f.stepMood(low, .1);
  const dark = f.inspect().mood.warmth;
  assert.ok(dark < -.2);
  let previous = dark;
  for (let i = 0; i < 200; i++) {
    f.stepMood(high, .1);
    assert.ok(Math.abs(f.inspect().mood.warmth - previous) < .03);
    previous = f.inspect().mood.warmth;
  }
  assert.ok(f.inspect().mood.warmth > .3);
  f.nodes['#next-mode'].click();
  assert.equal(f.inspect().mood.warmth, 0); assert.equal(f.inspect().mood.confidence, 0);
});

test('tonal evidence distinguishes major-like and minor-like chord spectra as a weak cue', () => {
  function estimate(notes) {
    const f = fixture(async stream => stream, { width: 8, height: 8 });
    const values = new Float64Array(512);
    for (let i = 0; i < 512; i++) {
      const hz = 40 * Math.pow(14000 / 40, (i + .5) / 512);
      for (const note of notes) for (let harmonic = 1; harmonic <= 3; harmonic++) {
        const target = 440 * Math.pow(2, (note - 69) / 12) * harmonic;
        values[i] += .55 / harmonic * Math.exp(-Math.pow(Math.log2(hz / target) * 90, 2));
      }
    }
    for (let i = 0; i < 100; i++) f.stepMood(values, .1);
    return f.inspect().mood.keyBias;
  }
  const major = estimate([60, 64, 67]), minor = estimate([60, 63, 67]);
  assert.ok(major > minor + .1, `major ${major}, minor ${minor}`);
});

test('persistent mood periodically opens to unbiased colour and returns smoothly without changing the estimate', () => {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const { mood, flocks } = f.inspect();
  Object.assign(mood, { warmth: -.9, confidence: 1 });
  let previous = 1, openSeconds = 0, returned = false;
  const gains = [];
  for (let i = 0; i < 450; i++) {
    f.stepColourBreath(.1);
    const gain = mood.colourBiasGain;
    assert.ok(Math.abs(gain - previous) < .1, 'no abrupt colour switch');
    if (gain === 0) openSeconds += .1;
    if (openSeconds > 1.5 && gain === 1) returned = true;
    gains.push(gain); previous = gain;
  }
  assert.ok(openSeconds > 3 && returned && mood.colourCycle >= 2);
  assert.equal(mood.warmth, -.9, 'the mood is still inferred while colour opens');
  const p = flocks[0].particles.find(p => !p.colorRebel), g = flocks[0];
  mood.colourBiasGain = 0; const open = f.colour(p, g).hue;
  mood.warmth = .8; const openAfterMoodChange = f.colour(p, g).hue;
  assert.equal(open, openAfterMoodChange, 'open phase removes the distribution bias');
  mood.colourBiasGain = 1;
  assert.notEqual(f.colour(p, g).hue, open, 'return follows the latest mood');
});
test('colour breathing waits for a recognised bar boundary with a bounded fallback', () => {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const { mood, rhythm } = f.inspect();
  Object.assign(rhythm, { confidence: 1, meterConfidence: .9, beat: true, beatInBar: 3, period: .5 });
  for (let i = 0; i < 105; i++) f.stepColourBreath(.1);
  assert.equal(mood.colourStage, 0);
  rhythm.beatInBar = 1; f.stepColourBreath(.1);
  assert.equal(mood.colourStage, 1);
  f.stepColourBreath(.1, false);
  assert.equal(mood.colourStage, 0);
  f.nodes['#next-mode'].click();
  assert.equal(mood.colourBiasGain, 1); assert.equal(mood.colourCycle, 0);
});

test('tempo ceilings cover flock leaders, particles, mirror partners and disappearance motion', () => {
  const f = fixture(async stream => stream, { width: 140, height: 220 });
  const { rhythm } = f.inspect();
  Object.assign(rhythm, { lastReliableBpm: 72, lastReliableTime: 0, motionLimitScale: .55 });
  const raw = new Float64Array(512), values = new Float64Array(512); raw.fill(.22); values.fill(.22);
  for (let i = 0; i < 60; i++) {
    if (i === 30) { raw.fill(0); values.fill(0); }
    f.stepScene(values, raw, .1);
    const limit = f.speedLimit();
    for (const g of f.inspect().flocks) {
      assert.ok(Math.hypot(g.vx, g.vy) <= limit * .68 + 1e-6);
      for (const p of g.particles.filter(p => p.alpha > .035)) {
        assert.ok(Math.hypot(p.vx, p.vy) <= limit + 1e-6, 'particles never exceed the tempo ceiling');
        assert.ok(Math.hypot(p.mvx, p.mvy) <= limit + 1e-6, 'reflection never races to catch up');
      }
    }
  }
  assert.ok(rhythm.motionLimitScale < .65);
});
test('slow tempo ceiling survives a brief loss of beat confidence', () => {
  const { f, step } = rhythmFixture();
  for (let i = 0; i < 60 * 10; i++) step(1 / 60, i % 40 < 3);
  assert.ok(f.inspect().rhythm.motionLimitScale < .8);
  for (let i = 0; i < 60 * 3; i++) step(1 / 60, false, true);
  assert.ok(f.inspect().rhythm.motionLimitScale < .8, 'a quiet passage cannot immediately raise the ceiling');
});
test('central focus bobs slowly and occasional surrounding foci fade without multiplying', () => {
  const f = fixture(async stream => stream, { width: 390, height: 740 });
  const { focus, rhythm } = f.inspect(); rhythm.bpm = 90; rhythm.period = 2 / 3;
  const heights = [], counts = new Set();
  let previous = focus.y;
  for (let i = 0; i < 300; i++) {
    f.stepFocus(.1);
    heights.push(focus.y); counts.add(focus.satellites.length);
    assert.ok(Math.abs(focus.y - previous) < 4);
    assert.ok(focus.satellites.length <= 2);
    previous = focus.y;
  }
  assert.ok(Math.max(...heights) - Math.min(...heights) > 25);
  assert.ok(counts.has(0) && counts.has(1));
  for (let i = 0; i < 120; i++) f.stepFocus(.1, false);
  assert.ok(focus.strength < .001 && focus.satellites.length === 0);
});

test('splitting conserves visible area, centre of mass and linear momentum within the tempo ceiling', () => {
  const f = fixture(async stream => stream, { width: 390, height: 740 });
  const g = f.inspect().flocks[0]; g.population = 64;
  const p = g.particles[0], q = g.particles[64];
  Object.assign(p, { size: 9, x: 100, y: 120, vx: 35, vy: -12, alpha: .9, reactionAfter: 0, travelState: 0 });
  const mass = p.size ** 2, before = { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
  assert.equal(f.split(g, p), true);
  const a = p.size ** 2, b = q.size ** 2;
  assert.ok(Math.abs(a + b - mass) < 1e-9);
  for (const key of ['x', 'y', 'vx', 'vy']) assert.ok(Math.abs((p[key] * a + q[key] * b) / mass - before[key]) < 1e-9);
  assert.ok(Math.hypot(p.vx, p.vy) <= f.speedLimit() && Math.hypot(q.vx, q.vy) <= f.speedLimit());
  assert.ok(Math.hypot(p.vx - q.vx, p.vy - q.vy) > 1);
  assert.equal(g.particles.length, 128); assert.equal(f.split(g, p), false, 'cannot repeatedly split immediately');
});
test('gentle small-particle collisions merge with conserved area and momentum and dissipated relative energy', () => {
  const f = fixture(async stream => stream, { width: 390, height: 740 });
  const [p, q] = f.inspect().flocks[0].particles;
  Object.assign(p, { size: 1, x: 100, y: 100, vx: 3, vy: 1, alpha: 1 });
  Object.assign(q, { size: 2, x: 102, y: 100, vx: -1, vy: 1, alpha: 1 });
  const energy = .5 * (1 * 10 + 4 * 2);
  assert.equal(f.merge(p, q), true);
  assert.ok(Math.abs(p.size ** 2 - 5) < 1e-9);
  assert.ok(Math.abs(p.vx - -.2) < 1e-9 && p.vy === 1);
  assert.ok(Math.abs(p.x - 101.6) < 1e-9);
  assert.ok(.5 * p.size ** 2 * (p.vx ** 2 + p.vy ** 2) < energy);
  assert.equal(q.alpha, 0); assert.ok(q.dormantUntil > 0);
  assert.equal(f.merge(p, q), false);
});
test('spectral variety and intensity raise the flock budget smoothly, while individuals differ in cohesion', () => {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const simple = new Float64Array(512), rich = new Float64Array(512), intense = new Float64Array(512);
  simple[100] = .5; rich.fill(.12); intense.fill(.65);
  for (let i = 0; i < 100; i++) f.stepSoundProfile(simple, .1);
  const sparse = f.inspect().soundProfile.budget;
  for (let i = 0; i < 100; i++) f.stepSoundProfile(rich, .1);
  const varied = f.inspect().soundProfile.budget;
  for (let i = 0; i < 100; i++) f.stepSoundProfile(intense, .1);
  const loud = f.inspect().soundProfile.budget;
  assert.ok(sparse <= 2 && varied >= 6 && loud > varied && loud <= 10, `${sparse},${varied},${loud}`);
  const cohesion = f.inspect().flocks.flatMap(g => g.particles.map(p => p.cohesion));
  assert.ok(Math.min(...cohesion) < .5 && Math.max(...cohesion) > 1.2);
});
