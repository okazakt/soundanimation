'use strict';
(() => {
  const VERSION = '2026.10.18.4';
  document.querySelector('#version').textContent = `v${VERSION}`;
  // Spectral channels are shared by pixels; this is not a star count.
  const N = 512;
  const canvas = document.querySelector('#canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const startButton = document.querySelector('#start');
  const stopButton = document.querySelector('#stop');
  const laneCanvas = document.querySelector('#lane-transition');
  const theme = document.querySelector('#theme');
  let themeTimer;
  let laneAnimations = [];
  let mode = 'flocks';
  const intro = document.querySelector('#intro');
  const notice = document.querySelector('#notice');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const rgb = hex => hex.match(/\w\w/g).map(v => parseInt(v, 16));
  const palette = ['FFB067', 'FFE0A3', 'FFF9EB', 'E6F2FF', '99BFFF'].map(rgb);
  const dusk = ['0B0E26', '281E46', '6E2E42', 'C2593F'].map(rgb);
  const midnight = ['020308', '060A17', '0B132B', '121E3D'].map(rgb);
  const stops = [0, .55, .85, 1];
  const channels = Array.from({ length: N }, (_, i) => {
    const p = i / (N - 1) * 4, a = Math.min(3, Math.floor(p));
    return { color: palette[a].map((v, c) => Math.round(lerp(v, palette[a + 1][c], p - a))),
      phase: i * 2.3999632297, baseline: 0, intensity: 0 };
  });
  // Sparse, stable emitters with overlapping halos instead of pixel noise.
  let lights = [], meteors = [], meteorCooldown = 0, flowAngle = Math.PI / 3;
  let fieldSeed = 0;
  let tuning;
  function tuneField() {
    tuning = { density: .0009 + .0005 * hash(0, 0, 6101),
      size: .8 + .4 * hash(0, 0, 6102),
      sensitivity: .85 + .3 * hash(0, 0, 6103) };
  }
  const glowColors = ['255,153,76', '255,210,120', '255,239,210',
    '130,210,255', '110,145,255', '201,132,255', '255,145,186'];
  // Three optical profiles: crisp core, gentle bloom, diffuse glow.
  const glows = glowColors.map(color => [0, 1, 2].map(softness => {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 128;
    const g = sprite.getContext('2d');
    const halo = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    halo.addColorStop(0, 'rgba(255,250,239,1)');
    if (softness === 0) {
      halo.addColorStop(.018, 'rgba(255,250,239,1)');
      halo.addColorStop(.025, `rgba(${color},.85)`);
      halo.addColorStop(.035, `rgba(${color},.08)`);
      halo.addColorStop(.15, `rgba(${color},.018)`);
      halo.addColorStop(.5, `rgba(${color},.002)`);
    } else {
      halo.addColorStop(softness === 1 ? .025 : .045, `rgba(${color},1)`);
      halo.addColorStop(.09, `rgba(${color},${softness === 1 ? .45 : .75})`);
      halo.addColorStop(.24, `rgba(${color},${softness === 1 ? .12 : .28})`);
      halo.addColorStop(.55, `rgba(${color},${softness === 1 ? .025 : .07})`);
    }
    halo.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = halo; g.fillRect(0, 0, 128, 128);
    return sprite;
  }));
  function hash(x, y, salt) {
    let v = Math.imul(x ^ salt ^ fieldSeed, 374761393) ^ Math.imul(y, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  }
  function prepareField() {
    lights = []; meteors = [];
    prepareFlocks();
    tuneField();
    // CSS coordinates keep density and halo size consistent on Retina screens.
    // Include offscreen sources so their glow can spill across screen edges.
    for (let y = -64; y < height + 64; y++) {
      for (let x = -64; x < width + 64; x++) {
        if (hash(x, y, 7331) > tuning.density) continue;
        lights.push({ x, y, band: Math.floor(hash(x, y, 19820119) * N),
          thirdOffset: 1 + Math.floor(hash(x, y, 7391) * (N - 1)),
          thirdDelay: 3.2 + 1.3 * hash(x, y, 7392),
          meteorThreshold: .5 + .3 * hash(x, y, 7393),
          meteorReady: true, meteorRest: 0,
          angleOffset: (hash(x, y, 7394) - .5) * .12,
          trail: 65 + 120 * hash(x, y, 7395),
          speed: 150 + 170 * hash(x, y, 7396),
          pairOffset: 1 + Math.floor(hash(x, y, 3719) * (N - 1)),
          condition: Math.floor(hash(x, y, 9203) * 3),
          delay: .1 + 2.9 * hash(x, y, 6421), intensity: 0,
          color: Math.floor(hash(x, y, 9187) * glows.length),
          // Keep most stars crisp, on every start: 80% / 17% / 3%.
          softness: hash(x, y, 7561) < .8 ? 0 : hash(x, y, 7561) < .97 ? 1 : 2,
          gain: .15 + .85 * Math.pow(hash(x, y, 451), 1.4),
          // Stable random response per light avoids frame-to-frame static.
          threshold: .08 + .34 * hash(x, y, 1723),
          sensitivity: (.65 + 1.15 * hash(x, y, 6197)) * tuning.sensitivity,
          // Most fade gently; a smaller group retains a much longer afterglow.
          releaseTime: hash(x, y, 4831) < .22 ?
            3 + 1.5 * hash(x, y, 4832) : 1.8 + .8 * hash(x, y, 4832),
          afterglow: 0, litAge: 0, fading: false, rest: 0,
          maxLitTime: 5 + 4 * hash(x, y, 4833),
          restTime: .8 + 1.2 * hash(x, y, 4834),
          responseCurve: 1.2 + 1.4 * hash(x, y, 2851),
          radius: (14 + 28 * hash(x, y, 831)) * tuning.size });
      }
    }
  }
  let width = 1, height = 1, running = false, starting = false, demo = false;
  let audio = null, stream = null, source = null, analyser = null, bins = null, bands = [];
  let environment = .15, elapsed = 0, previous = 0, frameId = 0, generation = 0;
  const signals = new Float32Array(N);
  const HISTORY_SIZE = 2048;
  const history = new Float32Array(HISTORY_SIZE * N);
  const historyTimes = new Float64Array(HISTORY_SIZE);
  let historyCount = 0, signalTime = 0;
  function resetSignals() {
    prepareFlocks(); resetRhythm();
    rawEnergies.fill(0); energies.fill(0);
    signals.fill(0); historyCount = 0; signalTime = 0;
    meteors = []; meteorCooldown = 0; flowAngle = Math.PI / 3;
    lights.forEach(light => { light.intensity = 0; light.afterglow = 0; light.litAge = 0; light.fading = false; light.rest = 0; light.meteorReady = true; light.meteorRest = 0; });
  }
  function recordSignals(dt) {
    signalTime += dt;
    const slot = historyCount % HISTORY_SIZE;
    history.set(signals, slot * N); historyTimes[slot] = signalTime;
    historyCount++;
  }
  function pastSignal(band, delay) {
    const time = signalTime - delay;
    let low = Math.max(0, historyCount - HISTORY_SIZE), high = historyCount - 1;
    if (high < 0 || time < historyTimes[low % HISTORY_SIZE] - 1e-9) return 0;
    // Locate by time, so delays remain the same at different frame rates.
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (historyTimes[mid % HISTORY_SIZE] <= time) low = mid;
      else high = mid - 1;
    }
    const slot = low % HISTORY_SIZE, next = (low + 1) % HISTORY_SIZE;
    const value = history[slot * N + band];
    if (low === historyCount - 1) return value;
    const k = clamp((time - historyTimes[slot]) /
      (historyTimes[next] - historyTimes[slot]), 0, 1);
    return lerp(value, history[next * N + band], k);
  }
  function matchedSignal(light) {
    const pair = (light.band + light.pairOffset) % N;
    const partner = light.condition === 0 ? signals[pair] :
      pastSignal(light.condition === 1 ? light.band : pair, light.delay);
    return Math.min(signals[light.band], partner);
  }
  let densityPressure = 0, visibleDensity = 0;
  let wake = null, wakePending = false, noticeTimer;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    prepareField();
    draw();
  }
  function message(text, duration = 3000) {
    clearTimeout(noticeTimer);
    notice.textContent = text; notice.classList.add('visible');
    noticeTimer = setTimeout(() => notice.classList.remove('visible'), duration);
  }
  async function acquireWake() {
    if (!running || document.hidden || wake || wakePending || !navigator.wakeLock) return;
    wakePending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!running || document.hidden) await lock.release();
      else { wake = lock; lock.addEventListener('release', () => { if (wake === lock) wake = null; }); }
    } catch { /* Unsupported or denied: observation still works. */ }
    finally { wakePending = false; }
  }
  function configureBands() {
    const binHz = audio.sampleRate / analyser.fftSize;
    const maximum = Math.min(14000, audio.sampleRate / 2);
    bands = channels.map((_, i) => {
      const low = 40 * Math.pow(maximum / 40, i / N);
      const high = 40 * Math.pow(maximum / 40, (i + 1) / N);
      const first = Math.max(1, Math.ceil(low / binHz));
      const last = Math.min(bins.length - 1, Math.ceil(high / binHz) - 1);
      // A narrow bass band can contain no bin at FFT 4096: use its nearest bin.
      return first <= last ? [first, last] : [clamp(Math.round(Math.sqrt(low * high) / binHz), 1, bins.length - 1)];
    });
  }
  async function start() {
    if (running || starting) return;
    const token = ++generation;
    starting = true; startButton.disabled = true; stopButton.disabled = false;
    startButton.textContent = '準備中…';
    fieldSeed = (fieldSeed + 1 + Math.floor(Math.random() * 0xfffffffe)) >>> 0;
    prepareField();
    environment = .15; elapsed = 0;
    densityPressure = 0; visibleDensity = 0; resetSignals();
    channels.forEach(s => { s.baseline = s.intensity = 0; });
    let localAudio = null, localStream = null;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio || !navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      localAudio = new Audio(); audio = localAudio;
      // Resume directly from the user's gesture, before awaiting microphone permission.
      await localAudio.resume();
      if (token !== generation) { await localAudio.close().catch(() => {}); return; }
      localStream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false
      }, video: false });
      if (token !== generation) {
        localStream.getTracks().forEach(track => track.stop());
        await localAudio.close().catch(() => {}); return;
      }
      stream = localStream;
      analyser = localAudio.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = .15;
      bins = new Uint8Array(analyser.frequencyBinCount);
      source = localAudio.createMediaStreamSource(stream); source.connect(analyser);
      // Intentionally do not connect the microphone to speakers.
      configureBands(); demo = false;
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (running && token === generation) { stop(); message('マイク入力が終了しました。再開するには「開始」を押してください。'); }
      }));
    } catch {
      localStream?.getTracks().forEach(track => track.stop());
      if (localAudio && localAudio.state !== 'closed') await localAudio.close().catch(() => {});
      if (token !== generation) return;
      audio = null; stream = null; source = null; analyser = null; demo = true;
      message('マイクへのアクセスを許可すると、音に反応して光が動きます（デモモードで動作中）');
    }
    if (token !== generation) return;
    starting = false; running = true; startButton.textContent = '開始';
    intro.classList.add('hidden'); previous = 0;
    acquireWake(); frameId = requestAnimationFrame(frame);
  }
  function stop() {
    ++generation; running = false; starting = false;
    cancelAnimationFrame(frameId);
    source?.disconnect(); source = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    if (audio && audio.state !== 'closed') audio.close().catch(() => {});
    audio = null; analyser = null; bins = null;
    if (wake) { wake.release().catch(() => {}); wake = null; }
    clearTimeout(noticeTimer); notice.classList.remove('visible');
    startButton.disabled = false; startButton.textContent = '開始'; stopButton.disabled = true;
    channels.forEach(s => { s.intensity = 0; });
    resetSignals();
    intro.classList.remove('hidden'); draw();
  }
  const energies = new Float64Array(N);
  const rawEnergies = new Float64Array(N);
  function update(dt) {
    const frames = dt * 60;
    if (!demo) analyser.getByteFrequencyData(bins);
    let squares = 0;
    channels.forEach((s, i) => {
      let energy;
      if (demo) {
        // Seeded sinusoidal pseudo-noise: repeatable simulation, with no recorded audio.
        const pulse = Math.pow(Math.max(0, Math.sin(elapsed * 1.7 + i * .41)), 12);
        const noise = Math.sin(elapsed * 13.17 + s.phase) * Math.sin(elapsed * 7.31 + i);
        energy = clamp(.025 + pulse * .28 + noise * .012, 0, 1);
      } else {
        const [first, end = first] = bands[i];
        let sum = 0;
        for (let b = first; b <= end; b++) sum += bins[b];
        energy = sum / ((end - first + 1) * 255);
      }
      s.baseline = energy < s.baseline ? energy : lerp(energy, s.baseline, Math.pow(.999, frames));
      rawEnergies[i] = energy;
      energies[i] = Math.max(0, energy - s.baseline * 1.15);
      squares += energies[i] ** 2;
    });
    const current = Math.sqrt(squares / N);
    let weighted = 0, totalEnergy = 0;
    for (let i = 0; i < N; i++) {
      weighted += energies[i] * i / (N - 1); totalEnergy += energies[i];
    }
    if (totalEnergy > .01) {
      const direction = Math.PI * (.2 + .6 * weighted / totalEnergy);
      flowAngle = lerp(direction, flowAngle, Math.exp(-dt / 2.5));
    }
    // Use the pre-adaptation level for the initial flash, then adapt immediately.
    const gamma = lerp(1.3, 2.4, clamp((environment - .018) / (.5 - .018), 0, 1));
    channels.forEach((s, i) => {
      const relative = energies[i] / (environment * Math.exp(densityPressure));
      const target = Math.pow(clamp(relative, 0, 1), gamma);
      signals[i] = target;
    });
    recordSignals(dt);
    updateRhythm(dt);
    if (mode === 'flocks') {
      updateFlocks(dt);
      environment = clamp(lerp(current, environment, Math.pow(current <= environment ? .992 : .88, frames)), .018, .5);
      return;
    }
    for (const light of lights) {
      // Match unsmoothed input first; apply afterglow only after coincidence.
      const target = matchedSignal(light);
      updateLight(light, target, dt);
    }
    updateMeteors(dt);
    // Feedback measures visible stars, including afterglow. Adapt slowly so a
    // sudden loud sound can flare before sustained crowding reduces sensitivity.
    let visible = 0, total = 0;
    for (const light of lights) {
      if (light.x < 0 || light.x >= width || light.y < 0 || light.y >= height) continue;
      total++;
      if (lightStrength(light) * light.gain > .045) visible++;
    }
    const density = total ? visible / total : 0;
    visibleDensity = lerp(density, visibleDensity, Math.exp(-dt / 2));
    // Aim for roughly 18% visibly active stars; relax sensitivity in quiet.
    densityPressure = clamp(densityPressure + (visibleDensity - .18) * dt * .9,
      0, Math.log(32));
    environment = clamp(lerp(current, environment, Math.pow(current <= environment ? .992 : .88, frames)), .018, .5);
  }
  function updateLight(light, target, dt) {
    // Bound each visible episode, even when a sustained tone keeps matching.
    if (light.rest > 0) {
      light.rest = Math.max(0, light.rest - dt);
      return;
    }
    if (light.intensity > .02) light.litAge += dt;
    else if (!light.fading) light.litAge = 0;
    if (light.litAge >= light.maxLitTime) light.fading = true;
    if (light.fading) {
      light.intensity *= Math.exp(-dt / .45);
      if (light.intensity < .005) {
        light.intensity = 0; light.afterglow = 0; light.litAge = 0;
        light.fading = false; light.rest = light.restTime;
      }
      return;
    }
    // Only a strong coincidence charges the extra persistence; quiet input
    // cannot repeatedly hold a star on. The stored charge fades over time.
    light.afterglow *= Math.exp(-dt / 8);
    if (target > .7) light.afterglow = Math.max(light.afterglow, (target - .7) / .3);
    const release = light.releaseTime * (1 + .6 * light.afterglow);
    const tau = target > light.intensity ? .045 : release;
    light.intensity = lerp(target, light.intensity, Math.exp(-dt / tau));
  }
  function meteorMatch(light) {
    const pair = (light.band + light.pairOffset) % N;
    let third = (light.band + light.thirdOffset) % N;
    if (third === pair) third = (third + 1) % N;
    if (third === light.band) third = (third + 1) % N;
    return Math.min(signals[light.band], pastSignal(pair, light.delay),
      pastSignal(third, light.thirdDelay));
  }
  function updateMeteors(dt) {
    meteorCooldown = Math.max(0, meteorCooldown - dt);
    for (const meteor of meteors) {
      meteor.age += dt;
      meteor.x += Math.cos(meteor.angle) * meteor.speed * dt;
      meteor.y += Math.sin(meteor.angle) * meteor.speed * dt;
    }
    meteors = meteors.filter(m => m.age < m.life);
    let candidate = null, candidateScore = 0;
    for (const light of lights) {
      light.meteorRest = Math.max(0, light.meteorRest - dt);
      const match = meteorMatch(light);
      if (match < light.meteorThreshold * .55) light.meteorReady = true;
      if (!light.meteorReady || light.meteorRest > 0 || match < light.meteorThreshold) continue;
      if (light.x < 0 || light.x > width || light.y < 0 || light.y > height) continue;
      // A new three-point match is an event, not a continuously firing source.
      light.meteorReady = false;
      if (lightStrength(light) < .03) continue;
      const score = match * (.5 + Math.random());
      if (score > candidateScore) { candidate = light; candidateScore = score; }
    }
    if (!candidate || meteorCooldown > 0 || meteors.length >= 3) return;
    const match = meteorMatch(candidate);
    candidate.meteorRest = 8 + Math.random() * 8;
    meteorCooldown = .9 + Math.random() * 1.6;
    meteors.push({ x: candidate.x, y: candidate.y, color: candidate.color,
      angle: flowAngle + candidate.angleOffset, speed: candidate.speed * (.7 + match),
      trail: candidate.trail * (.6 + match), age: 0, life: 1 + match * .8 });
  }
  function drawMeteors() {
    for (const meteor of meteors) {
      const fade = Math.min(1, meteor.age / .08) * Math.pow(1 - meteor.age / meteor.life, .6);
      const length = Math.min(meteor.trail, meteor.age * meteor.speed);
      const tx = meteor.x - Math.cos(meteor.angle) * length;
      const ty = meteor.y - Math.sin(meteor.angle) * length;
      const tail = ctx.createLinearGradient(tx, ty, meteor.x, meteor.y);
      tail.addColorStop(0, `rgba(${glowColors[meteor.color]},0)`);
      tail.addColorStop(.7, `rgba(${glowColors[meteor.color]},.35)`);
      tail.addColorStop(1, 'rgba(255,249,235,1)');
      ctx.globalAlpha = fade; ctx.strokeStyle = tail; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(meteor.x, meteor.y); ctx.stroke();
      ctx.globalAlpha = fade * .85;
      ctx.drawImage(glows[meteor.color][1], meteor.x - 18, meteor.y - 18, 36, 36);
    }
  }
  function lightStrength(light) {
    const intensity = light.intensity;
    const response = clamp((intensity - light.threshold) /
      (1 - light.threshold) * light.sensitivity, 0, 1);
    return Math.pow(response, light.responseCurve);
  }
  function draw() {
    if (mode === 'flocks') { drawFlocks(); return; }
    const k = (1 - Math.cos(2 * Math.PI * (elapsed % 60) / 60)) / 2;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    stops.forEach((stop, i) => sky.addColorStop(stop, `rgb(${dusk[i].map((v, c) => Math.round(lerp(v, midnight[i][c], k)))})`));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    for (const light of lights) {
      const strength = lightStrength(light);
      if (strength < .006) continue;
      const radius = light.radius * (.65 + 1.5 * Math.sqrt(strength));
      ctx.globalAlpha = strength * light.gain;
      ctx.drawImage(glows[light.color][light.softness], light.x - radius, light.y - radius,
        radius * 2, radius * 2);
      if (light.softness === 0) {
        // Draw a solid core in CSS pixels, independent of the soft halo sprite.
        ctx.globalAlpha = Math.min(1, strength * (.65 + light.gain));
        ctx.fillStyle = '#fff8e9';
        ctx.beginPath();
        ctx.arc(light.x, light.y, .55 + .85 * Math.sqrt(strength), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    drawMeteors();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Online beat tracking: spectral onsets vote for a tempo, then a gently
  // corrected clock carries the beat between transients. No sound is stored.
  const rhythm = { time: 0, lastOnset: -10, lastBeat: -10, nextBeat: 0,
    period: .5, bpm: 0, confidence: 0, phase: 0, pulse: 0, beatCount: 0, motionScale: 1,
    fluxAverage: 0, quiet: 0, onset: false, beat: false,
    meter: 0, meterConfidence: 0, beatInBar: 0, downbeatOffset: 0, accents: [],
    previous: new Float64Array(N), votes: new Float64Array(181), events: [] };
  function resetRhythm() {
    Object.assign(rhythm, { time: 0, lastOnset: -10, lastBeat: -10, nextBeat: 0,
      period: .5, bpm: 0, confidence: 0, phase: 0, pulse: 0, beatCount: 0, motionScale: 1,
      fluxAverage: 0, quiet: 0, onset: false, beat: false,
      meter: 0, meterConfidence: 0, beatInBar: 0, downbeatOffset: 0, accents: [] });
    rhythm.previous.fill(0); rhythm.votes.fill(0); rhythm.events = [];
  }
  function trackMeter(strength) {
    const r = rhythm;
    if (r.confidence < .4) return;
    const offset = (r.time - (r.nextBeat - r.period)) / r.period;
    const nearest = Math.round(offset);
    if (Math.abs(offset - nearest) > .23) return;
    const index = r.beatCount + nearest;
    const previous = r.accents.find(a => a.index === index);
    if (previous) previous.strength = Math.max(previous.strength, strength);
    else r.accents.push({ index, strength });
    r.accents = r.accents.filter(a => index - a.index < 32);
    let best = { score: 0, meter: 0, offset: 0 };
    for (const meter of [3, 4]) {
      if (r.accents.length < meter * 3) continue;
      const sums = Array(meter).fill(0), counts = Array(meter).fill(0);
      for (const a of r.accents) { const k = ((a.index % meter) + meter) % meter; sums[k] += a.strength; counts[k]++; }
      if (counts.some(n => n < 2)) continue;
      const means = sums.map((sum, i) => sum / counts[i]);
      const order = means.map((value, i) => ({ value, i })).sort((a, b) => b.value - a.value);
      // Require a unique recurring accent. Equal beats or two equal strong
      // beats cannot establish a downbeat and must remain ambiguous.
      const contrast = (order[0].value - order[1].value) / Math.max(.001, order[0].value);
      const confidence = clamp((contrast - .12) / .45, 0, 1);
      if (confidence > best.score) best = { score: confidence, meter, offset: order[0].i };
    }
    if (best.score > .35) {
      const same = r.meter === best.meter && r.downbeatOffset === best.offset;
      r.meterConfidence = same ? lerp(r.meterConfidence, best.score, .3) : best.score * .5;
      r.meter = best.meter; r.downbeatOffset = best.offset;
    } else r.meterConfidence *= .85;
  }
  function updateRhythm(dt) {
    const r = rhythm;
    r.time += dt; r.onset = false; r.beat = false;
    let flux = 0, level = 0;
    for (let i = 0; i < N; i++) {
      const weight = i < 205 ? 1.2 : i < 410 ? 1 : .7;
      flux += Math.max(0, energies[i] - r.previous[i]) * weight;
      level += energies[i]; r.previous[i] = energies[i];
    }
    flux /= N; level /= N;
    r.quiet = level > .003 ? 0 : r.quiet + dt;
    const onset = flux > .006 && flux > r.fluxAverage * 2.2 + .002 && r.time - r.lastOnset > .19;
    r.fluxAverage = lerp(flux, r.fluxAverage, Math.exp(-dt / .65));
    const voteDecay = Math.exp(-dt / 3.5);
    for (let bpm = 60; bpm <= 180; bpm++) r.votes[bpm] *= voteDecay;
    r.events = r.events.filter(event => r.time - event.time < 7);
    if (onset) {
      r.onset = true; r.lastOnset = r.time;
      for (let j = r.events.length - 1; j >= Math.max(0, r.events.length - 8); j--) {
        const delta = r.time - r.events[j].time;
        // Consecutive intervals get the most weight; longer spans bridge a
        // missing kick. Multiple hypotheses cover half/double-tempo ambiguity.
        for (let beats = 1; beats <= 8; beats++) {
          const bpm = 60 * beats / delta;
          if (bpm < 59 || bpm > 181) continue;
          const weight = Math.exp(-delta / 4) / beats * (j === r.events.length - 1 ? 1.6 : .5);
          const spread = Math.max(2, bpm * .03);
          for (let bin = Math.max(60, Math.floor(bpm - spread * 2)); bin <= Math.min(180, Math.ceil(bpm + spread * 2)); bin++) {
            r.votes[bin] += weight * Math.exp(-.5 * ((bin - bpm) / spread) ** 2);
          }
        }
      }
      r.events.push({ time: r.time });
      let winner = 0, best = 0, runner = 0;
      for (let bpm = 60; bpm <= 180; bpm++) {
        const prior = r.confidence > .45 && Math.abs(bpm - r.bpm) < 5 ? 1.12 : 1;
        const score = r.votes[bpm] * prior;
        if (score > best) { best = score; winner = bpm; }
      }
      for (let bpm = 60; bpm <= 180; bpm++) if (Math.abs(bpm - winner) > Math.max(7, winner * .08)) runner = Math.max(runner, r.votes[bpm]);
      if (winner && r.events.length >= 4) {
        const period = 60 / winner;
        const recent = r.events.slice(-10);
        let coherent = 0;
        for (const event of recent) {
          const cycles = (r.time - event.time) / period;
          if (Math.abs(cycles - Math.round(cycles)) < .20) coherent++;
        }
        const certainty = clamp((best - runner) / Math.max(.01, best) * 2, 0, 1) *
          clamp((coherent / recent.length - .55) / .4, 0, 1) * clamp((recent.length - 2) / 4, 0, 1);
        const wasLocked = r.confidence > .3;
        r.confidence = lerp(r.confidence, certainty, .4);
        if (certainty > .3) {
          // Median recent intervals ignore early/late individual hits and
          // bridge missing beats, while following a gradual human tempo drift.
          const intervals = [];
          for (let i = 1; i < recent.length; i++) {
            const gap = recent[i].time - recent[i - 1].time;
            const beats = Math.max(1, Math.round(gap / period));
            const sample = gap / beats;
            if (Math.abs(sample - period) < period * .23) intervals.push(sample);
          }
          intervals.sort((a, b) => a - b);
          const middle = Math.floor(intervals.length / 2);
          const median = intervals.length ? (intervals[middle] + intervals[Math.max(0, Math.ceil(intervals.length / 2) - 1)]) / 2 : period;
          const candidate = lerp(winner, 60 / median, .45);
          r.bpm = wasLocked ? lerp(r.bpm, candidate, .2) : candidate;
          r.period = 60 / r.bpm;
          if (!wasLocked) r.nextBeat = r.time + r.period;
          else {
            const nearest = r.nextBeat + Math.round((r.time - r.nextBeat) / r.period) * r.period;
            const error = r.time - nearest;
            if (Math.abs(error) < r.period * .27) r.nextBeat += clamp(error, -.085, .085) * .2;
          }
        }
      }
    }
    if (onset) trackMeter(flux);
    const stale = r.time - r.lastOnset > Math.max(1.8, r.period * 3.5);
    if (stale || r.quiet > .15) r.confidence *= Math.exp(-dt / (r.quiet > .15 ? .45 : 1.2));
    if (r.confidence > .3 && r.quiet < .15) {
      while (r.nextBeat <= r.time) {
        if (r.time - r.lastBeat > r.period * .6) { r.beat = true; r.lastBeat = r.nextBeat; r.beatCount++; }
        r.nextBeat += r.period;
      }
      r.phase = ((r.time - (r.nextBeat - r.period)) / r.period + 1) % 1;
      r.pulse = Math.exp(-r.phase * 9);
    } else { r.pulse *= Math.exp(-dt / .18); }
    if (stale && r.confidence < .03) { r.bpm = 0; r.events = []; r.votes.fill(0); }
    if (r.quiet > .15 || stale) r.meterConfidence *= Math.exp(-dt / .7);
    if (r.meterConfidence < .15) { r.beatInBar = 0; }
    else r.beatInBar = ((r.beatCount - r.downbeatOffset) % r.meter + r.meter) % r.meter + 1;
    const tempoSpeed = r.bpm ? clamp(Math.pow(r.bpm / 120, 1.2), .5, 1.65) : 1;
    r.motionScale = lerp(lerp(1, tempoSpeed, r.confidence), r.motionScale, Math.exp(-dt / 1.2));
  }

  // Five logarithmic frequency regions (angular frequency ω = 2πf has
  // the same band ordering). Particle colours follow their individual bands.
  let flocks = [], beatCooldown = 0;
  let backgroundTone = .5, backgroundEnergy = 0;
  const flockRanges = [0, 103, 205, 307, 410, N];
  function particleSize(q) {
    if (q < .32) return .18 + .62 * Math.pow(q / .32, 1.4);
    if (q < .985) return .9 + 3.6 * Math.pow((q - .32) / .665, 1.5);
    return 7 + 4 * (q - .985) / .015;
  }
  function guestSlot(f) {
    return f.particles.findIndex((p, j) => j >= f.population && p.alpha < .015 &&
      p.travelState === 0 && p.guestUntil <= elapsed);
  }
  function findTravelHost(owner, p) {
    let best = null, distance = Infinity;
    for (const f of flocks) {
      if (f === owner || !f.active || f.exiting || f.presence < .4 || guestSlot(f) < 0) continue;
      const d = Math.hypot(f.x - p.x, f.y - p.y);
      if (d < distance) { best = f; distance = d; }
    }
    return best;
  }
  function finishTransfers(transfers) {
    for (const { owner, particle: p, host } of transfers) {
      if (!host.active || host.exiting || owner.exiting) continue;
      const from = owner.particles.indexOf(p), to = guestSlot(host);
      if (from < 0 || to < 0 || p.travelState !== 2) continue;
      // Move the same object, preserving position, velocity, size and colour.
      // Reuse the host's dormant slot in the source: total allocation is fixed.
      const spare = host.particles[to];
      host.particles[to] = p; owner.particles[from] = spare;
      p.travelState = 0; p.travelTarget = -1; p.travelAge = 0;
      p.guestUntil = elapsed + 7; p.nextTrip = elapsed + 12 + p.tint * 10;
      const low = flockRanges[host.region], high = flockRanges[host.region + 1];
      p.band = low + Math.floor(p.tint * (high - low));
      Object.assign(spare, { x: owner.x, y: owner.y, vx: owner.vx, vy: owner.vy,
        alpha: 0, strength: 0, travelState: 0, travelTarget: -1, travelAge: 0,
        tailCount: 0, tailHead: 0, tailTime: -10,
        guestUntil: 0, nextTrip: elapsed + 10 + spare.tint * 12,
        band: flockRanges[owner.region] + Math.floor(spare.tint * (flockRanges[owner.region + 1] - flockRanges[owner.region])) });
    }
  }
  function prepareFlocks() {
    beatCooldown = 0;
    backgroundTone = .5; backgroundEnergy = 0;
    flocks = Array.from({ length: 10 }, (_, id) => ({
      id, region: id % 5, voice: Math.floor(id / 5), episode: 0,
      level: 0, presence: 0, pulse: 0, quiet: 10, collapse: 1,
      active: false, gate: false, pendingGate: null, pendingSince: 0, gateChangedAt: -10, safetyUntil: 0,
      exiting: false, exitStyle: id % 4, trail: [],
      mirrorType: 0, mirrorAlpha: 0, population: 0, colorShift: 0, beatTurn: 0, beatHue: 0,
      shape: 0, vx: 0, vy: 0, motionLevel: 0, motionPulse: 0, groove: 0,
      phaseSpeed: (.8 + (id % 5) * .16) * (.55 + hash(id, 0, 8020) * 1.1),
      speedScale: .55 + hash(id, 0, 8020) * 1.1,
      scale: .7 + hash(id, 0, 8011) * 1.3,
      x: width * (.2 + .6 * hash(id, 0, 8001)),
      y: height * (.2 + .6 * hash(id, 0, 8002)),
      heading: hash(id, 0, 8003) * Math.PI * 2,
      phase: hash(id, 0, 8004) * Math.PI * 2,
      particles: Array.from({ length: 128 }, (_, j) => ({
        band: flockRanges[id % 5] + Math.floor(hash(id, j, 8005) * (flockRanges[id % 5 + 1] - flockRanges[id % 5])),
        angle: j * 2.3999632297, distance: Math.sqrt(hash(id, j, 8010)),
        tint: hash(id, j, 8021), mirrorX: width / 2, mirrorY: height / 2, mvx: 0, mvy: 0,
        size: particleSize(hash(id, j, 8012)),
        travelState: 0, travelTarget: -1, travelAge: 0, guestUntil: 0, mirrorWeight: 1,
        tail: new Float64Array(36), tailHead: 0, tailCount: 0, tailTime: -10,
        nextTrip: 4 + hash(id, j, 8030) * 15, driftAngle: 0,
        baseTone: (flockRanges[id % 5] + hash(id, j, 8005) * (flockRanges[id % 5 + 1] - flockRanges[id % 5])) / (N - 1),
        x: width * (.2 + .6 * hash(id, 0, 8001)),
        y: height * (.2 + .6 * hash(id, 0, 8002)), alpha: 0, strength: 0, vx: 0, vy: 0
      }))
    }));
  }
  // Exact critically damped spring for a fixed target over this frame.
  // Position and velocity remain continuous when the target changes.
  function springAxis(body, axis, velocity, target, omega, dt) {
    const offset = body[axis] - target;
    const impulse = body[velocity] + omega * offset;
    const decay = Math.exp(-omega * dt);
    body[axis] = target + (offset + impulse * dt) * decay;
    body[velocity] = (body[velocity] - omega * impulse * dt) * decay;
  }
  function updateBeatExpression(f, dt) {
    // Counted beats describe a visual phrase, not an inferred musical meter.
    // Four beats bend the stream; eight beats carry a slower colour movement.
    const cycle = rhythm.beatCount + rhythm.phase;
    const turn = rhythm.confidence * (
      Math.sin(cycle * Math.PI / 2 + f.id * .61) * .48 +
      Math.sin(rhythm.phase * Math.PI * 2) * .1);
    const hue = rhythm.confidence * (
      Math.sin(cycle * Math.PI / 4 + f.id * .4) * 28 +
      Math.cos(rhythm.phase * Math.PI * 2) * 18);
    f.beatTurn = lerp(turn, f.beatTurn, Math.exp(-dt / .4));
    f.beatHue = lerp(hue, f.beatHue, Math.exp(-dt / clamp(rhythm.period * .24, .12, .24)));
  }
  function chooseFlockGate(f, wanted, audible, safety, now) {
    if (!audible) { f.gate = false; f.pendingGate = null; return false; }
    if (safety) {
      if (!f.gate) f.gateChangedAt = now;
      f.gate = true; f.pendingGate = null; f.safetyUntil = now + 2.5; return true;
    }
    if (now < f.safetyUntil) return f.gate;
    if (wanted === f.gate) { f.pendingGate = null; return f.gate; }
    if (f.gate && now - f.gateChangedAt < 3) return true;
    if (f.pendingGate !== wanted) { f.pendingGate = wanted; f.pendingSince = now; }
    const wait = now - f.pendingSince;
    const locked = rhythm.confidence > .35;
    const barKnown = rhythm.meterConfidence > .5;
    const boundary = rhythm.beat && (!barKnown || rhythm.beatInBar === 1 || rhythm.beatInBar === rhythm.meter);
    if (boundary || (!locked && (rhythm.onset || wait > .6)) || wait > 2.2) {
      f.gate = wanted; f.pendingGate = null; f.gateChangedAt = now;
    }
    return f.gate;
  }
  function regionDrives() {
    return Array.from({ length: 5 }, (_, region) => {
      let sum = 0, peak = 0, rawSum = 0, rawPeak = 0;
      const low = flockRanges[region], high = flockRanges[region + 1];
      for (let i = low; i < high; i++) {
        sum += energies[i]; peak = Math.max(peak, energies[i]);
        rawSum += rawEnergies[i]; rawPeak = Math.max(rawPeak, rawEnergies[i]);
      }
      const energy = sum / (high - low) * .65 + peak * .35;
      const reactive = energy < .003 ? 0 : clamp(energy / Math.max(.045, environment * .7), 0, 1);
      // Baseline subtraction can erase a sustained note. Retain a restrained
      // response to actual input so adaptation cannot blank audible music.
      const sustained = rawSum / (high - low) > .025 || rawPeak > .12;
      return Math.max(reactive, sustained ? clamp((rawSum / (high - low) + rawPeak * .1) * .6, .09, .35) : 0);
    });
  }
  function updateFlocks(dt) {
    const transfers = [];
    let total = 0, weighted = 0;
    for (let i = 0; i < N; i++) {
      total += energies[i]; weighted += energies[i] * i / (N - 1);
    }
    const beat = rhythm.onset;
    beatCooldown = Math.max(0, .19 - (rhythm.time - rhythm.lastOnset));
    backgroundTone = lerp(total > .001 ? weighted / total : backgroundTone,
      backgroundTone, Math.exp(-dt / 1.4));
    backgroundEnergy = lerp(clamp(total / N / .4, 0, 1), backgroundEnergy, Math.exp(-dt / .8));
    const drives = regionDrives();
    const strongest = drives.indexOf(Math.max(...drives));
    const hasVisible = flocks.some(f => f.particles.some(p => p.alpha > .035 &&
      p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height));
    const rescue = drives[strongest] > .035 && !hasVisible;
    for (const f of flocks) {
      const drive = drives[f.region];
      // Independent voices enter and leave on long phrases. Rich/loud bands can
      // add a second voice; a sparse note does not create every flock at once.
      const phraseClock = elapsed / (9 + f.id * .47) + f.id * .173;
      const window = phraseClock % 1;
      const enabled = f.voice === 0 ? window < .82 : window > .18 && window < .72 && drive > .48;
      const safety = rescue && f.id === strongest;
      if (safety && (!f.active || f.particles.some(p => p.alpha > .08))) {
        f.presence = 0; f.active = false;
      }
      const gate = chooseFlockGate(f, enabled, drive > .035, safety, elapsed);
      const target = gate ? drive : 0;
      if (target > .035 && !f.active) {
        if (f.presence < .001) {
          f.trail = [];
          f.particles.forEach(p => { const r = Math.min(width, height) * .12 * p.distance;
            p.x = f.x + Math.cos(p.angle) * r; p.y = f.y + Math.sin(p.angle) * r;
            p.vx = Math.cos(p.angle + Math.PI / 2) * 35;
            p.vy = Math.sin(p.angle + Math.PI / 2) * 35; p.alpha = 0;
            p.travelState = 0; p.travelTarget = -1; p.guestUntil = 0;
            p.tailCount = p.tailHead = 0; p.tailTime = -10; });
        }
        f.episode++;
        f.exitStyle = (f.id + f.episode - 1) % 4;
      }
      f.active = target > .035;
      f.level = lerp(target, f.level, Math.exp(-dt / (target > f.level ? .09 : .45)));
      f.quiet = target > .035 ? 0 : f.quiet + dt;
      f.collapse = lerp(clamp((f.quiet - .18) / 1.15, 0, 1), f.collapse, Math.exp(-dt / .18));
      if (f.quiet > .18 && !f.exiting && f.presence > .05) {
        f.exiting = true; f.exitX = f.x; f.exitY = f.y; f.exitPopulation = f.population;
        f.particles.forEach(p => { p.exitX = p.x; p.exitY = p.y; });
      }
      if (f.active) f.exiting = false;
      // Keep the flock visible during its journey home, then extinguish it.
      const visibility = f.quiet < 2 ? 1 : 0;
      f.presence = lerp(visibility, f.presence, Math.exp(-dt / (visibility ? .12 : .23)));
      f.pulse = beat ? 1 : Math.max(f.pulse * Math.exp(-dt / .3), rhythm.pulse * rhythm.confidence);
      const sway = (.5 + .5 * Math.cos(rhythm.phase * Math.PI * 2)) * rhythm.confidence;
      f.groove = lerp(sway, f.groove, Math.exp(-dt / .14));
      updateBeatExpression(f, dt);
      f.motionLevel = lerp(f.level, f.motionLevel, Math.exp(-dt / .38));
      f.motionPulse = lerp(f.pulse, f.motionPulse, Math.exp(-dt / .12));
      // Beats still light up immediately; travel speed absorbs their impulse.
      const speedTarget = (.8 + f.region * .16 + f.motionLevel * 1.25 + f.motionPulse * .7 + f.groove * .4) * f.speedScale * rhythm.motionScale;
      f.phaseSpeed = lerp(speedTarget, f.phaseSpeed, Math.exp(-dt / .5));
      f.phase += dt * f.phaseSpeed;
      const t = f.phase;
      // Blend between orbit, rolling waves, radial breathing and a broad
      // sweep. Frequency and phrase position choose different shapes per flock.
      // The leader steers the moving flow, not individual particle positions.
      const phrase = elapsed / (8 + f.id * .31) + f.id * .83 + backgroundTone * .7;
      const shape = ((Math.floor(phrase) % 5) + 5) % 5;
      const mix = (1 - Math.cos(Math.PI * clamp((phrase % 1 - .55) / .45, 0, 1))) / 2;
      f.shape = shape + mix;
      const extent = (1 - (f.exitStyle % 2 === 0 ? f.collapse : 0)) * (.6 + f.motionLevel * .4);
      const path = (kind, time = t) => {
        const t = time;
        if (kind === 0) return [Math.cos(t) * .31, Math.sin(t) * .28];
        if (kind === 1) return [Math.sin(t * .55) * .35, Math.sin(t * 1.3 + f.id) * .18];
        if (kind === 2) {
          const r = .12 + .22 * (.5 + .5 * Math.sin(t * .6));
          return [Math.cos(t * .4 + f.id) * r, Math.sin(t * .4 + f.id) * r];
        }
        if (kind === 3) return [Math.sin(t * .45 + f.id) * .2, Math.cos(t * .7) * .37];
        return [Math.cos(t * .37 + f.id) * .34, Math.sin(t * .83) * .19];
      };
      const a = path(shape), b = path((shape + 1) % 5);
      const px = lerp(a[0], b[0], mix), py = lerp(a[1], b[1], mix);
      const ct = Math.cos(f.beatTurn), st = Math.sin(f.beatTurn);
      const tx = width * (.5 + (px * ct - py * st) * extent);
      const ty = height * (.5 + (px * st + py * ct) * extent);
      springAxis(f, 'x', 'vx', tx, 7, dt);
      springAxis(f, 'y', 'vy', ty, 7, dt);
      if (Math.hypot(f.vx, f.vy) > 3) {
        const desired = Math.atan2(f.vy, f.vx);
        const turn = Math.atan2(Math.sin(desired - f.heading), Math.cos(desired - f.heading));
        f.heading += clamp(turn * (1 - Math.exp(-dt / .35)), -1.6 * dt, 1.6 * dt);
      }
      if (f.presence < .001 && !f.active) { f.trail = []; continue; }
      f.trail.unshift({ x: f.x, y: f.y, time: elapsed });
      while (f.trail.length > 2 && f.trail[f.trail.length - 2].time < elapsed - 1.6) f.trail.pop();
      const radius = Math.min(width, height) * (.10 + f.motionLevel * .20) * f.scale *
        (1 + f.motionPulse * .5 + f.groove * .18) * (.8 + .2 * Math.sin(t * .4 + f.id));
      const count = f.exiting ? f.exitPopulation : Math.round(16 + f.level * (64 + 48 * (.5 + .5 * Math.sin(t * .24 + f.id))));
      f.population = count; f.radius = radius;
      const symmetryChoice = Math.floor(hash(f.id, Math.floor(phrase), 8022) * 7);
      const symmetry = symmetryChoice < 4 ? 0 : symmetryChoice - 3;
      if (symmetry !== f.mirrorType && f.mirrorAlpha < .03) f.mirrorType = symmetry;
      f.mirrorAlpha = lerp(symmetry === f.mirrorType && symmetry ? 1 : 0, f.mirrorAlpha, Math.exp(-dt / .65));
      f.colorShift = lerp(Math.sin(t * .23 + f.id) * .13 + backgroundTone * .1, f.colorShift, Math.exp(-dt / 1.2));
      // Local neighbour samples are frozen for the frame, so the result does
      // not depend on particle iteration order. A grid bounds mobile CPU cost.
      const cellSize = Math.max(18, Math.min(width, height) * .085);
      const cells = new Map();
      const members = f.particles.map(p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, alpha: p.alpha, travelling: p.travelState !== 0, guest: p.guestUntil > elapsed }));
      members.forEach((p, j) => {
        if (p.travelling || (j >= count && !p.guest && p.alpha < .05)) return;
        const key = `${Math.floor(p.x / cellSize)},${Math.floor(p.y / cellSize)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(j);
      });
      f.particles.forEach((p, j) => {
        p.strength = lerp(clamp(energies[p.band] / Math.max(.06, environment), 0, 1), p.strength, Math.exp(-dt / .12));
        p.alpha = lerp(j < count || p.guestUntil > elapsed || p.travelState ? f.presence : 0, p.alpha, Math.exp(-dt / .18));
        p.baseTone = lerp(p.band / (N - 1), p.baseTone, Math.exp(-dt / 1.4));
        p.mirrorWeight = lerp(p.travelState ? 0 : 1, p.mirrorWeight, Math.exp(-dt / .35));
        if (j >= count && p.alpha < .005 && !f.exiting && !p.travelState) return;
        if (f.exiting) { p.travelState = 0; p.travelTarget = -1; }
        if (!p.travelState && p.size < .85 && p.alpha > .4 && f.active && !f.exiting &&
          elapsed > p.nextTrip && f.particles.filter(q => q.travelState).length < 2 && findTravelHost(f, p)) {
          p.travelState = 1; p.travelAge = 0;
          p.driftAngle = Math.atan2(p.y - f.y, p.x - f.x) + (p.tint - .5) * .7;
        }
        if (p.travelState) {
          p.travelAge += dt;
          if (p.travelState === 1 && p.travelAge > 1 + p.tint) {
            const host = findTravelHost(f, p);
            p.travelTarget = host ? host.id : f.id; p.travelState = 2;
          }
          if (p.travelState === 2) {
            let host = flocks[p.travelTarget];
            if (!host?.active || host.exiting) {
              host = findTravelHost(f, p) || f; p.travelTarget = host.id;
            }
            if (Math.hypot(p.x - host.x, p.y - host.y) < Math.max(24, (host.radius || 40) * .65)) {
              if (host === f) {
                p.travelState = 0; p.travelTarget = -1; p.nextTrip = elapsed + 12;
              } else transfers.push({ owner: f, particle: p, host });
            }
            // A destination may disappear; never leave a particle stranded.
            if (p.travelAge > 8) { p.travelTarget = f.id; }
            if (p.travelAge > 12) { p.travelState = 0; p.nextTrip = elapsed + 12; }
          }
        }
        let alignX = 0, alignY = 0, repelX = 0, repelY = 0, neighbours = 0;
        const cellX = Math.floor(p.x / cellSize), cellY = Math.floor(p.y / cellSize);
        for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) {
          for (const k of cells.get(`${cellX + gx},${cellY + gy}`) || []) {
            if (k === j) continue;
            const q = members[k], dx = p.x - q.x, dy = p.y - q.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > cellSize * cellSize || d2 < .01) continue;
            alignX += q.vx; alignY += q.vy; neighbours++;
            if (d2 < cellSize * cellSize * .22) {
              repelX += dx / (d2 + 4); repelY += dy / (d2 + 4);
            }
          }
        }
        if (neighbours) { alignX /= neighbours; alignY /= neighbours; }
        const speed = (50 + f.motionLevel * 65 + f.motionPulse * 18 + f.groove * 24) * f.speedScale *
          (.75 + p.tint * .5) * Math.min(width, height) / 390 * rhythm.motionScale;
        const rotation = f.id % 2 ? -1 : 1;
        // These are velocity fields evaluated at the particle's CURRENT
        // position. No particle is assigned an angle or a place on a shape.
        const field = kind => {
          const dx = p.x - f.x, dy = p.y - f.y, r = Math.max(1, Math.hypot(dx, dy));
          const nx = dx / r, ny = dy / r;
          let radial, tangent;
          if (kind === 0 || kind === 1 || kind === 3) {
            const preferred = radius * (kind === 1 ? .85 + p.tint * .13 : .12 + p.distance * .85);
            radial = (preferred - r) * 1.8;
            tangent = speed * rotation * (kind === 0 ? .6 + p.distance * .4 : 1);
            if (kind === 3) radial += Math.sin(t * .65 + p.tint * 1.4) * speed * .65;
            return [f.vx - ny * tangent + nx * radial, f.vy + nx * tangent + ny * radial];
          }
          if (kind === 2) {
            let closest = Infinity, fx = f.x, fy = f.y, ux = Math.cos(f.heading), uy = Math.sin(f.heading);
            for (let k = 0; k < f.trail.length - 1; k++) {
              const a = f.trail[k + 1], b = f.trail[k];
              const sx = b.x - a.x, sy = b.y - a.y, length2 = sx * sx + sy * sy;
              const u = length2 > .01 ? clamp(((p.x - a.x) * sx + (p.y - a.y) * sy) / length2, 0, 1) : 0;
              const x = a.x + sx * u, y = a.y + sy * u, d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
              if (d2 < closest && length2 > .01) {
                closest = d2; fx = x; fy = y; ux = sx / Math.sqrt(length2); uy = sy / Math.sqrt(length2);
              }
            }
            return [ux * speed + (fx - p.x) * 2.2, uy * speed + (fy - p.y) * 2.2];
          }
          // A moving sheet: common forward flow plus a transverse wave, with
          // cohesion keeping it a flock while each individual drifts through it.
          const ux = Math.cos(f.heading), uy = Math.sin(f.heading);
          const cross = dx * -uy + dy * ux;
          const wave = Math.sin((dx * ux + dy * uy) / Math.max(20, radius) * 2 + t * .7) * speed * .4;
          return [f.vx + ux * speed - dx * .65 - uy * (wave - cross * 1.4),
            f.vy + uy * speed - dy * .65 + ux * (wave - cross * 1.4)];
        };
        // Substeps bound acceleration and keep the simulation stable on slow
        // frames. Neighbour alignment acts gently alongside the shared flow.
        const a = field(shape), b = field((shape + 1) % 5);
        const localX = lerp(a[0], b[0], mix) - f.vx, localY = lerp(a[1], b[1], mix) - f.vy;
        const bend = f.beatTurn * .35;
        let flowX = f.vx + localX * Math.cos(bend) - localY * Math.sin(bend);
        let flowY = f.vy + localX * Math.sin(bend) + localY * Math.cos(bend);
        if (neighbours) { flowX = lerp(flowX, alignX, .16); flowY = lerp(flowY, alignY, .16); }
        flowX += repelX * 70; flowY += repelY * 70;
        if (p.travelState === 1) {
          flowX = p.vx * .4 + f.vx * .3 + Math.cos(p.driftAngle) * speed * 1.5;
          flowY = p.vy * .4 + f.vy * .3 + Math.sin(p.driftAngle) * speed * 1.5;
        } else if (p.travelState === 2) {
          const host = flocks[p.travelTarget];
          const dx = host.x - p.x, dy = host.y - p.y, d = Math.max(1, Math.hypot(dx, dy));
          const travelSpeed = Math.min(180, d * 1.6) * rhythm.motionScale;
          flowX = host.vx + dx / d * travelSpeed;
          flowY = host.vy + dy / d * travelSpeed;
        }
        const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
        for (let step = 0; step < steps; step++) {
          let vx = flowX, vy = flowY;
          if (f.exiting) {
            const outward = f.exitStyle % 2 === 1;
            const cx = outward ? f.exitX : width / 2, cy = outward ? f.exitY : height / 2;
            const dx = p.x - cx, dy = p.y - cy, r = Math.max(1, Math.hypot(dx, dy));
            const spin = f.exitStyle >= 2 ? rotation * 2.8 : 0;
            const radial = outward ? 170 + r * 1.4 : -r * 5.5;
            vx = dx / r * radial - dy * spin;
            vy = dy / r * radial + dx * spin;
          } else {
            const margin = Math.min(width, height) * .08;
            vx += (Math.max(0, margin - p.x) - Math.max(0, p.x - width + margin)) * 5;
            vy += (Math.max(0, margin - p.y) - Math.max(0, p.y - height + margin)) * 5;
          }
          let ax = (vx - p.vx) / (f.exiting ? (f.exitStyle % 2 ? .16 : .1) : .48);
          let ay = (vy - p.vy) / (f.exiting ? (f.exitStyle % 2 ? .16 : .1) : .48);
          const limit = f.exiting ? 2600 : 350 * Math.min(width, height) / 390;
          const factor = Math.min(1, limit / Math.max(1, Math.hypot(ax, ay)));
          p.vx += ax * factor * h; p.vy += ay * factor * h;
          p.x += p.vx * h; p.y += p.vy * h;
        }
        recordParticleTail(p, elapsed);
        const mx = f.mirrorType === 1 || f.mirrorType === 3 ? width - p.x : p.x;
        const my = f.mirrorType === 2 || f.mirrorType === 3 ? height - p.y : p.y;
        springAxis(p, 'mirrorX', 'mvx', mx, 10, dt);
        springAxis(p, 'mirrorY', 'mvy', my, 10, dt);
      });
    }
    finishTransfers(transfers);
  }
  function recordParticleTail(p, time) {
    if (time - p.tailTime < 1 / 60 - 1e-6) return;
    const index = p.tailHead * 3;
    p.tail[index] = p.x; p.tail[index + 1] = p.y; p.tail[index + 2] = time;
    p.tailHead = (p.tailHead + 1) % 12;
    p.tailCount = Math.min(12, p.tailCount + 1); p.tailTime = time;
  }
  function drawParticleTail(p, x, y, sx, sy, hue, opacity, radius, now = elapsed) {
    if (p.size < .45 || p.tailCount < 3) return;
    // Follow a short, real trajectory. Stop at a gap or excessive length so
    // fast dispersal cannot turn a soft wake into a long straight whisker.
    const points = [{ x, y, age: 0 }];
    const limit = Math.min(32, 8 + radius * 2), lifetime = .16;
    let length = 0;
    for (let k = 0; k < p.tailCount; k++) {
      const index = ((p.tailHead - 1 - k + 12) % 12) * 3;
      const age = now - p.tail[index + 2];
      if (age > lifetime || age < 0) break;
      const px = x + (p.tail[index] - p.x) * sx, py = y + (p.tail[index + 1] - p.y) * sy;
      const last = points[points.length - 1], distance = Math.hypot(px - last.x, py - last.y);
      if (distance < .65) continue;
      length += distance;
      if (length > limit) break;
      points.push({ x: px, y: py, age });
      if (points.length >= 7) break;
    }
    if (points.length < 3) return;
    ctx.strokeStyle = `hsl(${hue},65%,76%)`; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let from = points[points.length - 1];
    for (let i = points.length - 2; i >= 0; i--) {
      const control = points[i], next = points[Math.max(0, i - 1)];
      const end = i === 0 ? control : { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
      const freshness = Math.max(0, 1 - (control.age + from.age) / (2 * lifetime));
      const strokeWidth = Math.min(1.5, radius * .28) * (.15 + .85 * freshness);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
      if (p.size > 2) { ctx.globalAlpha = opacity * .035 * freshness ** 2; ctx.lineWidth = strokeWidth * 2.8; ctx.stroke(); }
      ctx.globalAlpha = opacity * .15 * freshness ** 2; ctx.lineWidth = strokeWidth; ctx.stroke();
      from = { ...end, age: control.age };
    }
  }
  function drawFlocks() {
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const hue = 285 - backgroundTone * 135;
    const sky = ctx.createLinearGradient(0, 0, width * .3, height);
    sky.addColorStop(0, `hsl(${hue},48%,${3 + backgroundEnergy * 5}%)`);
    sky.addColorStop(1, `hsl(${hue + 35},55%,${7 + backgroundEnergy * 12}%)`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flocks) for (const p of f.particles) {
      if (p.alpha < .005) continue;
      const tone = clamp(p.baseTone + (p.tint - .5) * .28 + f.colorShift + p.strength * .07, 0, 1);
      const hue = (32 + tone * 270 + f.beatHue + 360) % 360;
      const radius = p.size * (.8 + p.strength * 1.15 + f.pulse * .65) * (1 - f.collapse * .65);
      const glow = 12 + radius * 3;
      const colorIndex = Math.round(clamp(tone + f.beatHue / 270, 0, 1) * (glows.length - 1));
      const copies = [[p.x, p.y, 1]];
      if (f.mirrorAlpha * p.mirrorWeight > .005) copies.push([p.mirrorX, p.mirrorY, f.mirrorAlpha * p.mirrorWeight]);
      for (const [x, y, opacity] of copies) {
        const reflectedX = x === p.x ? 1 : (f.mirrorType === 1 || f.mirrorType === 3 ? -1 : 1);
        const reflectedY = y === p.y ? 1 : (f.mirrorType === 2 || f.mirrorType === 3 ? -1 : 1);
        drawParticleTail(p, x, y, reflectedX, reflectedY, hue, p.alpha * opacity, radius);
        ctx.globalAlpha = p.alpha * opacity * (.25 + p.strength * .4);
        ctx.drawImage(glows[colorIndex][2], x - glow, y - glow, glow * 2, glow * 2);
        ctx.globalAlpha = p.alpha * opacity * (.6 + p.strength * .4);
        ctx.fillStyle = `hsl(${hue},${72 + p.tint * 20}%,${60 + p.strength * 20}%)`;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function frame(now) {
    if (!running || document.hidden) return;
    const dt = previous ? Math.min(.1, (now - previous) / 1000) : 1 / 60;
    previous = now; elapsed += dt; update(dt); draw();
    frameId = requestAnimationFrame(frame);
  }
  function switchLane(direction) {
    laneAnimations.forEach(animation => animation.cancel());
    laneAnimations = [];
    laneCanvas.width = canvas.width; laneCanvas.height = canvas.height;
    laneCanvas.getContext('2d').drawImage(canvas, 0, 0);
    mode = mode === 'flocks' ? 'stars' : 'flocks';
    resetSignals(); densityPressure = 0; visibleDensity = 0;
    const isFlocks = mode === 'flocks';
    const title = isFlocks ? '光の群れ' : '星空';
    document.querySelector('#theme-title').textContent = title;
    document.querySelector('#theme-description').textContent = isFlocks ? '音の流れを、光の翼に。' : '音の余韻を、夜空のきらめきに。';
    document.querySelector('#theme-number').textContent = isFlocks ? '01 / 02' : '02 / 02';
    document.querySelector('#intro-title').textContent = isFlocks ? '音を、光の動きに。' : '音を、星空に。';
    canvas.setAttribute('aria-label', isFlocks ? '周波数とリズムに合わせて動く光の球の群れ' : '音に反応して瞬く星空');
    document.querySelector('#previous-mode').setAttribute('aria-label', `前のアニメーション：${isFlocks ? '星空' : '光の群れ'}`);
    document.querySelector('#next-mode').setAttribute('aria-label', `次のアニメーション：${isFlocks ? '星空' : '光の群れ'}`);
    draw();
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && canvas.animate) {
      const timing = { duration: 460, easing: 'cubic-bezier(.22,.7,.25,1)' };
      laneAnimations = [
        laneCanvas.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-direction * 100}%)`, opacity: 0 }], timing),
        canvas.animate([{ transform: `translateX(${direction * 100}%)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], timing)
      ];
    }
    clearTimeout(themeTimer); theme.classList.add('visible');
    themeTimer = setTimeout(() => theme.classList.remove('visible'), 2400);
  }
  document.querySelector('#previous-mode').addEventListener('click', () => switchLane(-1));
  document.querySelector('#next-mode').addEventListener('click', () => switchLane(1));
  startButton.addEventListener('click', start);
  stopButton.addEventListener('click', stop);
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(document.querySelector('#sky'));
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frameId); previous = 0;
    if (document.hidden) {
      if (wake) { wake.release().catch(() => {}); wake = null; }
      if (audio?.state === 'running') audio.suspend().catch(() => {});
    } else if (running) {
      audio?.resume().catch(() => message('音声を再開できませんでした。「終了」の後に「開始」を押してください。'));
      acquireWake(); frameId = requestAnimationFrame(frame);
    }
  });
  window.addEventListener('pagehide', stop);
  resize();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      message('オフラインの準備ができませんでした。オンラインでの観測は利用できます。');
    });
  }
})();

