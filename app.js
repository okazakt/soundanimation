'use strict';
(() => {
  const N = 96;
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
  const radii = [3.2, 2.6, 2, 1.6, 1.2];
  const dusk = ['0B0E26', '281E46', '6E2E42', 'C2593F'].map(rgb);
  const midnight = ['020308', '060A17', '0B132B', '121E3D'].map(rgb);
  const stops = [0, .55, .85, 1];
  let seed = 19820119;
  function random() {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }
  const positions = Array.from({ length: N }, (_, i) => ({
    x: .05 + ((i % 12) + .5 + (random() * 2 - 1) * .38) * .9 / 12,
    y: .05 + (Math.floor(i / 12) + .5 + (random() * 2 - 1) * .38) * .9 / 8
  }));
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const stars = positions.map((position, i) => {
    const p = i / (N - 1) * 4;
    const a = Math.min(3, Math.floor(p));
    const color = palette[a].map((v, c) => Math.round(lerp(v, palette[a + 1][c], p - a)));
    const halo = document.createElement('canvas');
    halo.width = halo.height = 128;
    const h = halo.getContext('2d');
    const gradient = h.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, `rgba(${color},1)`);
    gradient.addColorStop(.2, `rgba(${color},.45)`);
    gradient.addColorStop(1, `rgba(${color},0)`);
    h.fillStyle = gradient; h.fillRect(0, 0, 128, 128);
    return { ...position, color, halo, radius: lerp(radii[a], radii[a + 1], p - a),
      omega: .4 + random() * 1.2, phase: random() * Math.PI * 2,
      baseline: 0, intensity: 0, over: 0 };
  });
  let width = 1, height = 1, running = false, starting = false, demo = false;
  let audio = null, stream = null, source = null, analyser = null, bins = null, bands = [];
  let environment = .15, elapsed = 0, previous = 0, frameId = 0, generation = 0;
  let wake = null, wakePending = false, noticeTimer;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!running) draw();
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
    bands = stars.map((_, i) => {
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
    stars.forEach(s => { s.baseline = s.intensity = s.over = 0; });
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
    intro.classList.remove('hidden'); draw();
  }
  const energies = new Float64Array(N);
  function update(dt) {
    const frames = dt * 60;
    if (!demo) analyser.getByteFrequencyData(bins);
    let squares = 0;
    stars.forEach((s, i) => {
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
    // Use the pre-adaptation level for the initial flash, then adapt immediately.
    const gamma = lerp(1.3, 2.4, clamp((environment - .018) / (.5 - .018), 0, 1));
    stars.forEach((s, i) => {
      const relative = energies[i] / environment;
      const target = Math.pow(clamp(relative, 0, 1), gamma);
      s.intensity = target > s.intensity ? lerp(target, s.intensity, Math.pow(.65, frames)) : s.intensity * Math.pow(.94, frames);
      s.over = Math.max(s.over * Math.pow(.85, frames), clamp((relative - 1) * .5, 0, 1));
    });
    environment = clamp(lerp(current, environment, Math.pow(current <= environment ? .992 : .88, frames)), .018, .5);
  }
  function draw() {
    const k = (1 - Math.cos(2 * Math.PI * (elapsed % 60) / 60)) / 2;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    stops.forEach((stop, i) => sky.addColorStop(stop, `rgb(${dusk[i].map((v, c) => Math.round(lerp(v, midnight[i][c], k)))})`));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    let overSum = 0;
    stars.forEach(s => {
      const idle = .06 + .04 * Math.sin(elapsed * s.omega + s.phase);
      const light = Math.min(1, s.intensity + idle), flash = 1 + s.over * 2;
      const x = s.x * width, y = s.y * height;
      const halo = s.radius * (2 + light * 12) * flash;
      ctx.globalAlpha = light * .45;
      ctx.drawImage(s.halo, x - halo, y - halo, halo * 2, halo * 2);
      ctx.globalAlpha = Math.min(1, .25 + light * .75 + s.over);
      ctx.fillStyle = '#fff'; ctx.beginPath();
      ctx.arc(x, y, s.radius * (.7 + light * 1.4) * flash, 0, Math.PI * 2); ctx.fill();
      if (light > .55 || s.over > .1) {
        const length = s.radius * Math.max(0, light - .55, s.over * .45) * 35 * flash;
        ctx.globalAlpha = clamp((light - .55) * 1.5 + s.over, 0, .8);
        ctx.beginPath();
        ctx.moveTo(x - length, y); ctx.lineTo(x, y - .65); ctx.lineTo(x + length, y); ctx.lineTo(x, y + .65); ctx.closePath();
        ctx.moveTo(x, y - length); ctx.lineTo(x + .65, y); ctx.lineTo(x, y + length); ctx.lineTo(x - .65, y); ctx.closePath(); ctx.fill();
      }
      overSum += s.over;
    });
    if (overSum / N > .1) {
      ctx.globalAlpha = overSum / N * .25; ctx.fillStyle = '#e6f2ff'; ctx.fillRect(0, 0, width, height);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function frame(now) {
    if (!running || document.hidden) return;
    const dt = previous ? Math.min(.1, (now - previous) / 1000) : 1 / 60;
    previous = now; elapsed += dt; update(dt); draw();
    frameId = requestAnimationFrame(frame);
  }
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
