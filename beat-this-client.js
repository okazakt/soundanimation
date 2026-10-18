'use strict';
(function () {
  class BeatThisClient {
    constructor(onState, onStatus) { this.onState = onState; this.onStatus = onStatus; this.stopped = false; this.pending = 0; }
    async start(context, source) {
      if (!context.audioWorklet || !window.AudioWorkletNode || !window.Worker) throw new Error('このブラウザはAI音声処理に対応していません');
      this.context = context; this.source = source;
      const worker = this.worker = new Worker(new URL('./beat-this-worker.js?v=2026.10.18.17', document.baseURI), { type: 'module' });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.fail('モデル準備がタイムアウトしました（通信・空きメモリを確認）'), 180000);
        this.readyReject = error => { clearTimeout(timer); reject(error); };
        worker.onerror = event => this.fail(`Beat This!実行エラー: ${event.message || '実行環境を起動できませんでした'}`);
        worker.onmessage = ({ data }) => {
          if (this.stopped) return;
          if (data.type === 'ready') { clearTimeout(timer); this.readyReject = null; this.provider = data.provider; resolve(); }
          else if (data.type === 'status') this.onStatus(data.message);
          else if (data.type === 'error') this.fail(data.message);
          else if (data.type === 'ack') this.pending = Math.max(0, this.pending - 1);
          else if (data.type === 'result') {
            const age = context.currentTime - data.state.audioTime;
            if (age > 10) { this.fail('処理が入力に追いつきません'); return; }
            this.onState({ ...data.state, receivedAudioTime: context.currentTime });
            this.onStatus(`解析中 · ${this.provider === 'webgpu' ? 'GPU' : 'CPU'} · 直近${data.state.windowSeconds.toFixed(0)}秒／約3秒ごと更新`);
          }
        };
        worker.postMessage({ type: 'load', rate: context.sampleRate });
      });
      if (this.stopped) return;
      await context.audioWorklet.addModule(new URL('./beatnet-capture.js?v=2026.10.18.17', document.baseURI));
      if (this.stopped) return;
      this.node = new AudioWorkletNode(context, 'beatnet-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.port.onmessage = ({ data }) => {
        if (this.stopped) return;
        // A bounded queue; never silently skip audio and retain a false phase.
        if (this.pending >= 256) { this.fail('音声処理が追いつきません'); return; }
        this.pending++; worker.postMessage({ type: 'pcm', pcm: data.pcm, audioTime: data.firstFrame / context.sampleRate }, [data.pcm.buffer]);
      };
      this.mute = context.createGain(); this.mute.gain.value = 0;
      source.connect(this.node); this.node.connect(this.mute); this.mute.connect(context.destination);
      this.onStatus('音を収集中 · 最初の解析は8秒後（直近最大16秒を参照）');
    }
    fail(message) { if (this.stopped) return; this.onState(null); this.onStatus(`${message}・従来方式で継続`); this.readyReject?.(new Error(message)); this.stop(); }
    stop() {
      this.stopped = true; this.readyReject?.(new Error('Beat This!停止')); this.readyReject = null;
      if (this.node) { try { this.source?.disconnect(this.node); } catch {} this.node.port.onmessage = null; this.node.disconnect(); }
      this.mute?.disconnect(); this.worker?.terminate(); this.worker = null;
    }
  }
  window.BeatThisClient = BeatThisClient;
})();
