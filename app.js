'use strict';
(() => {
  const VERSION = '2026.10.17.7';
  document.querySelector('#version').textContent = `v${VERSION}`;
  // Spectral channels are shared by pixels; this is not a star count.
  const N = 512;
  const canvas = document.querySelector('#canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const startButton = document.querySelector('#start');
  const stopButton = document.querySelector('#stop');
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
  try { fieldSeed = Number(localStorage.getItem('starlight-seed')) >>> 0; } catch {}
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
          // Keep most stars crisp, including after reroll: 80% / 17% / 3%.
          softness: hash(x, y, 7561) < .8 ? 0 : hash(x, y, 7561) < .97 ? 1 : 2,
          gain: .15 + .85 * Math.pow(hash(x, y, 451), 1.4),
          // Stable random response per light avoids frame-to-frame static.
          threshold: .08 + .34 * hash(x, y, 1723),
          sensitivity: (.65 + 1.15 * hash(x, y, 6197)) * tuning.sensitivity,
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
    signals.fill(0); historyCount = 0; signalTime = 0;
    meteors = []; meteorCooldown = 0; flowAngle = Math.PI / 3;
    lights.forEach(light => { light.intensity = 0; light.meteorReady = true; light.meteorRest = 0; });
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
      message('マイクへのアクセスを許可すると、音に反応して星が瞬きます（デモモードで動作中）');
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
    for (const light of lights) {
      // Match unsmoothed input first; apply afterglow only after coincidence.
      const target = matchedSignal(light);
      const tau = target > light.intensity ? .045 : 1.8;
      light.intensity = lerp(target, light.intensity, Math.exp(-dt / tau));
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
  function reroll() {
    fieldSeed = (fieldSeed + 1 + Math.floor(Math.random() * 0xfffffffe)) >>> 0;
    try { localStorage.setItem('starlight-seed', String(fieldSeed)); } catch {}
    prepareField(); resetSignals(); densityPressure = 0; visibleDensity = 0;
    draw(); message('星の配置・音の組み合わせ・光のバランスを振り直しました');
  }
  function lightStrength(light) {
    const intensity = light.intensity;
    const response = clamp((intensity - light.threshold) /
      (1 - light.threshold) * light.sensitivity, 0, 1);
    return Math.pow(response, light.responseCurve);
  }
  function draw() {
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

  function frame(now) {
    if (!running || document.hidden) return;
    const dt = previous ? Math.min(.1, (now - previous) / 1000) : 1 / 60;
    previous = now; elapsed += dt; update(dt); draw();
    frameId = requestAnimationFrame(frame);
  }
  startButton.addEventListener('click', start);
  stopButton.addEventListener('click', stop);
  document.querySelector('#reroll').addEventListener('click', reroll);
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

