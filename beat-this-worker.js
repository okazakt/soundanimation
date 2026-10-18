// MIT-licensed Beat This! browser port. See vendor/beat-this/NOTICE.md.
import { createBeatThis } from './vendor/beat-this/beat-this.mjs';
import './beatnet-core.js?v=2026.10.18.18';
import './beat-this-rhythm.js?v=2026.10.18.18';
const RATE = 22050, CAPACITY = RATE * 16;
let tracker, resampler, ring = new Float32Array(CAPACITY), written = 0, total = 0;
let inputRate = RATE, inputSamples = 0, expectedInputTime = null, timeline = 0, resyncCount = 0;
let end = 0, lastRun = 0, busy = false, scheduledTimer = null, provider = 'wasm';
const status = message => self.postMessage({ type: 'status', message });
async function load(rate) {
  inputRate = rate;
  resampler = new self.BeatNetCore.Resampler(rate);
  status('モデル読込中（83MB＋実行環境27MB・初回は時間がかかります）');
  const response = await fetch('./vendor/beat-this/beat-this.onnx');
  if (!response.ok) throw new Error(`モデル読込失敗 (${response.status})`);
  const bytes = await response.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== 83008106 || hash !== '5d8a94ce99fb33a6b26df6f6d8076decd52b8fd9439e3206d9b8bcdb1c2881bd') {
    // A bad successful HTTP response must not become a permanent cached error.
    try {
      const cache = await caches.open('starlight-bell-soundanimation-beat-this-final0-ort-1.23.2-v1');
      await cache.delete(new URL('./vendor/beat-this/beat-this.onnx', self.location.href).href);
    } catch {}
    throw new Error('モデルの検証に失敗しました。次の開始時にモデルを再取得します');
  }
  const modelUrl = URL.createObjectURL(new Blob([bytes])), wasmPaths = new URL('./vendor/beat-this/', self.location.href).href;
  try {
    try {
      if (navigator.gpu && await navigator.gpu.requestAdapter()) {
        status('GPUでモデルを準備中'); tracker = await createBeatThis({ modelUrl, wasmPaths, executionProvider: 'webgpu' }); provider = 'webgpu';
      }
    } catch { status('GPUを利用できないためCPUで準備中'); }
    if (!tracker) { status('CPUでモデルを準備中'); tracker = await createBeatThis({ modelUrl, wasmPaths, executionProvider: 'wasm' }); }
  } finally { URL.revokeObjectURL(modelUrl); }
  self.postMessage({ type: 'ready', provider });
}
async function analyze() {
  busy = true; lastRun = end;
  scheduledTimer = null;
  const epoch = timeline;
  const length = Math.min(total, CAPACITY), pcm = new Float32Array(length);
  const begin = total >= CAPACITY ? written : 0, first = Math.min(length, CAPACITY - begin);
  pcm.set(ring.subarray(begin, begin + first)); if (first < length) pcm.set(ring.subarray(0, length - first), first);
  const audioTime = end, started = performance.now();
  try {
    const result = await tracker.analyze(pcm), processingMs = performance.now() - started;
    if (epoch !== timeline) return; // A discontinuity invalidates in-flight predictions.
    if (processingMs > 10000) throw new Error('解析に10秒以上かかるため、この端末ではライブ推定を継続できません');
    const state = self.BeatThisRhythm.summarize(result, audioTime - length / RATE, length / RATE);
    self.postMessage({ type: 'result', state: { ...state, processingMs, provider, resyncCount, inputRate } });
  } finally { busy = false; }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') await load(data.rate);
    else if (data.type === 'pcm' && tracker) {
      if (!(data.pcm instanceof Float32Array) || data.pcm.length > 16384 || data.pcm.some(v => !Number.isFinite(v))) throw new Error('音声ブロックが不正です');
      if (!Number.isFinite(data.audioTime)) throw new Error('音声入力の時刻が不正です');
      const rate = data.rate ?? inputRate;
      const gap = expectedInputTime === null ? 0 : data.audioTime - expectedInputTime;
      // Compare consecutive source blocks, not the cumulative resampled count.
      // iOS input interruptions / route-rate changes can shift the source clock.
      // Clear old phase/history and collect again instead of permanently failing.
      if (data.discontinuity || rate !== inputRate || Math.abs(gap) > .02) {
        inputRate = rate; resampler = new self.BeatNetCore.Resampler(rate);
        written = total = inputSamples = 0; timeline++; resyncCount++;
        if (scheduledTimer !== null) { clearTimeout(scheduledTimer); scheduledTimer = null; busy = false; }
        lastRun = -Infinity;
        self.postMessage({ type: 'resync', gapMs: gap * 1000, rate, count: resyncCount });
      }
      const pcm = resampler.process(data.pcm);
      inputSamples += data.pcm.length;
      for (const sample of pcm) { ring[written] = sample; written = (written + 1) % CAPACITY; total++; }
      expectedInputTime = data.audioTime + data.pcm.length / inputRate;
      // Account for the resampler's small un-emitted tail, anchored to the
      // newest capture timestamp rather than accumulating clock differences.
      end = expectedInputTime - (inputSamples / inputRate - total / RATE);
      self.postMessage({ type: 'ack' });
      if (!busy && total >= RATE * 8 && end - lastRun >= 3) {
        // Let queued capture messages drain before taking the newest window.
        // Otherwise CPU inference slower than 3s would repeatedly analyze old
        // snapshots and build an ever-growing lag despite a bounded ring.
        busy = true;
        scheduledTimer = setTimeout(() => analyze().catch(error => self.postMessage({ type: 'error', message: error.message })), 50);
      }
    }
  } catch (error) { self.postMessage({ type: 'error', message: error.message || 'Beat This!解析失敗' }); }
};
