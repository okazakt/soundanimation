// MIT-licensed Beat This! browser port. See vendor/beat-this/NOTICE.md.
import { createBeatThis } from './vendor/beat-this/beat-this.mjs';
import './beatnet-core.js?v=2026.10.18.17';
import './beat-this-rhythm.js?v=2026.10.18.17';
const RATE = 22050, CAPACITY = RATE * 16;
let tracker, resampler, ring = new Float32Array(CAPACITY), written = 0, total = 0;
let origin = null, end = 0, lastRun = 0, busy = false, provider = 'wasm';
const status = message => self.postMessage({ type: 'status', message });
async function load(rate) {
  resampler = new self.BeatNetCore.Resampler(rate);
  status('モデル読込中（83MB＋実行環境27MB・初回は時間がかかります）');
  const response = await fetch('./vendor/beat-this/beat-this.onnx');
  if (!response.ok) throw new Error(`モデル読込失敗 (${response.status})`);
  const bytes = await response.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== 83008106 || hash !== '5d8a94ce99fb33a6b26df6f6d8076decd52b8fd9439e3206d9b8bcdb1c2881bd') throw new Error('モデルの検証に失敗しました');
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
  const length = Math.min(total, CAPACITY), pcm = new Float32Array(length);
  const begin = total >= CAPACITY ? written : 0, first = Math.min(length, CAPACITY - begin);
  pcm.set(ring.subarray(begin, begin + first)); if (first < length) pcm.set(ring.subarray(0, length - first), first);
  const audioTime = end, started = performance.now();
  try {
    const result = await tracker.analyze(pcm), processingMs = performance.now() - started;
    if (processingMs > 10000) throw new Error('解析に10秒以上かかるため、この端末ではライブ推定を継続できません');
    const state = self.BeatThisRhythm.summarize(result, audioTime - length / RATE, length / RATE);
    self.postMessage({ type: 'result', state: { ...state, processingMs, provider } });
  } finally { busy = false; }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') await load(data.rate);
    else if (data.type === 'pcm' && tracker) {
      if (!(data.pcm instanceof Float32Array) || data.pcm.length > 16384 || data.pcm.some(v => !Number.isFinite(v))) throw new Error('音声ブロックが不正です');
      origin ??= data.audioTime;
      // The capture stream must be continuous; never join unrelated fragments.
      if (Math.abs(data.audioTime - (origin + total / RATE)) > .15) throw new Error('音声入力が途切れました。終了後に開始し直してください');
      const pcm = resampler.process(data.pcm);
      for (const sample of pcm) { ring[written] = sample; written = (written + 1) % CAPACITY; total++; }
      end = origin + total / RATE;
      self.postMessage({ type: 'ack' });
      if (!busy && total >= RATE * 8 && end - lastRun >= 3) {
        // Let queued capture messages drain before taking the newest window.
        // Otherwise CPU inference slower than 3s would repeatedly analyze old
        // snapshots and build an ever-growing lag despite a bounded ring.
        busy = true;
        setTimeout(() => analyze().catch(error => self.postMessage({ type: 'error', message: error.message })), 50);
      }
    }
  } catch (error) { self.postMessage({ type: 'error', message: error.message || 'Beat This!解析失敗' }); }
};
