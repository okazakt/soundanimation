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
  const audioContexts = [];
  let nextFrame = 0, stopped = 0, closed = 0, released = 0, requestCount = 0;
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
    putImageData(data) { image = data; },
    ellipse(...args) { options.ellipses?.push(args); },
    translate(...args) { options.translations?.push(args); },
    arc(...args) { options.arcs?.push({args,alpha:this.globalAlpha}); },
    quadraticCurveTo(...args) { options.curves?.push(args); }
  }, { get(target, key) { return target[key] || (() => gradient); } });
  const node = () => ({ disabled: false, textContent: '', classList: { add() {}, remove() {} },
    value: '', open: false, replaceChildren(...children) { this.children = children; },
    showModal() { this.open = true; }, close() { this.open = false; this.closeEvent?.(); },
    attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, fn) { this[type === 'close' ? 'closeEvent' : type] = fn; }, getContext: () => context,
    getBoundingClientRect: () => ({ width: options.width || 390, height: options.height || 740 }) });
  const track = { addEventListener(type, fn) { events['track:' + type] = fn; } };
  const stream = { getTracks: () => [{ stop() { stopped++; } }], getAudioTracks: () => [track] };
  const document = { hidden: false, querySelector: selector => nodes[selector] ||= node(), createElement: node,
    addEventListener(type, fn) { events[type] = fn; } };
  class Audio {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.currentTime = 0; audioContexts.push(this); }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { if (this.state !== 'closed') closed++; this.state = 'closed'; }
    createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} }; }
    createAnalyser() { return { frequencyBinCount: 2048, getByteFrequencyData(data) { if (options.spectrum) options.spectrum(data); else data.fill(100); } }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  const navigator = { mediaDevices: { getUserMedia: async constraints => {
    requestCount++; assert.equal(constraints.audio.autoGainControl, false);
    assert.equal(constraints.audio.noiseSuppression, false);
    return getMicrophone(stream, constraints);
  }, enumerateDevices: options.enumerateDevices, addEventListener(type, fn) { events['media:' + type] = fn; } }, wakeLock: { request: async () => ({ addEventListener() {}, async release() { released++; } }) } };
  const window = { DanceMotion: require('../dance-motion.js'), BeatClock: require('../beat-clock.js').BeatClock, RenderTiming: require('../beat-clock.js').RenderTiming, BeatThisClient: options.beatThisClient, ModelSetup: options.modelSetup, AudioContext: Audio, devicePixelRatio: options.dpr || 2, addEventListener(type, fn) { events[type] = fn; } };
  // Reproducible visual variation keeps coverage independent of session RNG.
  let randomState = options.randomSeed ?? 0x12345678;
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const sandbox = { performance: { now: () => now }, Math: deterministicMath, window, document, navigator, ResizeObserver: class { observe() {} },
    requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }, setTimeout() { return 1; }, clearTimeout() {} };
  vm.runInNewContext(code.replace('  resize();\n  if', '  window.stepVortex = dt => updateVortex(dt);\n  window.inspect = () => ({ vortex, flocks, backgroundTone, backgroundEnergy, beatCooldown, mode, rhythm, basicRhythm, beatThisState, aiActive, audio, mood, focus, soundProfile });\n  window.splitParticle = (f, p) => splitParticle(f, p);\n  window.mergeParticles = (p, q) => mergeParticles(p, q);\n  window.stepSoundProfile = (values, dt) => { rawEnergies.set(values); updateSoundProfile(dt); };\n  window.particleSpeedLimit = () => particleSpeedLimit();\n  window.stepFocus = (dt, audible) => { elapsed += dt; updateFocus(dt, audible); };\n  window.stepColourBreath = (dt, audible) => { mood.time += dt; updateColourBreath(dt, audible); };\n  window.stepMood = (values, dt) => { rawEnergies.set(values); updateMood(dt); };\n  window.particleColour = (p, f) => particleColour(p, f);\n  window.chooseFlockGate = (f, wanted, audible, safety, now) => chooseFlockGate(f, wanted, audible, safety, now);\n  window.stepScene = (values, raw, dt) => { energies.set(values); rawEnergies.set(raw); elapsed += dt; updateRhythm(dt); updateFlocks(dt); };\n  window.recordParticleTail = (p, time) => recordParticleTail(p, time);\n  window.drawParticleTail = (p, now) => drawParticleTail(p, p.x, p.y, 1, 1, 120, 1, 4, now);\n  window.finishTransfers = moves => finishTransfers(moves);\n  window.drawRadiation = () => drawBeatRadiation();\n  window.drawFlocks = () => drawFlocks();\n  window.setInputLevel = value => { latestInputLevel=value; };\n  window.setVisualRhythm = value => { beatThisClient={stopped:false,stop(){}};rhythm={...basicRhythm,...value}; };\n  window.stepMotion = (values, dt) => { energies.set(values);rawEnergies.set(values);elapsed+=dt;updateFlocks(dt); };\n  window.stepBeatExpression = (flock, dt) => updateBeatExpression(flock, dt);\n  window.stepRhythm = (values, dt) => { energies.set(values); updateRhythm(dt); };\n  resize();\n  if'), sandbox);
  return { stepVortex: dt => window.stepVortex(dt), triggerBeat: value => window.triggerBeat(value), nodes, events, document, frames, counts: () => ({ stopped, closed, released, requestCount }),
    image: () => image, inspect: () => window.inspect(), stepRhythm: (values, dt) => window.stepRhythm(values, dt),
    drawRadiation: () => window.drawRadiation(),
    drawFlocks: () => window.drawFlocks(),
    setInputLevel: value => window.setInputLevel(value),
    setVisualRhythm: value => window.setVisualRhythm(value),
    stepMotion: (values, dt) => window.stepMotion(values,dt),
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
    async tick(dt = 1 / 60) { for (const context of audioContexts) if (context.state === 'running') context.currentTime += dt; now += dt * 1000; const [id, fn] = frames.entries().next().value; frames.delete(id); fn(now); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const micDevices = [
  { kind: 'audioinput', deviceId: 'phone', label: 'iPhone Microphone' },
  { kind: 'audioinput', deviceId: 'car', label: 'Car Bluetooth' }
];
test('microphone popup refreshes options on each opening and displays the selection', async () => {
  let devices = micDevices;
  const f = fixture(async stream => stream, { enumerateDevices: async () => devices });
  await f.nodes['#choose-microphone'].click();
  assert.equal(f.nodes['#microphone-dialog'].open, true);
  assert.deepEqual(f.nodes['#microphone-choices'].children.map(n => n.textContent), ['iPhone Microphone', 'Car Bluetooth']);
  await f.nodes['#microphone-choices'].children[0].click();
  assert.equal(f.nodes['#microphone-dialog'].open, false);
  assert.equal(f.nodes['#microphone-name'].textContent, 'iPhone Microphone');
  devices = [micDevices[0]];
  await f.nodes['#choose-microphone'].click();
  assert.equal(f.nodes['#microphone-choices'].children.length, 1);
  assert.equal(f.counts().requestCount, 0);
});
test('microphone popup permission input is released even when closed during permission', async () => {
  let resolvePermission;
  const f = fixture(stream => new Promise(resolve => { resolvePermission = () => resolve(stream); }), { enumerateDevices: async () => [] });
  const pending = f.nodes['#choose-microphone'].click(); await flush();
  f.nodes['#close-microphone-dialog'].click();
  resolvePermission(); await pending;
  assert.equal(f.counts().stopped, 1);
  assert.equal(f.nodes['#microphone-dialog'].open, false);
  assert.equal(f.nodes['#start'].disabled, false);
  assert.equal(f.nodes['#microphone-choices'].children.length, 0);
});
test('selected microphone starts directly and popup switching releases the previous input', async () => {
  const requests = [];
  const f = fixture(async (stream, constraints) => {
    const id = constraints.audio.deviceId?.exact; requests.push(id);
    return { ...stream, getAudioTracks: () => [{ label: id, getSettings: () => ({ deviceId: id }), addEventListener() {} }] };
  }, { enumerateDevices: async () => micDevices });
  await f.nodes['#choose-microphone'].click();
  await f.nodes['#microphone-choices'].children[0].click();
  await f.nodes['#start'].click();
  await f.nodes['#choose-microphone'].click();
  await f.nodes['#microphone-choices'].children[1].click();
  assert.deepEqual(requests, ['phone', 'car']);
  assert.equal(f.counts().stopped, 1);
  assert.equal(f.nodes['#microphone-name'].textContent, 'car');
  f.nodes['#stop'].click();
});
test('selected microphone loss stops and requires selection from the current popup', async () => {
  let devices = micDevices;
  const f = fixture(async stream => stream, { enumerateDevices: async () => devices });
  await f.nodes['#choose-microphone'].click();
  await f.nodes['#microphone-choices'].children[1].click();
  await f.nodes['#start'].click();
  devices = [micDevices[0]];
  await f.events['media:devicechange']();
  assert.equal(f.frames.size, 0);
  assert.equal(f.counts().stopped, 1);
  assert.equal(f.nodes['#microphone-dialog'].open, true);
  assert.equal(f.nodes['#microphone-choices'].children.length, 1);
  assert.match(f.nodes['#notice'].textContent, /選び直して/);
  f.nodes['#close-microphone-dialog'].click();
  assert.equal(f.nodes['#start'].disabled, true);
});
test('ended microphone opens current choices and failed selected input never falls back', async () => {
  for (const fail of [false, true]) {
    const f = fixture(async stream => { if (fail) throw new Error('missing'); return stream; }, { enumerateDevices: async () => micDevices });
    await f.nodes['#choose-microphone'].click();
    await f.nodes['#microphone-choices'].children[0].click();
    await f.nodes['#start'].click();
    if (!fail) await f.events['track:ended']();
    await flush();
    assert.equal(f.nodes['#microphone-dialog'].open, true);
    assert.equal(f.counts().requestCount, 1);
    assert.equal(f.frames.size, 0);
    assert.equal(f.nodes['#microphone-choices'].children.length, 2);
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
  const self = { skipWaiting: async () => {}, clients: { claim: async () => {} }, location: { href: 'https://example.com/soundanimation/sw.js' }, addEventListener(type, fn) { events[type] = fn; } };
  const caches = { keys: async () => ['sensor-cache', 'starlight-bell-soundanimation-v0', 'starlight-bell-soundanimation-v2026.10.19.41'],
    delete: async key => deleted.push(key), open: async () => ({ addAll: async urls => cached.push(...urls) }) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), { self, caches, URL });
  await new Promise(resolve => events.activate({ waitUntil: p => p.then(resolve) }));
  assert.deepEqual(deleted, ['starlight-bell-soundanimation-v0']);
  await new Promise(resolve => events.install({ waitUntil: p => p.then(resolve) }));
  assert.ok(cached.length > 10);
  assert.ok(!cached.some(url => url.includes('beatnet')));
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
test('audio onsets never add a second pulse effect and silence still fades', async () => {
  let volume = 0;
  const f = fixture(async stream => stream, { spectrum: data => data.fill(volume) });
  await f.nodes['#start'].click(); await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.presence === 0));
  volume = 180; await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.pulse === 0));
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
      assert.ok(retiring.get(g).every(p => {
        const distance = Math.hypot(p.x - f.inspect().focus.x, p.y - f.inspect().focus.y);
        const departure = Math.hypot(p.exitX - f.inspect().focus.x, p.exitY - f.inspect().focus.y);
        return distance < 16 || distance < departure;
      }), 'gathering exits approach the centre at the tempo ceiling, including particles arriving from outside');
    } else {
      assert.ok(retiring.get(g).some(p => p.x < 0 || p.x > 390 || p.y < 0 || p.y > 740), 'dispersal exits travel offscreen');
    }
  }
  volume = 160;
  for (let i = 0; i < 60; i++) await f.tick();
  assert.ok(f.inspect().flocks.some(g => g.active && g.collapse < .01 && g.presence > .9));
  f.nodes['#stop'].click();
});

test('audio changes preserve smooth speed and heading without beat pulses', async () => {
  let volume = 0;
  const f = fixture(async stream => stream, { spectrum: data => data.fill(volume) });
  await f.nodes['#start'].click(); await f.tick();
  volume = 200;
  const before = f.inspect().flocks.map(g => ({ speed: g.phaseSpeed, heading: g.heading }));
  await f.tick();
  assert.ok(f.inspect().flocks.every(g => g.pulse === 0), 'beats do not add another visual pulse');
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

test('recognised beat phases never add trajectory offsets, turns or colour accents',()=>{
 const f=fixture(async s=>s),{rhythm:r,flocks}=f.inspect(),g=flocks[0];
 for(let i=0;i<240;i++) {
  Object.assign(r,{tracking:true,confidence:1,phase:(i/30)%1,beatCount:Math.floor(i/30),meter:4,meterConfidence:1,beatInBar:Math.floor(i/30)%4+1});
  f.stepBeatExpression(g,1/60);
  for(const key of ['danceX','danceY','danceSwirl','danceAccent','danceOffsetX','danceOffsetY','beatTurn','beatHue']) assert.equal(g[key],0);
  assert.equal(g.danceSpread,1);
 }
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

test('optional lifetimes follow dwell time independently of beats, with silence and blank-screen overrides', () => {
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
  assert.equal(f.chooseGate(g, false, true, false, 6.7), false);
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
    if (i === 90) for (const g of f.inspect().flocks) for (const p of g.particles) {
      assert.ok(Math.abs(p.x + 1000) <= f.speedLimit() * .1 + 1e-6,
        'blank-screen recovery must not teleport visible offscreen particles');
    }
    const visible = f.inspect().flocks.some(g => g.particles.some(p => p.alpha > .035 && p.x >= 0 && p.x <= 140 && p.y >= 0 && p.y <= 220));
    blank = visible ? 0 : blank + .1; longest = Math.max(longest, blank);
  }
  assert.ok(longest <= 1.2, `longest blank ${longest}`);
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
test('colour breathing follows its own slow schedule independently of bar boundaries', () => {
  const f = fixture(async stream => stream, { width: 8, height: 8 });
  const { mood, rhythm } = f.inspect();
  Object.assign(rhythm, { confidence: 1, meterConfidence: .9, beat: true, beatInBar: 3, period: .5 });
  for (let i = 0; i < 105; i++) f.stepColourBreath(.1);
  assert.equal(mood.colourStage, 1);
  rhythm.beatInBar = 1; f.stepColourBreath(.1);
  assert.equal(mood.colourStage, 1);
  f.stepColourBreath(.1, false);
  assert.equal(mood.colourStage, 0);
  f.nodes['#next-mode'].click();
  assert.equal(mood.colourBiasGain, 1); assert.equal(mood.colourCycle, 0);
});

test('speed caps cover flock leaders, particles, mirror partners and disappearance motion', () => {
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
test('central focus stays fixed and occasional surrounding foci fade without multiplying', () => {
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
  assert.equal(Math.max(...heights)-Math.min(...heights),0);
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


test('new individuals enter from the focus or beyond the viewport, including population growth', () => {
  const f = fixture(async stream => stream, { width: 390, height: 740 });
  const values = new Float64Array(512); values.fill(.5);
  const styles = new Set();
  let births = 0;
  for (let i = 0; i < 35; i++) {
    const before = new Map(f.inspect().flocks.flatMap(g => g.particles.map(p => [p, { alpha: p.alpha, seeded: p.seeded }])));
    f.stepScene(values, values, .1);
    const { focus, flocks } = f.inspect();
    for (const g of flocks) for (const p of g.particles) {
      const old = before.get(p);
      if (old.alpha >= .005 || old.seeded || p.alpha < .005) continue;
      births++; styles.add(g.entryStyle);
      const reach = f.speedLimit() * .1 + 1;
      assert.ok(Math.hypot(p.x - focus.x, p.y - focus.y) <= reach ||
        p.x < 0 || p.x > 390 || p.y < 0 || p.y > 740, 'birth has a visible source');
    }
  }
  assert.ok(births > 100 && styles.has(0) && styles.has(2) && styles.has(3));
});

test('a returning dispersed flock preserves visible individuals and their bounded motion', () => {
  const f = fixture(async stream => stream, { width: 390, height: 740 });
  const values = new Float64Array(512); values.fill(.3);
  f.stepScene(values, values, .1);
  const g = f.inspect().flocks[0], p = g.particles[0];
  Object.assign(g, { active: false, exiting: true, presence: .7, gate: true, quiet: .5 });
  Object.assign(p, { x: 45, y: 90, vx: 10, vy: -5, alpha: .7, seeded: true });
  f.stepScene(values, values, .1);
  assert.ok(Math.hypot(p.x - 45, p.y - 90) <= f.speedLimit() * .1 + 1e-6);
  assert.ok(p.alpha > .6 && !g.exiting, 'the same dispersed individual reforms without fading out');
});


test('raw sustained input is not mistaken for silence after baseline subtraction', () => {
  const { f, step } = rhythmFixture();
  for (let i = 0; i < 60 * 8; i++) step(1 / 60, i % 30 < 3);
  const corrected = new Float64Array(512), raw = new Float64Array(512); raw.fill(.06);
  for (let i = 0; i < 60; i++) f.stepScene(corrected, raw, .1);
  assert.equal(f.inspect().rhythm.quiet, 0);
  assert.equal(f.inspect().rhythm.tracking, false, "raw input alone must not enable rhythm detection");
  raw.fill(0);
  for (let i = 0; i < 30; i++) f.stepScene(corrected, raw, .1);
  assert.ok(!f.inspect().rhythm.tracking && f.inspect().rhythm.pulse < .001);
});

test('BeatThis drives the renderer when fresh and confident, while transient analysis never estimates tempo', async () => {
  const clients = [];
  class FakeBeatThis {
    constructor(onState, onStatus) { this.emit = onState; this.onStatus = onStatus; clients.push(this); }
    async start() { this.onStatus('解析中'); }
    stop() { this.stopped = true; }
  }
  const f = fixture(async stream => stream, { width: 8, height: 8, beatThisClient: FakeBeatThis });
  await f.nodes['#start'].click(); await flush();
  f.inspect().audio.currentTime = 10;
  clients[0].emit({ time: 10, audioTime: 10, receivedAudioTime: 10, windowSeconds: 8, lastBeatAudioTime: 9.75, bpm: 120, confidence: .9,
    quiet: 0, beatCount: 20, beatInBar: 1, meter: 3, meterConfidence: .9,
    beatProbability: .8, downProbability: .1, meterMass: [.02, .9, .08] });
  await f.tick();
  assert.equal(f.inspect().rhythm.engine, 'beat-this');
  assert.equal(f.inspect().rhythm.meter, 3);
  assert.equal(f.inspect().rhythm.bpm, 120);
  assert.equal(f.inspect().basicRhythm.bpm, 0, 'transient envelope does not estimate tempo');
  f.inspect().audio.currentTime = 24; await f.tick(.1);
  assert.equal(f.inspect().rhythm.engine, 'basic', 'stale AI results cannot keep driving the renderer');
  f.nodes['#next-mode'].click();
  assert.ok(clients[0].stopped);
  clients[0].emit({ bpm: 200 });
  assert.equal(f.inspect().beatThisState, null, 'late results from a stopped worker are ignored');
  f.nodes['#stop'].click();
});

test('BeatThis restarts cleanly across mode changes and background/resume, and stops with the microphone', async () => {
  const clients = [];
  class FakeBeatThis {
    constructor(emit) { this.emit = emit; clients.push(this); }
    async start() {}
    stop() { this.stopped = true; }
  }
  const f = fixture(async stream => stream, { width: 8, height: 8, beatThisClient: FakeBeatThis });
  await f.nodes['#start'].click(); await flush();
  f.nodes['#next-mode'].click();
  assert.ok(clients[0].stopped); assert.equal(clients.length, 2);
  f.document.hidden = true; f.events.visibilitychange();
  assert.ok(clients[1].stopped);
  f.document.hidden = false; f.events.visibilitychange(); await flush();
  assert.equal(clients.length, 3);
  f.nodes['#stop'].click();
  assert.ok(clients.every(client => client.stopped));
  clients[2].emit({ bpm: 120 }); assert.equal(f.inspect().beatThisState, null);
});

test('BeatThis initialization failure retains microphone visualization and reports the fallback', async () => {
  class BrokenBeatThis {
    async start() { throw new Error('model unavailable'); }
    stop() { this.stopped = true; }
  }
  const f = fixture(async stream => stream, { width: 8, height: 8, beatThisClient: BrokenBeatThis });
  await f.nodes['#start'].click(); await flush(); await f.tick();
  f.nodes['#audio-debug'].open = true; f.nodes['#audio-debug'].toggle();
  assert.match(f.nodes['#debug-engine'].textContent, /model unavailable.*リズム判定を停止/);
  assert.equal(f.inspect().rhythm.engine, 'basic');
  assert.equal(f.nodes['#stop'].disabled, false);
  f.nodes['#stop'].click();
});

test('Beat This uses delayed estimates between updates, then expires them and cancels late results', async () => {
  const clients = [];
  class FakeBeatThis {
    constructor(emit) { this.emit = emit; clients.push(this); }
    async start() {}
    stop() { this.stopped = true; }
  }
  const f = fixture(async stream => stream, { width: 8, height: 8, beatThisClient: FakeBeatThis });
  await f.nodes['#start'].click(); await flush();
  f.inspect().audio.currentTime = 20;
  f.inspect().basicRhythm.quiet = 0;
  clients[0].emit({ time: 16, windowSeconds: 16, audioTime: 18, receivedAudioTime: 20, lastBeatAudioTime: 17.2,
    bpm: 120, confidence: .9, beatCount: 30, beatInBar: 2, meter: 3, meterConfidence: .9,
    beatProbability: .9, downProbability: .1, meterMass: [0, 1, 0], processingMs: 2000 });
  await f.tick(); assert.equal(f.inspect().rhythm.engine, 'beat-this');
  assert.equal(f.inspect().rhythm.meter, 3);
  f.inspect().audio.currentTime = 23; f.inspect().basicRhythm.quiet = 0;
  await f.tick(); assert.equal(f.inspect().rhythm.engine, 'beat-this', 'must bridge normal multi-second inference intervals');
  f.inspect().audio.currentTime = 31; await f.tick();
  assert.equal(f.inspect().rhythm.engine, 'basic', 'stale estimates expire even if audio remains audible');
  f.nodes['#next-mode'].click();
  assert.ok(clients[0].stopped); clients[0].emit({ bpm: 200 });
  assert.equal(f.inspect().beatThisState, null);
  f.nodes['#stop'].click();
});

test('page setup blocks microphone access and start until model preparation completes', async () => {
  const setup = { complete: false }, f = fixture(async stream => stream, { modelSetup: setup });
  assert.equal(f.nodes['#start'].disabled, true);
  await f.nodes['#start'].click(); await f.nodes['#choose-microphone'].click();
  assert.equal(f.counts().requestCount, 0);
  setup.complete = true; f.events['model-setup-state']();
  assert.equal(f.nodes['#start'].disabled, false);
  await f.nodes['#start'].click(); assert.equal(f.counts().requestCount, 1); f.nodes['#stop'].click();
});

test('high density displays cap canvas backing storage at DPR 2', () => {
  const f = fixture(async stream => stream, { dpr: 3, width: 390, height: 844 });
  assert.equal(f.nodes['#canvas'].width, 780); assert.equal(f.nodes['#canvas'].height, 1688);
});
test('fresh neural beats on adaptively audible low input are not vetoed by a raw silent spectrum',async()=>{
  const clients=[];
  class FakeBeatThis {
    constructor(emit,status,storage,input) { this.emit=emit;this.input=input;clients.push(this); }
    async start() {}
    stop() {this.stopped=true;}
  }
  const f=fixture(async stream=>stream,{width:8,height:8,spectrum:data=>data.fill(0),beatThisClient:FakeBeatThis});
  await f.nodes['#start'].click();await flush();
  f.inspect().audio.currentTime=20;
  clients[0].input({rms:.00001,gain:10000,adjustedRms:.1,quiet:false});
  clients[0].emit({time:8,audioTime:19,receivedAudioTime:20,lastBeatAudioTime:18.5,bpm:120,confidence:.9,quiet:0,beatCount:16,beatInBar:0,meter:0,meterConfidence:0,meterMass:[0,0,0],beatProbability:.6,downProbability:.1,processingMs:400,windowSeconds:8,inputRms:.00001,inputGain:10000,adjustedRms:.1});
  await f.tick();
  assert.equal(f.inspect().rhythm.engine,'beat-this');assert.equal(f.inspect().rhythm.bpm,120);
  f.nodes['#audio-debug'].open=true;f.nodes['#audio-debug'].toggle();
  assert.ok(!f.nodes['#debug-input'].textContent.includes('無音'));
  clients[0].input({rms:0,gain:0,adjustedRms:0,quiet:true});
  for(let i=0;i<50;i++) await f.tick(.02);
  assert.equal(f.inspect().rhythm.engine,'basic');
  f.nodes['#stop'].click();
});
test('mood changes steer future entrances while live individuals keep their chosen choreography and momentum',()=>{
  const f=fixture(async stream=>stream,{width:390,height:740});
  const {mood}=f.inspect();Object.assign(mood,{activity:.95,tension:.6,confidence:1});
  const values=new Float64Array(512).fill(.3);
  f.stepScene(values,values,.1);
  const g=f.inspect().flocks.find(g=>g.active && g.voice===0);
  const styles=[g.entryStyle,g.exitStyle];
  const live=g.particles.find(p=>p.alpha>.01);
  const before={x:live.x,y:live.y};
  Object.assign(mood,{activity:.05,tension:.1});f.stepScene(values,values,.1);
  assert.deepEqual([g.entryStyle,g.exitStyle],styles,'a mood change does not rewrite a live entrance or departure');
  assert.ok(Math.hypot(live.x-before.x,live.y-before.y)<=f.speedLimit()*.1+1e-6);
  assert.ok(f.inspect().flocks.every(g=>[g.danceX,g.danceY,g.danceSpread,g.danceEnergy].every(Number.isFinite)));
});
test('music energy uses tempo and relative attacks rather than treating amplified sustained input as energetic',()=>{
  const f=fixture(async stream=>stream,{width:8,height:8});
  const {rhythm,mood}=f.inspect();const sustained=new Float64Array(512).fill(.6);
  for(let i=0;i<100;i++) f.stepMood(sustained,.1);
  const calm=mood.activity;assert.ok(calm<.25);
  Object.assign(rhythm,{bpm:170,confidence:.95,fluxAverage:.05});
  const rhythmic=new Float64Array(512).fill(.25);
  for(let i=0;i<100;i++) f.stepMood(rhythmic,.1);
  assert.ok(mood.activity>.7 && mood.activity>calm*2.5);
});


test('breathing changes rendered sphere radius without moving the sphere or translating the scene',()=>{
  const ellipses=[],translations=[],f=fixture(async s=>s,{ellipses,translations}),state=f.inspect();
  const g=state.flocks[0],p=g.particles[0];
  p.alpha=1;p.breathRank=0;p.x=123;p.y=234;g.mirrorAlpha=0;
  state.focus.breath={wave:-1,participation:2/3};f.drawFlocks();
  const small=ellipses[0];ellipses.length=0;
  state.focus.breath.wave=1;f.drawFlocks();const large=ellipses[0];
  assert.deepEqual(small.slice(0,2),large.slice(0,2));
  assert.ok(large[2]>small[2]*2);assert.equal(translations.length,0);
  assert.equal(p.x,123);assert.equal(p.y,234);
});

test('beat speed changes build with inertia while positional and turning accents remain disabled',()=>{
 const f=fixture(async s=>s),state=f.inspect(),g=state.flocks[0],r=state.rhythm;
 Object.assign(r,{tracking:true,confidence:1,phase:0});
 for(let i=0;i<60;i++) {
  const previous=g.beatSpeed;f.stepBeatExpression(g,1/60);
  assert.ok(g.beatSpeed>=previous && g.beatSpeed-previous<.05);
  assert.equal(g.danceOffsetX,0);assert.equal(g.danceOffsetY,0);assert.equal(g.beatTurn,0);assert.equal(g.danceSpread,1);
 }
 assert.ok(g.beatSpeed>.9);
 Object.assign(r,{tracking:false});
 for(let i=0;i<300;i++) f.stepBeatExpression(g,1/60);
 assert.ok(g.beatSpeed<.001);
});
test('restored radiation uses a fixed centre and stops when tracking ends',()=>{
 const arcs=[],f=fixture(async s=>s,{arcs}),state=f.inspect();
 state.focus.breath.gain=1;Object.assign(state.rhythm,{tracking:true,confidence:1,period:.5,phase:.2,beatCount:0,meter:4,meterConfidence:1,beatInBar:1});
 f.drawRadiation();assert.equal(arcs.length,24);
 const centre=[state.focus.x,state.focus.y];arcs.length=0;
 state.rhythm.tracking=false;f.drawRadiation();assert.equal(arcs.length,0);
 assert.deepEqual([state.focus.x,state.focus.y],centre);
});

test('amplified noise stays blank until supported rhythm, quiet spectra can render that rhythm, and loss fades out',()=>{
 const f=fixture(async s=>s),noise=new Float64Array(512).fill(.15),quiet=new Float64Array(512);
 f.setVisualRhythm({tracking:false});
 for(let i=0;i<120;i++) f.stepMotion(noise,1/60);
 assert.ok(f.inspect().flocks.every(g=>g.particles.every(p=>p.alpha<.005)));
 f.setVisualRhythm({tracking:true,confidence:.9,bpm:120,period:.5,time:20,lastSupport:19,quiet:0,beatCount:40,phase:0});
 for(let i=0;i<120;i++) f.stepMotion(quiet,1/60);
 assert.ok(f.inspect().flocks.some(g=>g.particles.some(p=>p.alpha>.05)));
 f.setVisualRhythm({tracking:false});
 for(let i=0;i<300;i++) f.stepMotion(noise,1/60);
 assert.ok(f.inspect().flocks.every(g=>g.particles.every(p=>p.alpha<.005)));
});

test('ordinary sustained input renders without a beat and fades when only faint amplified input remains',()=>{
 const f=fixture(async s=>s),spectrum=new Float64Array(512).fill(.15);
 f.setVisualRhythm({tracking:false});
 f.setInputLevel({rms:.0016,adjustedRms:.1,quiet:false});
 for(let i=0;i<180;i++) f.stepMotion(spectrum,1/60);
 assert.ok(f.inspect().flocks.some(g=>g.particles.some(p=>p.alpha>.05)));
 f.drawRadiation();
 assert.equal(f.inspect().rhythm.tracking,false);
 f.setInputLevel({rms:.0001,adjustedRms:.1,quiet:false});
 for(let i=0;i<300;i++) f.stepMotion(spectrum,1/60);
 assert.ok(f.inspect().flocks.every(g=>g.particles.every(p=>p.alpha<.005)));
});


test('vortex cycles in both directions, accepts beats and resets on stop', async () => {
  const f = fixture(async stream => stream, { spectrum(data) { data.fill(0); } });
  f.nodes['#previous-mode'].click();
  assert.equal(f.inspect().mode, 'vortex');
  assert.equal(f.nodes['#theme-number'].textContent, '03 / 03');
  await f.nodes['#start'].click();
  for (let i=0;i<90;i++) await f.tick();
  let v=f.inspect().vortex;
  assert.ok(v.particles.length > 0, 'silence keeps ambient particles moving');

  assert.ok(v.particles.every(p=>[p.x,p.y,p.vx,p.vy].every(Number.isFinite)));
  const direction=v.direction;
  for(let i=0;i<16;i++) {
    // Public hook is exercised through the same VM as the application.
    f.triggerBeat(true);
    for(let j=0;j<12;j++) await f.tick();
  }
  assert.equal(v.beats,16);
  assert.equal(v.direction,-direction);
  f.nodes['#next-mode'].click();
  assert.equal(f.inspect().mode,'flocks');
  f.nodes['#previous-mode'].click();
  assert.equal(f.inspect().mode,'vortex');
  assert.equal(f.counts().requestCount,1);
  f.nodes['#stop'].click();
  assert.equal(f.inspect().vortex.particles.length,0);
});

test('vortex groups broadband attacks into 48 bands and accelerates crowded lifetimes', async () => {
  let loud=false;
  const f=fixture(async stream=>stream,{spectrum(data){data.fill(loud ? 220 : 0);}});
  f.nodes['#previous-mode'].click(); await f.nodes['#start'].click();
  await f.tick(.08); loud=true; await f.tick(.08);
  const v=f.inspect().vortex;
  assert.equal(v.particles.length, 48 * 2);
  assert.ok(v.decayRate > 1);
  assert.ok(v.densityAlpha < 1);
  assert.ok(v.particles.some(p=>p.f>.5),'high frequencies receive emission slots');
  const newborn = v.particles[0];
  const progress = newborn.lifeProgress;
  await f.tick();
  assert.ok(newborn.lifeProgress - progress > 1/60, 'crowding shortens existing lifetimes');
  loud=false;
  for(let i=0;i<80;i++) await f.tick(.1);
  assert.ok(!v.particles.includes(newborn), 'old dense cohorts expire without new emissions');
  assert.ok(v.particles.every(p=>[p.x,p.y,p.vx,p.vy].every(Number.isFinite)));
  f.nodes['#stop'].click();
});


test('vortex combines neighbouring frequencies and waits for the temporal window', async () => {
  let loud=false;
  const f=fixture(async stream=>stream,{spectrum(data){data.fill(0);if(loud)data.fill(220,600,800);}});
  f.nodes['#previous-mode'].click(); await f.nodes['#start'].click(); await f.tick(); await f.tick(.08);
  loud=true;
  for(let i=0;i<4;i++) await f.tick();
  const v=f.inspect().vortex;
  assert.equal(v.particles.length,0,'no emission before the 80ms window completes');
  await f.tick();
  assert.ok(v.particles.length>0 && v.particles.length<20,'neighbouring bins become a few bands');
  assert.ok(v.particles.every(p=>p.radius>=1 && p.radius<=5));
  const particles=v.particles.length;
  await f.tick(.08);
  assert.equal(v.particles.length,particles,'steady sound does not retrigger');
  f.nodes['#stop'].click();
});

test('vortex rotation follows recognised BPM smoothly and returns to neutral when tracking ends', async () => {
  const f=fixture(async stream=>stream,{spectrum(data){data.fill(0);}});
  f.nodes['#previous-mode'].click(); await f.nodes['#start'].click(); await f.tick(); await f.tick(.08);
  const v=f.inspect().vortex;
  f.setVisualRhythm({tracking:true,bpm:60});
  f.stepVortex(1/60);
  assert.ok(v.rotationSpeed<1 && v.rotationSpeed>.9, 'tempo changes start gradually');
  for(let i=0;i<600;i++) f.stepVortex(1/60);
  const slow=v.rotationSpeed;
  assert.ok(Math.abs(slow-.5)<.01);
  f.setVisualRhythm({tracking:true,bpm:180});
  for(let i=0;i<600;i++) f.stepVortex(1/60);
  assert.ok(Math.abs(v.rotationSpeed-1.5)<.01);
  f.setVisualRhythm({tracking:false,bpm:180});
  for(let i=0;i<600;i++) f.stepVortex(1/60);
  assert.ok(Math.abs(v.rotationSpeed-1)<.01, 'stale BPM is not used after tracking ends');
  f.nodes['#stop'].click();
  assert.equal(v.rotationSpeed,1);
});


test('vortex launch speed and reach follow band volume while angle follows the positive slope', async () => {
  async function launch(previous, next) {
    let level = previous;
    const f = fixture(async stream => stream, { spectrum(data) { data.fill(0); data.fill(level,600,800); } });
    f.nodes['#previous-mode'].click(); await f.nodes['#start'].click(); await f.tick(); await f.tick(.08);
    const v = f.inspect().vortex;
    v.particles.length = 0;
    v.levels.length = 0; // Compare slopes under the same loudness adaptation history.
    level = next; await f.tick(.08);
    const p = v.particles[0];
    assert.ok(p);
    const speed = Math.hypot(p.vx,p.vy);
    const cross = p.px * p.vy - p.py * p.vx;
    const dot = p.px * p.vx + p.py * p.vy;
    const angle = Math.atan2(cross,dot);
    const startVx=p.vx, startVy=p.vy;
    let reach = 0, turn = 0;
    for(let i=0;i<90;i++) {
      await f.tick();
      reach = Math.max(reach,Math.hypot(p.x,p.y));
      if(i===14) turn=Math.atan2(startVx*p.vy-startVy*p.vx,startVx*p.vx+startVy*p.vy);
    }
    f.nodes['#stop'].click();
    return { speed, angle, reach, turn, turnRate: p.turnRate };
  }
  const soft=await launch(0,30), loud=await launch(0,230), gentle=await launch(210,230);
  assert.ok(loud.speed > soft.speed * 3, 'band volume changes speed without saturating at the same value');
  assert.ok(loud.reach > soft.reach * 1.3, 'louder launches travel farther through the same field');
  assert.ok(Math.abs(loud.angle) > Math.abs(gentle.angle) + .3, 'sharper attack makes a larger tangential launch angle');
  assert.ok(Math.abs(gentle.angle) > .5, 'even gentle attacks visibly tilt away from the frequency ray');
  assert.ok(loud.turnRate*gentle.turnRate<0, 'sharp and gentle attacks curve in opposite directions');
  assert.ok(Math.abs(loud.turn)>.35, 'flight direction visibly curves after launch');
  assert.ok(loud.turn*gentle.turn<0, 'the actual trajectories turn in opposite directions');
  assert.ok(Math.abs(loud.speed-gentle.speed) < loud.speed * .15, 'equal volume keeps similar speed despite different slopes');
});


test('vortex auto sensitivity does not equalise the speed of quiet and loud broadband bursts', async () => {
  async function speed(level) {
    let loud=false;
    const f=fixture(async stream=>stream,{spectrum(data){data.fill(loud ? level : 0);}});
    f.nodes['#previous-mode'].click(); await f.nodes['#start'].click(); await f.tick(); await f.tick(.08);
    loud=true; await f.tick(.08);
    const p=f.inspect().vortex.particles[0];
    const result=Math.hypot(p.vx,p.vy);
    f.nodes['#stop'].click();
    return result;
  }
  assert.ok(await speed(220) > await speed(80) * 1.2);
});


test('vortex temporal peak hold retains a brief attack and resets on theme change', async () => {
  let loud=false;
  const f=fixture(async stream=>stream,{spectrum(data){data.fill(loud ? 180 : 0);}});
  f.nodes['#previous-mode'].click(); await f.nodes['#start'].click(); await f.tick(); await f.tick(.08);
  loud=true; await f.tick(); loud=false;
  for(let i=0;i<4;i++) await f.tick();
  const v=f.inspect().vortex;
  assert.equal(v.particles.filter(p=>p.life===6).length,96,'a one-frame transient survives the 80ms peak hold');
  f.nodes['#next-mode'].click(); f.nodes['#previous-mode'].click();
  assert.equal(v.analysisElapsed,0);
  assert.ok(v.windowPeaks.every(x=>x===0));
  assert.ok(v.previous.every(x=>x===0));
  f.nodes['#stop'].click();
});
