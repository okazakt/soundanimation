'use strict';
// Manages one local worker/capture graph, with cancellation and bounded backlog.
(function () {
  class BeatNetClient {
    constructor(onState, onStatus) {
      this.onState = onState; this.onStatus = onStatus; this.stopped = false;
      this.pending = 0; this.restarts = 0; this.lastRestart = -Infinity; this.epoch = 1; this.needsReset = false; this.readyReject = null;
    }
    async start(context, source) {
      if (!context.audioWorklet || !window.AudioWorkletNode || !window.Worker) throw new Error('このブラウザはBeatNetの音声処理に対応していません');
      this.context = context; this.source = source; this.onStatus('モデル読込中（約1.6MB）');
      const worker = new Worker(new URL('./beatnet-worker.js?v=2026.10.18.17', document.baseURI)); this.worker = worker;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('BeatNetの読込がタイムアウトしました')), 20000);
        this.readyReject = error => { clearTimeout(timer); reject(error); };
        worker.onerror = () => this.fail('BeatNetのワーカーを起動できませんでした');
        worker.onmessage = ({ data }) => {
          if (this.stopped) return;
          if (data.type === 'ready') { clearTimeout(timer); this.readyReject = null; resolve(); }
          else if (data.type === 'error') this.fail(data.message);
          else if (data.type === 'result' && data.epoch === this.epoch) {
            this.pending = Math.max(0, this.pending - 1);
            if (data.latest && !this.needsReset) this.onState({ ...data.latest, processingMs: data.processingMs, processedFrames: data.frames });
            if (this.needsReset && this.pending === 0) {
              const now = performance.now();
              if (now - this.lastRestart > 30000) this.restarts = 0;
              this.lastRestart = now; this.restarts++;
              if (this.restarts >= 3) { this.fail('BeatNetの処理が追いつきません'); return; }
              this.epoch++; worker.postMessage({ type: 'start', rate: context.sampleRate, epoch: this.epoch });
              this.needsReset = false; this.onStatus('処理遅延から再同期中');
            }
          }
        };
        worker.postMessage({ type: 'load' });
      });
      if (this.stopped) return;
      await context.audioWorklet.addModule(new URL('./beatnet-capture.js?v=2026.10.18.17', document.baseURI));
      if (this.stopped) return;
      worker.postMessage({ type: 'start', rate: context.sampleRate, epoch: this.epoch });
      this.node = new AudioWorkletNode(context, 'beatnet-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.port.onmessage = ({ data }) => {
        if (this.stopped) return;
        if (this.pending >= 4) { if (!this.needsReset) this.onState(null); this.needsReset = true; this.onStatus('処理遅延・従来方式で継続'); return; }
        if (this.needsReset) return;
        this.pending++; worker.postMessage({ type: 'pcm', epoch: this.epoch, pcm: data.pcm, audioTime: data.firstFrame / context.sampleRate }, [data.pcm.buffer]);
      };
      this.mute = context.createGain(); this.mute.gain.value = 0;
      source.connect(this.node); this.node.connect(this.mute); this.mute.connect(context.destination);
      this.onStatus('解析中・拍の学習待ち');
    }
    fail(message) {
      this.onState(null); this.onStatus(`${message}・従来方式で継続`);
      this.readyReject?.(new Error(message)); this.readyReject = null; this.stop();
    }
    stop() {
      this.stopped = true; this.readyReject?.(new Error('BeatNet停止')); this.readyReject = null;
      if (this.node) { try { this.source?.disconnect(this.node); } catch {} this.node.port.onmessage = null; this.node.disconnect(); }
      this.mute?.disconnect(); this.worker?.terminate(); this.worker = null;
    }
  }
  window.BeatNetClient = BeatNetClient;
})();
