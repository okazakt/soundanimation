/* BeatNet JavaScript adaptation, CC BY 4.0. See vendor/beatnet/NOTICE.md. */
'use strict';
importScripts('./beatnet-core.js?v=2026.10.18.17');
let assets = null, pipeline = null, epoch = 0;
async function load() {
  const get = async path => { const r = await fetch(new URL(path, self.location.href)); if (!r.ok) throw new Error(`BeatNetの読込に失敗しました (${r.status})`); return r; };
  const [manifestResponse, frontendResponse, weightsResponse] = await Promise.all([
    get('./vendor/beatnet/manifest.json'), get('./vendor/beatnet/frontend.json'), get('./vendor/beatnet/model-1.f32')
  ]);
  const manifest = await manifestResponse.json(), frontend = await frontendResponse.json(), weights = await weightsResponse.arrayBuffer();
  if (weights.byteLength !== manifest.bytes) throw new Error('BeatNetモデルのサイズが一致しません');
  const digest = await crypto.subtle.digest('SHA-256', weights);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.sha256) throw new Error('BeatNetモデルの検証に失敗しました');
  assets = { manifest, frontend, weights }; self.postMessage({ type: 'ready', bytes: weights.byteLength });
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') await load();
    else if (data.type === 'start') {
      if (!assets) throw new Error('BeatNetモデルが準備されていません');
      pipeline = new BeatNetCore.Pipeline(assets.manifest, assets.weights, assets.frontend, data.rate); epoch = data.epoch;
    } else if (data.type === 'pcm') {
      if (!pipeline || data.epoch !== epoch) return;
      if (!(data.pcm instanceof Float32Array) || data.pcm.length > 16384) throw new Error('BeatNet音声ブロックが不正です');
      for (const value of data.pcm) if (!Number.isFinite(value)) throw new Error('音声入力に不正な値があります');
      const start = performance.now(), states = pipeline.process(data.pcm, data.audioTime);
      const events = states.filter(s => s.event), latest = states[states.length - 1];
      self.postMessage({ type: 'result', epoch, latest, events, processingMs: performance.now() - start, frames: states.length });
    }
  } catch (error) { self.postMessage({ type: 'error', message: error.message || 'BeatNet解析に失敗しました', epoch }); }
};
