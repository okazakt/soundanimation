'use strict';
(() => {
  const VERSION = '2026.10.17.1';
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
  const field = document.createElement('canvas');
  const fieldContext = field.getContext('2d');
  let pixels, pixelBands, pixelGains;
  // Coordinate hashing keeps the assignment fixed, including across resizes.
  function hash(x, y, salt) {
    let v = Math.imul(x ^ salt, 374761393) ^ Math.imul(y, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  }
  function prepareField() {
    field.width = canvas.width; field.height = canvas.height;
    pixels = fieldContext.createImageData(field.width, field.height);
    const count = field.width * field.height;
    pixelBands = new Uint16Array(count); pixelGains = new Uint8Array(count);
    for (let y = 0, i = 0; y < field.height; y++) {
      for (let x = 0; x < field.width; x++, i++) {
        const band = Math.floor(hash(x, y, 19820119) * N);
        pixelBands[i] = band;
        // Every pixel can light up. A wide gain range gives bright, sparse peaks.
        pixelGains[i] = Math.round(3 + 252 * Math.pow(hash(x, y, 7331), 18));
        const color = channels[band].color;
        pixels.data[i * 4] = color[0];
        pixels.data[i * 4 + 1] = color[1];
        pixels.data[i * 4 + 2] = color[2];
      }
    }
  }
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
    // Use the pre-adaptation level for the initial flash, then adapt immediately.
    const gamma = lerp(1.3, 2.4, clamp((environment - .018) / (.5 - .018), 0, 1));
    channels.forEach((s, i) => {
      const relative = energies[i] / environment;
      const target = Math.pow(clamp(relative, 0, 1), gamma);
      // Continuous attack/release: approach the target instead of repeatedly
      // undershooting it. Release time constant 1.8s gives a gentle ~5s afterglow.
      const tau = target > s.intensity ? .045 : 1.8;
      s.intensity = lerp(target, s.intensity, Math.exp(-dt / tau));
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
    for (let i = 0; i < pixelBands.length; i++) {
      pixels.data[i * 4 + 3] = channels[pixelBands[i]].intensity * pixelGains[i];
    }
    fieldContext.putImageData(pixels, 0, 0);
    // The field contains one sample per backing-store pixel, including the edges.
    ctx.drawImage(field, 0, 0, width, height);
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
