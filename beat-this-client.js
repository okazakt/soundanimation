'use strict';
(function () {
  class BeatThisClient {
    constructor(onState, onStatus, onStorage = () => {}, onInput = () => {}, onAttack = () => {}) { this.onState = onState; this.onStatus = onStatus; this.onStorage = onStorage; this.onInput = onInput; this.onAttack = onAttack; this.stopped = false; this.pending = 0; }
    async prepareStorage(serviceWorker) {
      this.onStorage('PWAの保存機能を準備中');
      this.onStatus('保存済みモデルとPWAを準備中');
      let expected = null;
      try {
        // register() can remain pending while offline, even with an existing
        // controller. Don't let an update check block a cached model startup.
        if (serviceWorker.register && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
          const registration = await new Promise(resolve => {
            let finished = false;
            const finish = value => { if (finished) return; finished = true; clearTimeout(timer); this.cancelPrepare = null; resolve(value); };
            const timer = setTimeout(() => finish(null), 8000);
            this.cancelPrepare = () => finish(null);
            serviceWorker.register(new URL('./sw.js', document.baseURI), { scope: new URL('./', document.baseURI).href }).then(finish, () => finish(null));
          });
          if (registration) expected = registration.installing || registration.waiting || registration.active;
          else if (!serviceWorker.controller) { if (!this.stopped) this.onStorage('保存機能を利用できません・オンラインで解析'); return; }
        }
      } catch {
        // Offline with an existing controller can still use its cache.
        if (!serviceWorker.controller) { if (!this.stopped) this.onStorage('保存機能を利用できません・オンラインで解析'); return; }
      }
      if (this.stopped) return;
      if (!serviceWorker.controller || (expected && serviceWorker.controller !== expected)) {
        await new Promise(resolve => {
          const finish = () => { clearTimeout(timer); serviceWorker.removeEventListener('controllerchange', changed); this.cancelPrepare = null; resolve(); };
          const changed = () => { if (serviceWorker.controller && (!expected || serviceWorker.controller === expected)) finish(); };
          const timer = setTimeout(finish, 8000);
          this.cancelPrepare = finish;
          serviceWorker.addEventListener('controllerchange', changed);
          serviceWorker.ready.then(changed).catch(finish);
          changed();
        });
      }
      if (!this.stopped) this.onStorage(serviceWorker.controller ? '初回取得時に端末へ保存・次回から再利用' : '保存の準備ができませんでした・オンラインで解析');
    }
    async checkStorage() {
      let saved = false;
      try {
        const cache = await caches.open('starlight-bell-soundanimation-beat-this-small0-ort-1.23.2-cpu-v2');
        const files = ['beat-this-small0.onnx', 'beat-this-cpu.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
        const responses = await Promise.all(files.map(file => cache.match(new URL(`./vendor/beat-this/${file}`, document.baseURI).href)));
        saved = responses.every(response => response?.status === 200);
      } catch {}
      if (!this.stopped) this.onStorage(saved ? '端末に保存済み・再読み込み後も再利用' : '保存未完了・空き容量やブラウザの保存設定を確認');
    }
    async start(context, source) {
      if (!context.audioWorklet || !window.AudioWorkletNode || !window.Worker) throw new Error('このブラウザはAI音声処理に対応していません');
      this.context = context; this.source = source; this.inputLevel = new window.BeatThisAudio.AutoLevel();
      if (typeof navigator !== 'undefined' && navigator.serviceWorker) await this.prepareStorage(navigator.serviceWorker);
      if (this.stopped) return;
      const worker = this.worker = new Worker(new URL('./beat-this-worker.js?v=2026.10.19.39', document.baseURI), { type: 'module' });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.fail('モデル準備がタイムアウトしました（通信・空きメモリを確認）'), 180000);
        this.readyReject = error => { clearTimeout(timer); reject(error); };
        worker.onerror = event => this.fail(`Beat This!実行エラー: ${event.message || '実行環境を起動できませんでした'}`);
        worker.onmessage = ({ data }) => {
          if (this.stopped) return;
          if (data.type === 'ready') { clearTimeout(timer); this.readyReject = null; this.provider = data.provider; this.checkStorage(); resolve(); }
          else if (data.type === 'status') this.onStatus(data.message);
          else if (data.type === 'error') this.fail(data.message);
          else if (data.type === 'ack') this.pending = Math.max(0, this.pending - 1);
          else if (data.type === 'resync') {
            this.inputLevel.reset();
            this.onState(null);
            this.onStatus(`入力を自動再同期（${Math.round(data.gapMs)}ms・${data.rate}Hz）・音を収集中`);
          }
          else if (data.type === 'result') {
            const age = context.currentTime - data.state.audioTime;
            if (age > 10) { this.fail('処理が入力に追いつきません'); return; }
            this.onState({ ...data.state, receivedAudioTime: context.currentTime });
            this.onStatus(`${data.state.quiet ? '入力がほぼ無音・解析待ち' : '解析中'} · ${this.provider === 'webgpu' ? 'GPU' : 'CPU'} · 直近${data.state.windowSeconds.toFixed(0)}秒／約${(data.state.hopSeconds ?? 2).toFixed(1)}秒ごと更新${data.state.windowLimitSeconds < 16 ? ` · 負荷調整:最大${data.state.windowLimitSeconds}秒` : ''}${data.state.resyncCount ? ` · 再同期${data.state.resyncCount}回` : ''}`);
          }
        };
        worker.postMessage({ type: 'load', rate: context.sampleRate });
      });
      if (this.stopped) return;
      await context.audioWorklet.addModule(new URL('./beat-this-capture.js?v=2026.10.19.39', document.baseURI));
      if (this.stopped) return;
      this.node = new AudioWorkletNode(context, 'beat-this-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.port.onmessage = ({ data }) => {
        if (this.stopped) return;
        if(data.discontinuity) this.inputLevel.reset();
        this.onInput(this.inputLevel.observe(data.pcm,data.sampleRate ?? context.sampleRate));
        for (const time of data.attacks || []) {
          // Discard a backlog after a long main-thread pause. Preserve source
          // timestamps for recent attacks rather than dating them at delivery.
          if (Number.isFinite(time) && context.currentTime - time <= .5 && time <= context.currentTime) this.onAttack(time);
        }
        // A bounded queue; never silently skip audio and retain a false phase.
        if (this.pending >= 256) { this.fail('音声処理が追いつきません'); return; }
        this.pending++; worker.postMessage({ type: 'pcm', pcm: data.pcm,
          audioTime: data.audioTime ?? data.firstFrame / context.sampleRate,
          rate: data.sampleRate ?? context.sampleRate, discontinuity: !!data.discontinuity }, [data.pcm.buffer]);
      };
      this.mute = context.createGain(); this.mute.gain.value = 0;
      this.highpass = context.createBiquadFilter(); this.highpass.type = 'highpass'; this.highpass.frequency.value = 30;
      this.lowpass = context.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = Math.min(12000, context.sampleRate * .45);
      source.connect(this.highpass); this.highpass.connect(this.lowpass); this.lowpass.connect(this.node); this.node.connect(this.mute); this.mute.connect(context.destination);
      this.onStatus('音を収集中 · 最初の解析は2秒後（2・4・6秒…最大16秒へ拡張）');
    }
    fail(message) { if (this.stopped) return; this.onState(null); this.onStatus(`${message}・リズム判定を停止`); this.readyReject?.(new Error(message)); this.stop(); }
    stop() {
      this.stopped = true; this.cancelPrepare?.(); this.readyReject?.(new Error('Beat This!停止')); this.readyReject = null;
      if (this.node) { try { this.source?.disconnect(this.highpass); } catch {} this.node.port.onmessage = null; this.node.disconnect(); }
      this.highpass?.disconnect(); this.lowpass?.disconnect(); this.mute?.disconnect(); this.worker?.terminate(); this.worker = null;
    }
  }
  window.BeatThisClient = BeatThisClient;
})();
