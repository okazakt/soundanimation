'use strict';
(() => {
  const VERSION = '2026.10.18.20';
  document.querySelector('#version').textContent = `v${VERSION}`;
  // Spectral channels are shared by pixels; this is not a star count.
  const N = 512;
  const canvas = document.querySelector('#canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const startButton = document.querySelector('#start');
  const stopButton = document.querySelector('#stop');
  const microphoneButton = document.querySelector('#choose-microphone');
  const microphoneName = document.querySelector('#microphone-name');
  const microphoneDialog = document.querySelector('#microphone-dialog');
  const microphoneChoices = document.querySelector('#microphone-choices');
  const microphonePrompt = document.querySelector('#microphone-prompt');
  const engineSelect = document.querySelector('#analysis-engine');
  let beatNetClient = null, beatNetState = null, beatNetStatus = '開始するとBeatNetを準備します';
  const setupComplete = () => !window.ModelSetup || window.ModelSetup.complete;
  if (!setupComplete()) startButton.disabled = true;
  let beatThisStorageStatus = window.ModelSetup?.complete ? '端末に保存済み・再読み込み後も再利用' : 'Beat This!の保存状態を確認中';
  let aiActive = false, aiLastTick = -100, aiMotionScale = 1, aiMotionLimit = 1;
  const isBeatThis = () => engineSelect.value === 'beat-this';
  const aiLabel = () => isBeatThis() ? 'Beat This!' : 'BeatNet';
  const wantsBeatNet = () => engineSelect.value !== 'basic';
  function resetBeatNet() {
    beatNetClient?.stop(); beatNetClient = null; beatNetState = null;
    aiActive = false; aiLastTick = -100; aiMotionScale = aiMotionLimit = 1;
    beatNetStatus = wantsBeatNet() ? `開始すると${aiLabel()}を準備します` : '従来方式';
    if (running && !demo && audio && source) beginBeatNet();
  }
  function beginBeatNet() {
    if (!wantsBeatNet()) return;
    const Client = isBeatThis() ? window.BeatThisClient : window.BeatNetClient;
    if (!Client) { beatNetStatus = `${aiLabel()}未対応・従来方式で継続`; return; }
    const token = generation;
    const client = new Client(state => {
      if (token !== generation || client !== beatNetClient) return;
      beatNetState = state;
      if (!state) return;
      if (isBeatThis()) return;
      beatNetStatus = state.time > 2 && state.beatCount >= 6 && state.confidence > .55 ? '解析中' : '解析中・拍の学習待ち';
    }, status => { if (token === generation && client === beatNetClient) beatNetStatus = status; }, storage => { if (token === generation && client === beatNetClient) beatThisStorageStatus = storage; });
    beatNetClient = client;
    client.start(audio, source).catch(error => {
      if (token !== generation || client !== beatNetClient) return;
      beatNetStatus = `${error.message}・従来方式で継続`; client.stop();
    });
  }
  function selectRhythmEngine(dt) {
    const state = beatNetState, now = audio?.currentTime;
    const period = state?.bpm ? 60 / state.bpm : .5;
    const delayed = isBeatThis();
    const fresh = state && Number.isFinite(now) && now - state.audioTime < (delayed ? 12 : .75) && now >= state.audioTime - .1 &&
      (!delayed || now - state.receivedAudioTime < 8);
    const quiet = delayed ? basicRhythm.quiet : state?.quiet;
    const supported = fresh && state.time > 2 && state.beatCount >= 6 && state.bpm >= 55 && state.bpm <= 215 &&
      quiet < Math.max(.6, period * 1.4) && now - state.lastBeatAudioTime < (delayed ? 12 : 8);
    aiActive = !!(wantsBeatNet() && !beatNetClient?.stopped && supported && state.confidence > (aiActive ? .3 : .55));
    if (!aiActive) { rhythm = basicRhythm; return; }
    const age = Math.max(0, now - state.lastBeatAudioTime), predicted = Math.floor(age / period), phase = age / period % 1;
    const tick = state.lastBeatAudioTime + predicted * period;
    const beat = tick - aiLastTick > period * .6;
    if (beat) aiLastTick = tick;
    const meter = state.meterConfidence > .6 ? state.meter : 0;
    const beatInBar = meter ? ((state.beatInBar - 1 + predicted) % meter + meter) % meter + 1 : 0;
    const tempoSpeed = clamp(Math.pow(state.bpm / 120, 1.2), .5, 1.65);
    aiMotionScale = lerp(aiMotionScale, lerp(1, tempoSpeed, state.confidence), 1 - Math.exp(-dt / 1.2));
    aiMotionLimit = lerp(aiMotionLimit, clamp(tempoSpeed, .45, 1.65), 1 - Math.exp(-dt / 2));
    rhythm = { ...basicRhythm, engine: delayed ? 'beat-this' : 'beatnet', bpm: state.bpm, period, confidence: state.confidence,
      tracking: true, phase, pulse: Math.exp(-phase * 9), beat, beatCount: state.beatCount + predicted,
      lastBeat: basicRhythm.time - phase * period, nextBeat: basicRhythm.time + (1 - phase) * period,
      lastSupport: basicRhythm.time - age, evidence: Math.max(state.beatProbability, state.downProbability),
      meter, meterConfidence: state.meterConfidence, beatInBar,
      motionScale: aiMotionScale, motionLimitScale: aiMotionLimit };
  }
  engineSelect.addEventListener('change', () => { resetBeatNet(); rhythm = basicRhythm; updateDebug(true); });
  const microphoneConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  let selectedMicrophone = null, selectionRequired = false, pickerGeneration = 0;
  let resumeAfterSelection = false;
  let microphonePickerReason = '';
  const microphoneInputs = devices => devices.filter(device => device.kind === 'audioinput' && device.deviceId);
  function renderMicrophones(devices) {
    const choices = microphoneInputs(devices).map((device, i) => {
      const button = document.createElement('button');
      const label = device.label || `マイク ${i + 1}`;
      button.type = 'button'; button.textContent = label;
      button.setAttribute('aria-pressed', String(device.deviceId === selectedMicrophone?.deviceId));
      button.addEventListener('click', () => {
        const resume = running || resumeAfterSelection;
        if (running) stop();
        selectedMicrophone = { deviceId: device.deviceId, label };
        selectionRequired = false; microphoneName.textContent = label;
        startButton.disabled = false; microphoneDialog.close();
        if (resume) return start();
      });
      return button;
    });
    microphoneChoices.replaceChildren(...choices);
    microphonePrompt.textContent = microphonePickerReason + (choices.length ? '使用するマイクを選んでください。' : '利用できるマイクがありません。接続してから開き直してください。');
  }
  async function openMicrophonePicker(requestPermission = true, reason = '') {
    if (!setupComplete()) return;
    const token = ++pickerGeneration;
    microphonePickerReason = reason;
    let permissionStream;
    microphoneChoices.replaceChildren();
    microphonePrompt.textContent = reason + 'マイクを確認中…';
    if (!microphoneDialog.open) microphoneDialog.showModal();
    startButton.disabled = true;
    try {
      const media = navigator.mediaDevices;
      if (!media?.enumerateDevices) throw new Error('unsupported');
      let devices = await media.enumerateDevices();
      if (token !== pickerGeneration) return;
      if (requestPermission && !stream && !microphoneInputs(devices).some(device => device.label)) {
        permissionStream = await media.getUserMedia({ audio: microphoneConstraints, video: false });
        if (token !== pickerGeneration) return;
        devices = await media.enumerateDevices();
      }
      if (token === pickerGeneration) renderMicrophones(devices);
    } catch {
      if (token === pickerGeneration) microphonePrompt.textContent = reason + 'マイク一覧を取得できませんでした。マイクの許可と接続を確認してください。';
    } finally {
      permissionStream?.getTracks().forEach(track => track.stop());
    }
  }
  function microphoneLost() {
    resumeAfterSelection = running;
    stop(); selectedMicrophone = null; selectionRequired = true;
    microphoneName.textContent = 'マイクを再選択してください'; startButton.disabled = true;
    message('使用中のマイクを利用できなくなりました。最新の一覧から選び直してください。', 8000);
    return openMicrophonePicker(false, '使用中のマイクを利用できなくなりました。');
  }
  microphoneButton.addEventListener('click', () => {
    resumeAfterSelection = false;
    return openMicrophonePicker();
  });
  document.querySelector('#close-microphone-dialog').addEventListener('click', () => microphoneDialog.close());
  microphoneDialog.addEventListener('close', () => {
    if (microphoneDialog.open) return;
    ++pickerGeneration; resumeAfterSelection = false;
    startButton.disabled = running || starting || selectionRequired;
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
    const token = generation, selectedId = selectedMicrophone?.deviceId;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (token !== generation || selectedId !== selectedMicrophone?.deviceId) return;
      if (selectedId && !microphoneInputs(devices).some(device => device.deviceId === selectedId)) {
        await microphoneLost(); return;
      }
      if (microphoneDialog.open) renderMicrophones(devices);
    } catch { /* A failed query does not establish that the input disappeared. */ }
  });
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
    prepareFlocks(); resetRhythm(); resetMood(); resetSoundProfile(); resetBeatNet();
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
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
    if (!setupComplete()) return;
    if (running || starting) return;
    if (selectionRequired) return openMicrophonePicker();
    const token = ++generation;
    starting = true; startButton.disabled = true; stopButton.disabled = false;
    microphoneButton.disabled = true;
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
      const requestedDevice = selectedMicrophone?.deviceId;
      const constraints = { audio: { ...microphoneConstraints }, video: false };
      if (requestedDevice) constraints.audio.deviceId = { exact: requestedDevice };
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (token !== generation) {
        localStream.getTracks().forEach(track => track.stop());
        await localAudio.close().catch(() => {}); return;
      }
      const track = localStream.getAudioTracks()[0];
      const actual = track?.getSettings?.().deviceId;
      if (requestedDevice && actual && actual !== requestedDevice) throw new Error('selected-unavailable');
      const label = track?.label || selectedMicrophone?.label || '自動選択のマイク';
      selectedMicrophone = { deviceId: requestedDevice || actual || '', label };
      microphoneName.textContent = label;
      stream = localStream;
      analyser = localAudio.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = .15;
      bins = new Uint8Array(analyser.frequencyBinCount);
      source = localAudio.createMediaStreamSource(stream); source.connect(analyser);
      // Intentionally do not connect the microphone to speakers.
      configureBands(); demo = false;
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (running && token === generation) microphoneLost();
      }));
    } catch (error) {
      localStream?.getTracks().forEach(track => track.stop());
      if (localAudio && localAudio.state !== 'closed') await localAudio.close().catch(() => {});
      if (token !== generation) return;
      if (selectedMicrophone?.deviceId) {
        await microphoneLost(); return;
      }
      audio = null; stream = null; source = null; analyser = null; demo = true;
      microphoneName.textContent = 'マイク未使用（デモ）';
      message('マイクへのアクセスを許可すると、音に反応して光が動きます（デモモードで動作中）');
    }
    if (token !== generation) return;
    starting = false; running = true; startButton.textContent = '開始';
    microphoneButton.disabled = false;
    intro.classList.add('hidden'); previous = 0;
    if (!demo) beginBeatNet(); else beatNetStatus = 'デモ入力・従来方式';
    acquireWake(); frameId = requestAnimationFrame(frame);
  }
  function stop() {
    if (microphoneDialog.open) microphoneDialog.close();
    ++pickerGeneration;
    ++generation; running = false; starting = false;
    cancelAnimationFrame(frameId);
    beatNetClient?.stop(); beatNetClient = null;
    source?.disconnect(); source = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    if (audio && audio.state !== 'closed') audio.close().catch(() => {});
    audio = null; analyser = null; bins = null;
    if (wake) { wake.release().catch(() => {}); wake = null; }
    clearTimeout(noticeTimer); notice.classList.remove('visible');
    startButton.disabled = selectionRequired || !setupComplete(); startButton.textContent = '開始'; stopButton.disabled = true;
    microphoneButton.disabled = false;
    channels.forEach(s => { s.intensity = 0; });
    resetSignals();
    intro.classList.remove('hidden'); updateDebug(true); draw();
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
    rhythm = basicRhythm; updateRhythm(dt); selectRhythmEngine(dt); updateMood(dt); updateDebug();
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
  const basicRhythm = { engine: 'basic', time: 0, lastOnset: -10, lastBeat: -10, nextBeat: 0,
    period: .5, bpm: 0, confidence: 0, phase: 0, pulse: 0, beatCount: 0, motionScale: 1, motionLimitScale: 1, lastReliableBpm: 0, lastReliableTime: -100,
    fluxAverage: 0, quiet: 0, onset: false, beat: false,
    tempoCandidate: 0, tempoCandidateSince: 0, tempoCandidateCount: 0, tracking: false, lastSupport: -100, phaseCoherence: 0, evidence: 0, pendingTempo: 0, pendingTempoSince: 0, pendingTempoCount: 0,
    meterCandidate: '', meterCandidateCount: 0, meterLastEvaluated: -Infinity,
    meterTracking: false, meterScores: [0, 0], meterLastSupport: -100, meterFit: 0, meterMargin: 0,
    meter: 0, meterConfidence: 0, beatInBar: 0, downbeatOffset: 0, accents: [],
    previous: new Float64Array(N), pitchClasses: [], pitchMaximum: 0, votes: new Float64Array(181), events: [], featureHistory: [] };
  let rhythm = basicRhythm;
  function resetRhythm() {
    rhythm = basicRhythm;
    Object.assign(rhythm, { time: 0, lastOnset: -10, lastBeat: -10, nextBeat: 0,
      period: .5, bpm: 0, confidence: 0, phase: 0, pulse: 0, beatCount: 0, motionScale: 1, motionLimitScale: 1, lastReliableBpm: 0, lastReliableTime: -100,
      fluxAverage: 0, quiet: 0, onset: false, beat: false,
      tempoCandidate: 0, tempoCandidateSince: 0, tempoCandidateCount: 0, tracking: false, lastSupport: -100, phaseCoherence: 0, evidence: 0, pendingTempo: 0, pendingTempoSince: 0, pendingTempoCount: 0,
      meterCandidate: '', meterCandidateCount: 0, meterLastEvaluated: -Infinity,
      meterTracking: false, meterScores: [0, 0], meterLastSupport: -100, meterFit: 0, meterMargin: 0,
      meter: 0, meterConfidence: 0, beatInBar: 0, downbeatOffset: 0, accents: [] });
    rhythm.previous.fill(0); rhythm.votes.fill(0); rhythm.events = []; rhythm.featureHistory = [];
  }
  // Beat-synchronous multiband novelty + harmonic change; keep weak beats
  // and offbeat patterns as evidence instead of requiring a detected onset.
  // Inspired by Krebs et al. (ISMIR 2016), using hand-built observations rather
  // than their trained networks/DBN. Scores below are heuristics, not probabilities.
  function trackMeter(features, time = rhythm.time, scale = 1) {
    const r = rhythm;
    if (!r.tracking || r.confidence < .25) return;
    const offset = (time - (r.nextBeat - r.period)) / r.period;
    const nearest = Math.round(offset), onBeat = Math.abs(offset - nearest) < .27;
    const index = r.beatCount + (onBeat ? nearest : Math.floor(offset));
    let observation = r.accents.find(a => a.index === index);
    if (!observation) {
      observation = { index, features: Array(8).fill(0), chroma: Array(12).fill(0) }; r.accents.push(observation);
    }
    const start = onBeat ? 0 : 4;
    for (let k = 0; k < 4; k++) observation.features[start + k] += features[k] * scale;
    for (let k = 0; k < 12; k++) observation.chroma[k] += features[k + 4] * scale;
    r.accents = r.accents.filter(a => r.beatCount - a.index <= 48 && a.index <= r.beatCount + 1);
  }
  function meterObservationWeight(a, newest) {
    // Missing percussion is weak evidence, not a strong contradictory accent.
    const reliability = a.features[0] > .001 || a.features[3] > .001 ? 1 : .2;
    return reliability * Math.exp((a.index - newest) / 14);
  }
  function meterModel(samples, meter) {
    if (samples.length < meter * 3) return { fit: 0, offset: 0, channelFits: Array(8).fill(0), channelWeights: Array(8).fill(0) };
    const newest = samples[samples.length - 1].index;
    const counts = Array(meter).fill(0), weights = Array(meter).fill(0);
    const sums = Array.from({ length: meter }, () => Array(8).fill(0));
    for (const a of samples) {
      const pos = ((a.index % meter) + meter) % meter, w = meterObservationWeight(a, newest);
      counts[pos]++; weights[pos] += w;
      a.features.forEach((v, k) => { sums[pos][k] += v * w; });
    }
    if (counts.some(n => n < 2)) return { fit: 0, offset: 0, channelFits: Array(8).fill(0), channelWeights: Array(8).fill(0) };
    const means = sums.map((row, pos) => row.map(v => v / weights[pos]));
    const channelWeights = [1, 1.2, .7, 1, .5, .6, .35, .5];
    let score = 0, totalWeight = 0;
    const salience = Array(meter).fill(0), channelFits = Array(8).fill(0), evidenceWeights = Array(8).fill(0);
    for (let k = 0; k < 8; k++) {
      let sum = 0, total = 0;
      for (const a of samples) { const w = meterObservationWeight(a, newest); sum += a.features[k] * w; total += w; }
      const mean = sum / total;
      if (mean < .0005) continue;
      let variance = 0, error = 0;
      for (const a of samples) {
        const w = meterObservationWeight(a, newest), pos = ((a.index % meter) + meter) % meter;
        const v = a.features[k];
        // Leave-one-out prediction rewards patterns repeating across bars,
        // while random accents and overfitted short patterns lose evidence.
        const prediction = (sums[pos][k] - v * w) / Math.max(.001, weights[pos] - w);
        variance += w * (v - mean) ** 2; error += w * (v - prediction) ** 2;
      }
      const contrast = clamp(Math.sqrt(variance / total) / (mean + .002) / .4, 0, 1);
      const fit = clamp(1 - error / Math.max(1e-8, variance), 0, 1);
      const weight = channelWeights[k] * contrast;
      channelFits[k] = fit; evidenceWeights[k] = weight * fit;
      // A noisy/uninformative channel supplies little evidence; it should
      // not veto a recurring bass or harmonic pattern in another channel.
      score += weight * fit * fit; totalWeight += weight * fit;
      if (k < 4) for (let pos = 0; pos < meter; pos++) {
        const downbeatWeight = k === 1 || k === 3 ? 1.5 : k === 2 ? .25 : .7;
        salience[pos] += fit * contrast * downbeatWeight * means[pos][k] / mean;
      }
    }
    return { fit: totalWeight > .1 ? score / totalWeight : 0,
      offset: salience.indexOf(Math.max(...salience)), channelFits, channelWeights: evidenceWeights };
  }
  function evaluateMeter() {
    const r = rhythm, finished = r.beatCount - 1;
    if (!r.tracking || finished <= r.meterLastEvaluated) return;
    r.meterLastEvaluated = finished;
    const samples = r.accents.filter(a => a.index <= finished).sort((a, b) => a.index - b.index);
    // Harmonic changes compare beat-averaged chroma, suppressing the frame
    // noise and percussion transients that dominate adjacent-frame differences.
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].index - samples[i - 1].index !== 1) continue;
      const a = samples[i - 1].chroma, b = samples[i].chroma;
      let dot = 0, normA = 0, normB = 0;
      for (let k = 0; k < 12; k++) { dot += a[k] * b[k]; normA += a[k] ** 2; normB += b[k] ** 2; }
      if (normA > .001 && normB > .001) samples[i].features[3] = clamp(1 - dot / Math.sqrt(normA * normB), 0, 1) * .12;
    }
    const models = [3, 4].map(meter => ({ meter, ...meterModel(samples, meter) }));
    const duple = meterModel(samples, 2);
    // A repeating two-beat pattern alone cannot distinguish 2 from 4.
    const four = models[1];
    let uniqueFour = 0, fourWeight = 0;
    for (let k = 0; k < 8; k++) {
      const w = four.channelWeights[k];
      uniqueFour += w * Math.max(0, four.channelFits[k] - duple.channelFits[k]); fourWeight += w;
    }
    four.fit *= clamp(uniqueFour / Math.max(.001, fourWeight) / .2, 0, 1);
    for (let i = 0; i < 2; i++) r.meterScores[i] = lerp(r.meterScores[i], models[i].fit, .3);
    const ranked = models.map((model, i) => ({ ...model, score: r.meterScores[i] }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0], margin = best.score - ranked[1].score;
    r.meterFit = best.score; r.meterMargin = margin;
    if (best.score > .45 && margin > .12) {
      const candidate = `${best.meter}:${best.offset}`;
      if (r.meterCandidate !== candidate) { r.meterCandidate = candidate; r.meterCandidateCount = 0; }
      r.meterCandidateCount++;
      const same = r.meter === best.meter && r.downbeatOffset === best.offset;
      // A new meter/phase must win repeatedly; a fill cannot flip the bar clock.
      if (same || r.meterCandidateCount >= (r.meterConfidence > .45 ? best.meter * 2 : 2)) {
        const confidence = best.score * clamp(margin / .3, 0, 1);
        r.meterConfidence = same ? lerp(r.meterConfidence, confidence, .2) : confidence * .75;
        r.meter = best.meter; r.downbeatOffset = best.offset; r.meterLastSupport = r.time;
        if (!same) r.meterTracking = false;
        if (r.meterConfidence > .6) r.meterTracking = true;
      }
    } else {
      r.meterCandidateCount = 0;
      r.meterConfidence *= .97;
    }
  }
  function updateRhythm(dt) {
    const r = rhythm;
    r.time += dt; r.onset = false; r.beat = false;
    let flux = 0, level = 0, bassFlux = 0, highFlux = 0;
    const chroma = new Float64Array(12);
    const maximum = audio ? Math.min(14000, audio.sampleRate / 2) : 14000;
    if (r.pitchMaximum !== maximum) {
      r.pitchMaximum = maximum;
      r.pitchClasses = Array.from({ length: N }, (_, i) => {
        const hz = 40 * Math.pow(maximum / 40, (i + .5) / N);
        return hz >= 130 && hz <= 2200 ? ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12 : -1;
      });
    }
    for (let i = 0; i < N; i++) {
      const weight = i < 205 ? 1.2 : i < 410 ? 1 : .7;
      // Raw input prevents baseline adaptation from being mistaken for silence.
      const value = Math.max(energies[i], rawEnergies[i]);
      const novelty = Math.max(0, value - r.previous[i]);
      flux += novelty * weight;
      if (i < 170) bassFlux += novelty / 170;
      if (i >= 340) highFlux += novelty / (N - 340);
      const pitch = r.pitchClasses[i];
      if (pitch >= 0) chroma[pitch] += value * value;
      level += value; r.previous[i] = value;
    }
    flux /= N; level /= N;
    const norm = Math.sqrt(chroma.reduce((sum, v) => sum + v * v, 0));
    const features = [flux, bassFlux, highFlux, 0, ...Array.from(chroma, value => norm ? value / norm : 0)];
    const bucket = Math.floor(r.time * 20);
    let history = r.featureHistory[r.featureHistory.length - 1];
    if (!history || history.bucket !== bucket) {
      history = { bucket, time: (bucket + .5) / 20, features: Array(16).fill(0) };
      r.featureHistory.push(history);
    }
    for (let k = 0; k < 16; k++) history.features[k] += features[k] * dt;
    r.featureHistory = r.featureHistory.filter(sample => r.time - sample.time < 12);
    r.quiet = level > .003 ? 0 : r.quiet + dt;
    const onset = flux > .006 && flux > r.fluxAverage * 2.2 + .002 && r.time - r.lastOnset > .19;
    r.fluxAverage = lerp(flux, r.fluxAverage, Math.exp(-dt / .65));
    const voteDecay = Math.exp(-dt / 5);
    for (let bpm = 60; bpm <= 180; bpm++) r.votes[bpm] *= voteDecay;
    r.events = r.events.filter(event => r.time - event.time < 12);
    if (onset) {
      r.onset = true; r.lastOnset = r.time;
      for (let j = r.events.length - 1; j >= Math.max(0, r.events.length - 16); j--) {
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
      r.events.push({ time: r.time, features, strength: flux });
      let phaseSupport = 0;
      if (r.tracking) {
        let supporting = 0, total = 0;
        for (const event of r.events.slice(-16)) {
          const w = Math.sqrt(event.strength) * Math.exp((event.time - r.time) / 4);
          const cycles = (event.time - r.nextBeat) / r.period;
          supporting += w * (Math.abs(cycles - Math.round(cycles)) < .2 ? 1 : 0); total += w;
        }
        phaseSupport = supporting / Math.max(.001, total);
        r.phaseCoherence = phaseSupport;
        if (phaseSupport > .55) r.lastSupport = r.time;
      }
      let winner = 0, best = 0, runner = 0;
      for (let bpm = 60; bpm <= 180; bpm++) {
        const distance = r.bpm ? Math.log(bpm / r.bpm) : 10;
        const prior = r.tracking ? 1 + .45 * Math.exp(-.5 * (distance / .075) ** 2) : 1;
        const score = r.votes[bpm] * prior;
        if (score > best) { best = score; winner = bpm; }
      }
      for (let bpm = 60; bpm <= 180; bpm++) if (Math.abs(bpm - winner) > Math.max(7, winner * .08)) {
        const distance = r.bpm ? Math.log(bpm / r.bpm) : 10;
        const prior = r.tracking ? 1 + .45 * Math.exp(-.5 * (distance / .075) ** 2) : 1;
        runner = Math.max(runner, r.votes[bpm] * prior);
      }
      if (winner && r.events.length >= 4) {
        const period = 60 / winner;
        const recent = r.events.slice(-16);
        let coherent = 0, totalWeight = 0;
        for (const event of recent) {
          const cycles = (r.time - event.time) / period;
          const weight = Math.sqrt(event.strength) * Math.exp((event.time - r.time) / 6);
          const distance = Math.abs(cycles - Math.round(cycles));
          coherent += weight * (distance < .20 ? 1 : Math.abs(distance - .5) < .14 ? .7 : 0);
          totalWeight += weight;
        }
        let certainty = clamp((best - runner) / Math.max(.01, best) * 2, 0, 1) *
          clamp((coherent / Math.max(.001, totalWeight) - .55) / .4, 0, 1) * clamp((recent.length - 2) / 4, 0, 1);
        {
          if (!r.tempoCandidate || Math.abs(Math.log(winner / r.tempoCandidate)) > .04) {
            r.tempoCandidate = winner; r.tempoCandidateSince = r.time; r.tempoCandidateCount = 0;
          }
          r.tempoCandidateCount++;
          // Repeated moderate evidence for the same tempo can establish a
          // clock even when subdivisions keep any single observation unsure.
          const persistence = clamp((r.time - r.tempoCandidateSince - 2) / 4, 0, 1) * clamp((r.tempoCandidateCount - 6) / 8, 0, 1);
          const regularity = clamp((coherent / Math.max(.001, totalWeight) - .62) / .18, 0, 1);
          const separation = clamp(((best - runner) / Math.max(.01, best) - .06) / .16, 0, 1);
          certainty = Math.max(certainty, .7 * persistence * regularity * separation);
        }
        const wasLocked = r.tracking;
        r.evidence = certainty;
        const supportedCertainty = wasLocked ? Math.max(certainty, clamp((phaseSupport - .4) / .5, 0, 1) * .85) : certainty;
        r.confidence = lerp(r.confidence, supportedCertainty, wasLocked ? .08 : .4);
        if (!r.tracking && r.confidence > .5) { r.tracking = true; r.lastSupport = r.time; }
        const change = r.bpm ? Math.abs(Math.log(winner / r.bpm)) : 0;
        if (wasLocked && change < .05 && certainty > .45) r.lastSupport = r.time;
        if (wasLocked && change > .12 && certainty > .35) {
          if (Math.abs(r.pendingTempo - winner) > winner * .06) {
            r.pendingTempo = winner; r.pendingTempoSince = r.time; r.pendingTempoCount = 0;
          }
          r.pendingTempoCount++;
        } else if (change <= .12) { r.pendingTempo = 0; r.pendingTempoCount = 0; }
        const allowChange = !wasLocked || change <= .12 ||
          (r.pendingTempoCount >= 4 && r.time - r.pendingTempoSince >= 2);
        if (certainty > .3 && allowChange) {
          // Median recent intervals ignore early/late individual hits and
          // bridge missing beats, while following a gradual human tempo drift.
          const intervals = [];
          const aligned = recent.filter(event => {
            const cycles = (event.time - r.nextBeat) / r.period;
            return Math.abs(cycles - Math.round(cycles)) < .2;
          });
          const timingEvents = wasLocked && change <= .12 && aligned.length >= 4 ? aligned : recent;
          const addInterval = gap => {
            const beats = Math.max(1, Math.round(gap / period));
            const sample = gap / beats;
            if (Math.abs(sample - period) < period * .23) intervals.push(sample);
          };
          if (timingEvents === aligned) {
            // Spans of several beats average out FFT/render-frame timing
            // jitter; a single short interval must not bend a stable clock.
            for (let i = 1; i < aligned.length; i++) for (let j = 0; j < i; j++) {
              const gap = aligned[i].time - aligned[j].time;
              if (gap >= period * 1.5 && gap <= period * 8.5) addInterval(gap);
            }
          } else for (let i = 1; i < timingEvents.length; i++) addInterval(timingEvents[i].time - timingEvents[i - 1].time);
          intervals.sort((a, b) => a - b);
          const middle = Math.floor(intervals.length / 2);
          const median = intervals.length ? (intervals[middle] + intervals[Math.max(0, Math.ceil(intervals.length / 2) - 1)]) / 2 : period;
          const candidate = lerp(winner, 60 / median, wasLocked && timingEvents === aligned ? .9 : .45);
          const hadTempo = r.bpm > 0;
          r.bpm = wasLocked ? lerp(r.bpm, candidate, .2) : candidate;
          r.period = 60 / r.bpm;
          if (!hadTempo) {
            // Choose a strong recent onset as phase anchor; subdivisions must
            // not restart the provisional clock on every observation.
            const anchor = recent.reduce((best, event) => event.strength > best.strength ? event : best).time;
            r.nextBeat = anchor + (Math.floor((r.time - anchor) / r.period) + 1) * r.period;
          } else {
            const nearest = r.nextBeat + Math.round((r.time - r.nextBeat) / r.period) * r.period;
            const error = r.time - nearest;
            if (Math.abs(error) < r.period * .27) r.nextBeat += clamp(error, -.085, .085) * .2;
          }
        }
      }
    }
    const stale = r.time - r.lastSupport > 8;
    const silent = r.quiet > (r.tracking ? Math.max(.6, r.period * 1.4) : .6);
    // Acquisition and release have different thresholds. A poor single
    // observation cannot erase a few bars of supporting history.
    if (silent) r.confidence *= Math.exp(-dt / .45);
    else if (r.tracking && !stale) r.confidence = Math.max(.38, r.confidence);
    else if (r.time - r.lastOnset > 2 || (r.tracking && stale)) r.confidence *= Math.exp(-dt / 2);
    if (r.tracking && r.confidence < .22) {
      r.tracking = false; r.accents = []; r.meterCandidateCount = 0;
      r.meterScores = [0, 0]; r.meter = 0; r.meterConfidence = 0; r.meterTracking = false;
    }
    if (r.tracking && r.confidence > .25 && !silent) {
      while (r.nextBeat <= r.time) {
        if (r.time - r.lastBeat > r.period * .6) { r.beat = true; r.lastBeat = r.nextBeat; r.beatCount++; }
        r.nextBeat += r.period;
      }
      r.phase = ((r.time - (r.nextBeat - r.period)) / r.period + 1) % 1;
      r.pulse = Math.exp(-r.phase * 9);
      // Average novelty over sub-beat windows rather than trusting one noisy
      // FFT peak. The bounded 20 Hz history also includes previously weak beats.
      if (!r.accents.length) {
        for (const sample of r.featureHistory) trackMeter(sample.features, sample.time, 4 / r.period);
      } else trackMeter(features, r.time, 4 * dt / r.period);
      evaluateMeter();
    } else { r.pulse *= Math.exp(-dt / .18); }
    if (!r.tracking && r.confidence < .03 && r.time - r.lastOnset > 3) {
      r.bpm = 0; r.events = []; r.votes.fill(0);
    }
    if (r.meterTracking && !silent && r.time - r.meterLastSupport < 12) r.meterConfidence = Math.max(.55, r.meterConfidence);
    if (silent) r.meterConfidence *= Math.exp(-dt / .5);
    else if (r.time - r.meterLastSupport > 8) r.meterConfidence *= Math.exp(-dt / 10);
    if (r.meterConfidence < .15 || !r.tracking) { r.beatInBar = 0; }
    else r.beatInBar = ((r.beatCount - r.downbeatOffset) % r.meter + r.meter) % r.meter + 1;
    const tempoSpeed = r.bpm ? clamp(Math.pow(r.bpm / 120, 1.2), .5, 1.65) : 1;
    r.motionScale = lerp(lerp(1, tempoSpeed, r.confidence), r.motionScale, Math.exp(-dt / 1.2));
    if (r.bpm && r.confidence > .45) { r.lastReliableBpm = r.bpm; r.lastReliableTime = r.time; }
    const remembered = r.time - r.lastReliableTime < 15 ? r.lastReliableBpm : 0;
    const ceiling = remembered ? clamp(Math.pow(remembered / 120, 1.2), .45, 1.65) : 1;
    r.motionLimitScale = lerp(ceiling, r.motionLimitScale, Math.exp(-dt / 2));
  }

  // Musical mood is a slow, uncertain audio-feature estimate, not a claim
  // about the listener's emotion or the meaning of lyrics.
  const mood = { warmth: 0, activity: .35, tension: .2, confidence: 0,
    brightness: 0, flatness: 0, keyBias: 0, time: 0, analysisTime: 0, colourBiasGain: 1, colourStage: 0, colourAge: 0, colourCycle: 0, nextColourRelease: 10, colourOut: 2, colourHold: 2, colourReturn: 3, chroma: new Float64Array(12) };
  const majorProfile = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const minorProfile = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
  function resetMood() {
    Object.assign(mood, { warmth: 0, activity: .35, tension: .2, confidence: 0,
      brightness: 0, flatness: 0, keyBias: 0, time: 0, analysisTime: 0, colourBiasGain: 1, colourStage: 0, colourAge: 0, colourCycle: 0, nextColourRelease: 10, colourOut: 2, colourHold: 2, colourReturn: 3 }); mood.chroma.fill(0);
  }
  function tonalScore(profile, root) {
    const mean = mood.chroma.reduce((a, b) => a + b, 0) / 12;
    const pmean = profile.reduce((a, b) => a + b, 0) / 12;
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < 12; i++) {
      const x = mood.chroma[(i + root) % 12] - mean, y = profile[i] - pmean;
      xy += x * y; xx += x * x; yy += y * y;
    }
    return xy / Math.max(1e-9, Math.sqrt(xx * yy));
  }
  function updateColourBreath(dt, audible) {
    const m = mood;
    if (!audible) {
      m.colourStage = 0; m.colourAge = 0; m.nextColourRelease = m.time + 10;
      m.colourBiasGain = lerp(1, m.colourBiasGain, Math.exp(-dt / .8)); return;
    }
    if (m.colourStage === 0) {
      m.colourBiasGain = lerp(1, m.colourBiasGain, Math.exp(-dt / .8));
      if (m.time < m.nextColourRelease) return;
      const boundary = rhythm.confidence < .35 || (rhythm.beat &&
        (rhythm.meterConfidence < .5 || rhythm.beatInBar === 1));
      if (!boundary && m.time - m.nextColourRelease < 2.2) return;
      m.colourStage = 1; m.colourAge = 0; m.colourCycle++;
      const period = rhythm.confidence > .35 ? rhythm.period : .55;
      m.colourOut = clamp(period * 4, 1.8, 3);
      m.colourHold = clamp(period * 4, 1.6, 2.5);
      m.colourReturn = clamp(period * 6, 2.5, 4);
    }
    m.colourAge += dt;
    if (m.colourStage === 1) {
      const p = clamp(m.colourAge / m.colourOut, 0, 1);
      m.colourBiasGain = .5 + .5 * Math.cos(Math.PI * p);
      if (p === 1) { m.colourStage = 2; m.colourAge = 0; }
    } else if (m.colourStage === 2) {
      m.colourBiasGain = 0;
      if (m.colourAge >= m.colourHold) { m.colourStage = 3; m.colourAge = 0; }
    } else {
      const p = clamp(m.colourAge / m.colourReturn, 0, 1);
      m.colourBiasGain = .5 - .5 * Math.cos(Math.PI * p);
      if (p === 1) {
        m.colourStage = 0; m.colourAge = 0;
        m.nextColourRelease = m.time + 8 + Math.sin(m.colourCycle * 1.73) * 3 + m.activity * 2;
      }
    }
  }
  function updateMood(dt) {
    const m = mood; m.time += dt; m.analysisTime += dt;
    let total = 0, weighted = 0, squares = 0, logs = 0;
    const chroma = new Float64Array(12);
    const maximum = audio ? Math.min(14000, audio.sampleRate / 2) : 14000;
    for (let i = 0; i < N; i++) {
      const value = rawEnergies[i]; total += value; squares += value * value;
      weighted += value * i / (N - 1); logs += Math.log(Math.max(1e-5, value));
      const frequency = 40 * Math.pow(maximum / 40, (i + .5) / N);
      if (frequency >= 130 && frequency <= 2200) {
        const note = Math.round(69 + 12 * Math.log2(frequency / 440));
        chroma[((note % 12) + 12) % 12] += value * value;
      }
    }
    const mean = total / N;
    updateColourBreath(dt, mean >= .003);
    if (mean < .003) {
      m.confidence *= Math.exp(-dt / 3); return;
    }
    for (let i = 0; i < 12; i++) m.chroma[i] = lerp(chroma[i], m.chroma[i], Math.exp(-dt / 3));
    if (m.analysisTime >= .5) {
      m.analysisTime = 0;
      let major = -1, minor = -1;
      for (let root = 0; root < 12; root++) {
        major = Math.max(major, tonalScore(majorProfile, root));
        minor = Math.max(minor, tonalScore(minorProfile, root));
      }
      // Relative major/minor ambiguity is common: tonal evidence stays weak.
      m.keyBias = clamp((major - minor) * 3, -1, 1) * clamp(Math.max(major, minor), 0, 1);
    }
    const brightness = weighted / Math.max(.001, total);
    const rms = Math.sqrt(squares / N);
    const tempo = rhythm.bpm ? clamp((rhythm.bpm - 70) / 100, 0, 1) : .35;
    const activity = clamp(tempo * rhythm.confidence * .55 + rms * 1.6 + rhythm.fluxAverage * 5, 0, 1);
    const flatness = Math.exp(logs / N) / Math.max(.00001, mean);
    m.brightness = lerp(brightness, m.brightness, Math.exp(-dt / 1));
    m.flatness = lerp(flatness, m.flatness, Math.exp(-dt / 1));
    const tension = clamp(flatness * .45 + Math.max(0, brightness - .45) * .7 + rhythm.fluxAverage * 4, 0, 1);
    const warmth = clamp((brightness - .48) * 1.35 + m.keyBias * .65 + (activity - .4) * .18, -1, 1);
    m.warmth = lerp(warmth, m.warmth, Math.exp(-dt / 6));
    m.activity = lerp(activity, m.activity, Math.exp(-dt / 4));
    m.tension = lerp(tension, m.tension, Math.exp(-dt / 5));
    m.confidence = lerp(clamp(mean * 12, .2, 1), m.confidence, Math.exp(-dt / 4));
  }
  const debugPanel = document.querySelector('#audio-debug');
  const debugFields = Object.fromEntries(['input', 'engine', 'model-storage', 'ai', 'comparison', 'tempo', 'tracking', 'beat', 'onset', 'meter', 'meter-evidence', 'position', 'window', 'mood', 'timbre']
    .map(key => [key, document.querySelector(`#debug-${key}`)]));
  let debugLastTime = -Infinity;
  function updateDebug(force = false) {
    if (!debugPanel.open && !force) return;
    const r = rhythm, m = mood;
    // Brief inter-beat silence must not hide a clock that is still tracking.
    const bridging = running && r.tracking && r.quiet <= Math.max(.6, r.period * 1.4);
    const audible = running && (rawEnergies.some(value => value > .015) || bridging);
    const locked = audible && r.tracking && r.confidence > .3 && r.bpm > 0;
    const meterKnown = locked && r.meterConfidence > .5 && r.beatInBar > 0;
    // Lamps follow the actual beat clock every frame, independently of text refresh.
    debugFields.beat.setAttribute('style', `opacity:${locked ? .15 + .85 * r.pulse : .15}`);
    const onsetLight = audible ? Math.exp(-(r.time - r.lastOnset) / .12) : 0;
    debugFields.onset.setAttribute('style', `opacity:${.15 + .85 * onsetLight}`);
    if (!force && r.time >= debugLastTime && r.time - debugLastTime < .15) return;
    debugLastTime = r.time;
    const pct = value => `${Math.round(clamp(value, 0, 1) * 100)}%`;
    const set = (key, text) => { if (debugFields[key].textContent !== text) debugFields[key].textContent = text; };
    set('engine', wantsBeatNet() ? `${aiLabel()}（試験） · ${beatNetStatus}${running && r.engine === 'basic' ? '／従来方式で表示' : ''}` : '従来方式');
    set('model-storage', beatThisStorageStatus);
    const ai = beatNetState;
    const aiFresh = ai && audio && audio.currentTime - ai.audioTime < (isBeatThis() ? 12 : .75) && !beatNetClient?.stopped;
    set('ai', running && aiFresh && isBeatThis() ? `拍 ${pct(ai.beatProbability)} / 小節頭 ${pct(ai.downProbability)} · 解析 ${(ai.processingMs / 1000).toFixed(2)}秒 · 入力 ${(audio.currentTime - ai.audioTime).toFixed(1)}秒前` : running && aiFresh ? `拍 ${pct(ai.beatProbability)} / 小節頭 ${pct(ai.downProbability)} · ${ai.processedFrames ? (ai.processingMs / ai.processedFrames).toFixed(1) : '—'}ms/フレーム` : '—');
    set('comparison', running ? `${basicRhythm.tracking ? basicRhythm.bpm.toFixed(1) + ' BPM' : 'テンポ未確定'} / ${basicRhythm.meterConfidence > .5 ? basicRhythm.meter + '拍子系' : '拍子未確定'}` : '—');
    set('input', !running ? '停止中' : `${demo ? 'デモ入力' : 'マイク入力'} · ${audible ? '解析中' : '無音／入力待ち'}`);
    set('tempo', locked ? `${r.bpm.toFixed(1)} BPM / ${(r.bpm / 60).toFixed(2)} BPS · 確かさ ${pct(r.confidence)}` : `— BPM / — BPS · ${audible ? '推定中' : '判定待ち'}`);
    set('tracking', locked ? `${(r.engine !== 'basic' || r.evidence > .35) && r.time - r.lastSupport < Math.max(.75, r.period * 1.5) ? '追従中' : '履歴で継続'} · 最終支持 ${Math.max(0, r.time - r.lastSupport).toFixed(1)}秒前` : '推定待ち');
    set('meter-evidence', audible && r.engine !== 'basic' && ai ? `2拍 ${pct(ai.meterMass[0])} / 3拍 ${pct(ai.meterMass[1])} / 4拍 ${pct(ai.meterMass[2])}` : audible ? `3拍 ${pct(r.meterScores[0])} / 4拍 ${pct(r.meterScores[1])} · 候補差 ${pct(r.meterMargin)}` : '—');
    set('meter', meterKnown ? `${r.meter}拍子系 · 確かさ ${pct(r.meterConfidence)}` : `未確定 · 確かさ ${pct(audible ? r.meterConfidence : 0)}`);
    set('position', meterKnown ? Array.from({ length: r.meter }, (_, i) => `${i + 1 === r.beatInBar ? '●' : '○'}${i + 1}`).join('  ') : '—');
    set('window', r.engine === 'beat-this' ? `Beat This! · 直近${ai.windowSeconds.toFixed(1)}秒／約3秒ごと解析・現在拍は予測` : r.engine === 'beatnet' ? 'BeatNet逐次CRNN＋粒子追跡（50Hz）' : `直近48拍${locked ? ` ≈ ${(48 * r.period).toFixed(1)}秒` : ''} · 記録 ${r.accents.filter(a => a.index < r.beatCount).length}拍 · 最低3周期`);
    const expression = `${m.warmth > .15 ? '明るめ' : m.warmth < -.15 ? '陰影あり' : '中間'}・${m.activity > .55 ? '活発' : m.activity < .3 ? '穏やか' : '中程度の動き'}`;
    set('mood', audible ? `${expression} · 活動 ${pct(m.activity)} / 緊張 ${pct(m.tension)} / 確かさ ${pct(m.confidence)}` : '—');
    set('timbre', audible ? `${m.brightness < .35 ? '低域寄り' : m.brightness > .65 ? '高域寄り' : '中域寄り'}・${m.flatness > .45 ? 'ノイズ的' : '倍音的'}（明るさ ${pct(m.brightness)} / 平坦度 ${pct(m.flatness)}）` : '—');
  }
  debugPanel.addEventListener('toggle', () => updateDebug(true));
  const moodSpriteHues = [27, 40, 35, 200, 230, 275, 340];
  function particleColour(p, f) {
    // Start with the entire hue circle. Mood gently changes its density,
    // never selects a palette or excludes a range of colours.
    const coordinate = p.tint + p.baseTone * .23 + f.id * .093 + f.colorShift * .15 + mood.time * .0015;
    const baseHue = ((coordinate % 1) + 1) % 1 * 360;
    const centre = (125 - mood.warmth * 115 + mood.activity * 35 + mood.tension * 65 + mood.keyBias * 25 + 360) % 360;
    const bias = Math.min(.9, Math.abs(mood.warmth) * .9 * mood.confidence) * mood.colourBiasGain;
    // With bias < 1 radian this warp stays continuous and one-to-one over
    // the whole circle: even the least preferred colours remain possible.
    let hue = baseHue + bias * Math.sin((centre - baseHue) * Math.PI / 180) * 180 / Math.PI;
    if (p.colorRebel) hue = baseHue + 150 + p.tint * 60;
    const wander = Math.sin(mood.time * .17 + p.colorPhase) * 3;
    hue = (hue + f.beatHue * .55 + wander + 720) % 360;
    const saturation = clamp(66 + mood.activity * 20 + (p.tint - .5) * 12 - mood.tension * 5, 45, 92);
    const lightness = clamp(60 + p.strength * 19 - mood.tension * 4 + (p.tint - .5) * 6, 48, 83);
    const spriteHues = moodSpriteHues;
    let sprite = 0, distance = Infinity;
    spriteHues.forEach((h, i) => {
      const d = Math.abs(((h - hue + 540) % 360) - 180);
      if (d < distance) { distance = d; sprite = i; }
    });
    return { hue, saturation, lightness, sprite };
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
        alpha: 0, strength: 0, seeded: false, travelState: 0, travelTarget: -1, travelAge: 0,
        tailCount: 0, tailHead: 0, tailTime: -10, dormantUntil: 0,
        guestUntil: 0, nextTrip: elapsed + 10 + spare.tint * 12,
        band: flockRanges[owner.region] + Math.floor(spare.tint * (flockRanges[owner.region + 1] - flockRanges[owner.region])) });
    }
  }
  const soundProfile = { diversity: 0, intensity: 0, budget: 1, splits: 0, merges: 0 };
  function resetSoundProfile() { Object.assign(soundProfile, { diversity: 0, intensity: 0, budget: 1, splits: 0, merges: 0 }); }
  function updateSoundProfile(dt) {
    const buckets = new Float64Array(32);
    let power = 0;
    for (let i = 0; i < N; i++) { const value = rawEnergies[i] ** 2; buckets[Math.floor(i / 16)] += value; power += value; }
    let entropy = 0;
    if (power > .0001) for (const value of buckets) { const p = value / power; if (p > 0) entropy -= p * Math.log(p); }
    const diversity = clamp((entropy / Math.log(32) - .12) / .78, 0, 1);
    const intensity = clamp(Math.sqrt(power / N) * 2.5 + rhythm.fluxAverage * 6, 0, 1);
    soundProfile.diversity = lerp(diversity, soundProfile.diversity, Math.exp(-dt / 1.8));
    soundProfile.intensity = lerp(intensity, soundProfile.intensity, Math.exp(-dt / 1));
    soundProfile.budget = Math.round(1 + soundProfile.diversity * 5 + soundProfile.intensity * 4);
  }
  function splitParticle(f, p) {
    const slot = guestSlot(f);
    if (slot < 0 || p.size < 5.5 || p.travelState || p.reactionAfter > elapsed) return false;
    const q = f.particles[slot], mass = p.size ** 2, fraction = .4 + p.tint * .2;
    const nx = Math.cos(p.angle), ny = Math.sin(p.angle), maximum = particleSpeedLimit();
    let kick = Math.min(16, maximum * .16);
    for (let i = 0; i < 10; i++) {
      if (Math.hypot(p.vx + nx * kick * (1 - fraction), p.vy + ny * kick * (1 - fraction)) <= maximum &&
        Math.hypot(p.vx - nx * kick * fraction, p.vy - ny * kick * fraction) <= maximum) break;
      kick *= .5;
    }
    if (kick < .1) return false;
    const x = p.x, y = p.y, vx = p.vx, vy = p.vy, separation = p.size * .6;
    const child = { size: Math.sqrt(mass * (1 - fraction)),
      x: x - nx * separation * fraction, y: y - ny * separation * fraction,
      vx: vx - nx * kick * fraction, vy: vy - ny * kick * fraction,
      alpha: p.alpha, strength: p.strength, band: p.band, baseTone: p.baseTone,
      tint: clamp(p.tint + .025, 0, .999), colorPhase: p.colorPhase + .1, colorRebel: p.colorRebel,
      cohesion: clamp(p.cohesion - .05, .35, 1.35), travelState: 0, travelTarget: -1, travelAge: 0,
      guestUntil: elapsed + 10, dormantUntil: 0, nextTrip: elapsed + 12, reactionAfter: elapsed + 14,
      tailCount: 0, tailHead: 0, tailTime: -10, mirrorX: p.mirrorX, mirrorY: p.mirrorY, mvx: p.mvx, mvy: p.mvy };
    Object.assign(q, child);
    p.size = Math.sqrt(mass * fraction);
    p.x = x + nx * separation * (1 - fraction); p.y = y + ny * separation * (1 - fraction);
    p.vx = vx + nx * kick * (1 - fraction); p.vy = vy + ny * kick * (1 - fraction);
    p.reactionAfter = elapsed + 14; p.guestUntil = Math.max(p.guestUntil, elapsed + 10);
    p.tailCount = p.tailHead = 0; p.tailTime = -10;
    soundProfile.splits++; return true;
  }
  function mergeParticles(p, q) {
    if (p === q || p.travelState || q.travelState || p.alpha < .4 || q.alpha < .4 ||
      p.size > 2.4 || q.size > 2.4 || p.dormantUntil > elapsed || q.dormantUntil > elapsed ||
      p.reactionAfter > elapsed || q.reactionAfter > elapsed) return false;
    const dx = p.x - q.x, dy = p.y - q.y, ux = p.vx - q.vx, uy = p.vy - q.vy;
    if (Math.hypot(dx, dy) > Math.max(1.5, (p.size + q.size) * 1.5) ||
      Math.hypot(ux, uy) > particleSpeedLimit() * .3 || dx * ux + dy * uy > .1) return false;
    const a = p.size ** 2, b = q.size ** 2, mass = a + b;
    p.x = (p.x * a + q.x * b) / mass; p.y = (p.y * a + q.y * b) / mass;
    p.vx = (p.vx * a + q.vx * b) / mass; p.vy = (p.vy * a + q.vy * b) / mass;
    p.size = Math.sqrt(mass); p.baseTone = (p.baseTone * a + q.baseTone * b) / mass;
    p.cohesion = (p.cohesion * a + q.cohesion * b) / mass;
    p.reactionAfter = elapsed + 12; p.guestUntil = Math.max(p.guestUntil, elapsed + 8);
    p.tailCount = p.tailHead = 0; p.tailTime = -10;
    q.alpha = 0; q.seeded = false; q.dormantUntil = elapsed + 12; q.guestUntil = 0; q.reactionAfter = elapsed + 12;
    q.tailCount = q.tailHead = 0;
    soundProfile.merges++; return true;
  }
  function reactFlock(f) {
    if (!f.active || f.exiting || f.presence < .7 || elapsed < f.nextReaction) return;
    if (rhythm.confidence > .35 && !rhythm.beat && elapsed - f.nextReaction < 1.2) return;
    const live = f.particles.filter(p => p.alpha > .4 && p.dormantUntil <= elapsed && !p.travelState && p.reactionAfter <= elapsed);
    let reacted = false;
    const split = () => { const p = live.find(p => p.size >= 5.5); return p ? splitParticle(f, p) : false; };
    const merge = () => {
      const small = live.filter(p => p.size <= 2.4);
      for (let i = 0; i < small.length; i++) for (let j = i + 1; j < small.length; j++) if (mergeParticles(small[i], small[j])) return true;
      return false;
    };
    reacted = f.reactionTurn % 2 === 0 ? split() || merge() : merge() || split();
    if (reacted) { f.reactionTurn++; f.nextReaction = elapsed + 8 + hash(f.id, f.reactionTurn, 8052) * 8; }
    else f.nextReaction = elapsed + .8;
  }
  const focus = { x: 0, y: 0, phase: 0, strength: 0, satellites: [], next: 7, cycle: 0 };
  function particleSpeedLimit() { return 180 * Math.min(width, height) / 390 * rhythm.motionLimitScale; }
  function capVelocity(body, maximum) {
    const scale = Math.min(1, maximum / Math.max(1e-9, Math.hypot(body.vx, body.vy)));
    body.vx *= scale; body.vy *= scale;
  }
  function advanceLeader(f, tx, ty, dt) {
    const maximum = particleSpeedLimit() * .68;
    const steps = Math.ceil(dt * 120), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      let vx = (tx - f.x) * 2.8, vy = (ty - f.y) * 2.8;
      const scale = Math.min(1, maximum / Math.max(1e-9, Math.hypot(vx, vy)));
      f.vx = lerp(vx * scale, f.vx, Math.exp(-h / .6));
      f.vy = lerp(vy * scale, f.vy, Math.exp(-h / .6));
      capVelocity(f, maximum); f.x += f.vx * h; f.y += f.vy * h;
    }
  }
  function advanceMirror(p, tx, ty, dt) {
    const maximum = particleSpeedLimit(), steps = Math.ceil(dt * 120), h = dt / steps;
    const decay = Math.exp(-h / .4);
    for (let i = 0; i < steps; i++) {
      const dx = (tx - p.mirrorX) * 3, dy = (ty - p.mirrorY) * 3;
      const scale = Math.min(1, maximum / Math.max(1e-9, Math.hypot(dx, dy)));
      p.mvx = lerp(dx * scale, p.mvx, decay); p.mvy = lerp(dy * scale, p.mvy, decay);
      const cap = Math.min(1, maximum / Math.max(1e-9, Math.hypot(p.mvx, p.mvy)));
      p.mvx *= cap; p.mvy *= cap;
      p.mirrorX += p.mvx * h; p.mirrorY += p.mvy * h;
    }
  }
  function updateFocus(dt, audible) {
    if (audible) focus.phase += Math.PI * 2 * dt / Math.max(3.5, (rhythm.bpm ? rhythm.period : .75) * 8);
    focus.x = width / 2;
    focus.y = lerp(height / 2 + Math.sin(focus.phase) * Math.min(26, height * .055), focus.y, Math.exp(-dt / .7));
    focus.strength = lerp(audible ? 1 : 0, focus.strength, Math.exp(-dt / .8));
    focus.satellites.forEach(point => {
      point.age += dt; point.strength = Math.sin(Math.PI * clamp(point.age / point.life, 0, 1)) ** 2;
      point.y = point.baseY + Math.sin(focus.phase + point.phase) * Math.min(12, height * .025);
    });
    focus.satellites = focus.satellites.filter(point => point.age < point.life);
    if (!audible) { focus.next = elapsed + 7; return; }
    if (elapsed >= focus.next && focus.satellites.length < 2 &&
      (rhythm.confidence < .35 || rhythm.beat || elapsed - focus.next > 1.5)) {
      const angle = focus.cycle * 2.3999632297 + .6;
      focus.satellites.push({ x: width * (.5 + Math.cos(angle) * .29),
        y: height * (.5 + Math.sin(angle) * .28), baseY: height * (.5 + Math.sin(angle) * .28), phase: angle, age: 0, life: 7 + 2 * Math.sin(angle) ** 2, strength: 0 });
      focus.cycle++; focus.next = elapsed + 8 + 3 * Math.sin(focus.cycle * 1.3) ** 2;
    }
  }
  function drawFocusPoints() {
    const points = [{ x: focus.x, y: focus.y, strength: 1 }, ...focus.satellites];
    for (const point of points) {
      const opacity = focus.strength * point.strength;
      if (opacity < .01) continue;
      const size = 17 + rhythm.pulse * rhythm.confidence * 3;
      ctx.globalAlpha = opacity * .23;
      ctx.drawImage(glows[3][2], point.x - size, point.y - size, size * 2, size * 2);
      ctx.globalAlpha = opacity * .28; ctx.fillStyle = '#d8eeff';
      ctx.beginPath(); ctx.arc(point.x, point.y, 1 + rhythm.pulse * .4, 0, Math.PI * 2); ctx.fill();
    }
  }
  function prepareFlocks() {
    Object.assign(focus, { x: width / 2, y: height / 2, phase: 0, strength: 0, satellites: [], next: 7, cycle: 0 });
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
      nextReaction: 6 + hash(id, 0, 8050) * 8, reactionTurn: id % 2,
      x: width * (.2 + .6 * hash(id, 0, 8001)),
      y: height * (.2 + .6 * hash(id, 0, 8002)),
      heading: hash(id, 0, 8003) * Math.PI * 2,
      phase: hash(id, 0, 8004) * Math.PI * 2,
      particles: Array.from({ length: 128 }, (_, j) => ({
        band: flockRanges[id % 5] + Math.floor(hash(id, j, 8005) * (flockRanges[id % 5 + 1] - flockRanges[id % 5])),
        angle: j * 2.3999632297, distance: Math.sqrt(hash(id, j, 8010)),
        tint: hash(id, j, 8021), colorRebel: hash(id, j, 8040) < .018,
        colorPhase: hash(id, j, 8041) * Math.PI * 2, mirrorX: width / 2, mirrorY: height / 2, mvx: 0, mvy: 0,
        size: particleSize(hash(id, j, 8012)),
        cohesion: .35 + hash(id, j, 8051), dormantUntil: 0, reactionAfter: 0,
        travelState: 0, travelTarget: -1, travelAge: 0, guestUntil: 0, mirrorWeight: 1,
        tail: new Float64Array(36), tailHead: 0, tailCount: 0, tailTime: -10,
        nextTrip: 4 + hash(id, j, 8030) * 15, driftAngle: 0, seeded: false,
        baseTone: (flockRanges[id % 5] + hash(id, j, 8005) * (flockRanges[id % 5 + 1] - flockRanges[id % 5])) / (N - 1),
        x: width * (.2 + .6 * hash(id, 0, 8001)),
        y: height * (.2 + .6 * hash(id, 0, 8002)), alpha: 0, strength: 0, vx: 0, vy: 0
      }))
    }));
  }
  // Only invisible slots may be emitted. Existing individuals always keep
  // their position and momentum, including when a departing flock reforms.
  function emitParticle(f, p, j, safety = false) {
    const kind = safety ? 0 : f.entryStyle || 0;
    const margin = 40 + p.size * 4;
    let x = focus.x, y = focus.y;
    if (kind >= 2) {
      const side = kind === 2 ? (f.id + f.episode) % 4 : j % 4;
      const u = kind === 2 ? .5 + (p.tint - .5) * .18 : p.tint;
      if (side === 0) { x = -margin; y = height * u; }
      if (side === 1) { x = width + margin; y = height * u; }
      if (side === 2) { x = width * u; y = -margin; }
      if (side === 3) { x = width * u; y = height + margin; }
    }
    const speed = particleSpeedLimit() * .24;
    Object.assign(p, { x, y, vx: Math.cos(p.angle) * speed, vy: Math.sin(p.angle) * speed,
      mirrorX: x, mirrorY: y, mvx: 0, mvy: 0,
      travelState: 0, travelTarget: -1, guestUntil: 0,
      tailCount: 0, tailHead: 0, tailTime: -10, seeded: true });
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
    updateSoundProfile(dt);
    const candidates = flocks.map(f => ({ id: f.id, score: drives[f.region] * (f.voice ? .7 : 1) }))
      .filter(item => item.score > .025).sort((a, b) => b.score - a.score);
    const selected = new Set(candidates.slice(0, soundProfile.budget).map(item => item.id));
    updateFocus(dt, Math.max(...drives) > .035);
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
      const enabled = selected.has(f.id) && (f.voice === 0 ? window < .82 : window > .18 && window < .72 && drive > .25);
      const safety = rescue && f.id === strongest;
      const gate = chooseFlockGate(f, enabled, drive > .035, safety, elapsed);
      const target = gate ? drive : 0;
      if (target > .035 && !f.active) {
        if (f.presence < .001) f.trail = [];
        f.particles.forEach(p => {
          if (p.alpha < .005) { p.alpha = 0; p.seeded = false; }
        });
        // Blank-screen recovery emits at the focus; it never relocates live particles.
        f.entryStyle = safety ? 0 : (f.id + f.episode) % 4;
        f.entryStarted = elapsed;
        if (f.presence < .001) {
          f.x = focus.x; f.y = focus.y; f.vx = f.vy = 0;
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
      advanceLeader(f, tx, ty, dt);
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
      const symmetryChoice = Math.floor(hash(f.id, f.episode, 8022) * 7);
      const symmetry = symmetryChoice < 4 ? 0 : symmetryChoice - 3;
      if (symmetry !== f.mirrorType && f.mirrorAlpha < .03) f.mirrorType = symmetry;
      f.mirrorAlpha = lerp(symmetry === f.mirrorType && symmetry ? 1 : 0, f.mirrorAlpha, Math.exp(-dt / .65));
      f.colorShift = lerp(Math.sin(t * .23 + f.id) * .13 + backgroundTone * .1, f.colorShift, Math.exp(-dt / 1.2));
      // Local neighbour samples are frozen for the frame, so the result does
      // not depend on particle iteration order. A grid bounds mobile CPU cost.
      const cellSize = Math.max(18, Math.min(width, height) * .085);
      const cells = new Map();
      const members = f.particles.map(p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, alpha: p.alpha, travelling: p.travelState !== 0, dormant: p.dormantUntil > elapsed, guest: p.guestUntil > elapsed }));
      members.forEach((p, j) => {
        if (p.dormant || p.travelling || (j >= count && !p.guest && p.alpha < .05)) return;
        const key = `${Math.floor(p.x / cellSize)},${Math.floor(p.y / cellSize)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(j);
      });
      f.particles.forEach((p, j) => {
        if (p.dormantUntil > elapsed) { p.alpha = 0; return; }
        p.strength = lerp(clamp(energies[p.band] / Math.max(.06, environment), 0, 1), p.strength, Math.exp(-dt / .12));
        const wanted = j < count || (safety && !p.seeded) || p.guestUntil > elapsed || p.travelState;
        if (p.alpha < .005 && !wanted) p.seeded = false;
        if (wanted && p.alpha < .005 && !p.seeded && !f.exiting) {
          // A short emission sequence makes the source readable before cohesion.
          if (!safety && elapsed - f.entryStarted < j * (f.entryStyle === 1 ? .025 : .008)) return;
          emitParticle(f, p, j, safety);
        }
        p.alpha = lerp(wanted ? f.presence : 0, p.alpha, Math.exp(-dt / .18));
        p.baseTone = lerp(p.band / (N - 1), p.baseTone, Math.exp(-dt / 1.4));
        p.mirrorWeight = lerp(p.travelState ? 0 : 1, p.mirrorWeight, Math.exp(-dt / .35));
        if (j >= count && p.alpha < .005 && !f.exiting && !p.travelState) return;
        if (f.exiting) { p.travelState = 0; p.travelTarget = -1; }
        if (!p.travelState && p.size < .85 && p.cohesion < .85 && p.alpha > .4 && f.active && !f.exiting &&
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
            radial = (preferred - r) * 1.8 * p.cohesion;
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
            return [ux * speed + (fx - p.x) * 2.2 * p.cohesion, uy * speed + (fy - p.y) * 2.2 * p.cohesion];
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
        if (neighbours) { flowX = lerp(flowX, alignX, .08 + p.cohesion * .15); flowY = lerp(flowY, alignY, .08 + p.cohesion * .15); }
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
        if (!f.exiting && !p.travelState && p.tint < .28) {
          const point = focus.satellites.length && p.tint < .12 ? focus.satellites[f.id % focus.satellites.length] : focus;
          const strength = point.strength * focus.strength * .22;
          flowX += (point.x - p.x) * strength; flowY += (point.y - p.y) * strength;
        }
        const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
        for (let step = 0; step < steps; step++) {
          let vx = flowX, vy = flowY;
          if (f.exiting) {
            const outward = f.exitStyle % 2 === 1;
            const cx = outward ? f.exitX : focus.x, cy = outward ? f.exitY : focus.y;
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
          capVelocity(p, particleSpeedLimit());
          p.x += p.vx * h; p.y += p.vy * h;
        }
        recordParticleTail(p, elapsed);
        const mx = f.mirrorType === 1 || f.mirrorType === 3 ? width - p.x : p.x;
        const my = f.mirrorType === 2 || f.mirrorType === 3 ? height - p.y : p.y;
        advanceMirror(p, mx, my, dt);
      });
    }
    finishTransfers(transfers);
    flocks.forEach(reactFlock);
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
    drawFocusPoints();
    for (const f of flocks) for (const p of f.particles) {
      if (p.alpha < .005) continue;
      const colour = particleColour(p, f), hue = colour.hue;
      const radius = p.size * (.8 + p.strength * 1.15 + f.pulse * .65) * (1 - f.collapse * .65);
      const glow = 12 + radius * 3;
      const colorIndex = colour.sprite;
      const copies = [[p.x, p.y, 1]];
      if (f.mirrorAlpha * p.mirrorWeight > .005) copies.push([p.mirrorX, p.mirrorY, f.mirrorAlpha * p.mirrorWeight]);
      for (const [x, y, opacity] of copies) {
        const reflectedX = x === p.x ? 1 : (f.mirrorType === 1 || f.mirrorType === 3 ? -1 : 1);
        const reflectedY = y === p.y ? 1 : (f.mirrorType === 2 || f.mirrorType === 3 ? -1 : 1);
        drawParticleTail(p, x, y, reflectedX, reflectedY, hue, p.alpha * opacity, radius);
        ctx.globalAlpha = p.alpha * opacity * (.25 + p.strength * .4);
        ctx.drawImage(glows[colorIndex][2], x - glow, y - glow, glow * 2, glow * 2);
        ctx.globalAlpha = p.alpha * opacity * (.6 + p.strength * .4);
        ctx.fillStyle = `hsl(${hue},${colour.saturation}%,${colour.lightness}%)`;
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
      beatNetClient?.stop(); beatNetClient = null; beatNetState = null; aiActive = false;
      beatNetStatus = '一時停止';
      if (wake) { wake.release().catch(() => {}); wake = null; }
      if (audio?.state === 'running') audio.suspend().catch(() => {});
    } else if (running) {
      if (!demo && audio && source) beginBeatNet();
      audio?.resume().catch(() => message('音声を再開できませんでした。「終了」の後に「開始」を押してください。'));
      acquireWake(); frameId = requestAnimationFrame(frame);
    }
  });
  window.addEventListener('model-setup-state', () => {
    beatThisStorageStatus = setupComplete() ? '端末に保存済み・再読み込み後も再利用' : '初回データを準備中';
    startButton.disabled = !setupComplete() || running || starting || selectionRequired; updateDebug(true);
  });
  window.addEventListener('pagehide', stop);
  resize();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      message('オフラインの準備ができませんでした。オンラインでの観測は利用できます。');
    });
  }
})();

