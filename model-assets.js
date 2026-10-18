'use strict';
// Immutable resource identities shared by setup, inference and their tests.
(function (root) {
  const CACHE = 'starlight-bell-soundanimation-beat-this-small0-ort-1.23.2-cpu-v2';
  const LEGACY_CACHES = ['starlight-bell-soundanimation-beat-this-final0-ort-1.23.2-v1'];
  const FILES = [
    { name: 'beat-this-small0.onnx', label: 'リズム解析モデル', bytes: 10555597, type: 'application/octet-stream', sha256: '9fa72ac17486ae137ee05ad0ef6a3dba63001c5aa6ada1ecb81c819870d67713' },
    { name: 'beat-this-cpu.mjs', label: '解析プログラム', bytes: 121565, type: 'text/javascript', sha256: '0e87228b8ca74bd42e6796aa5c49d3e3bbe0b226b34c1c2004f713fad67f4fc1' },
    { name: 'ort-wasm-simd-threaded.mjs', label: '解析エンジンの準備', bytes: 20319, type: 'text/javascript', sha256: '82b5af70b83993901f672e9da60917eb9d64a17e48e4cbc9817524619eaed565' },
    { name: 'ort-wasm-simd-threaded.wasm', label: '音声解析エンジン', bytes: 11905541, type: 'application/wasm', sha256: '45eaee27761ad883742a8d4b8fce1538d60ce43b51adf1726fafccc59b8c1a15' }
  ];
  const url = (file, base) => new URL(`./vendor/beat-this/${file.name}`, base).href;
  async function read(response, expected, progress = () => {}) {
    if (!response.body?.getReader) {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== expected) throw new Error('取得したデータのサイズが一致しません');
      progress(expected); return bytes;
    }
    const reader = response.body.getReader(), bytes = new Uint8Array(expected); let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        if (received + value.length > expected) throw new Error('取得したデータのサイズが一致しません');
        bytes.set(value, received); received += value.length; progress(received);
      }
      if (received !== expected) throw new Error('ダウンロードが途中で終了しました');
      return bytes.buffer;
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  }
  async function valid(bytes, file) {
    if (bytes.byteLength !== file.bytes) return false;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') === file.sha256;
  }
  function response(bytes, file) {
    return new Response(bytes, { headers: { 'Content-Type': file.type, 'Content-Length': String(file.bytes),
      'X-Starlight-SHA256': file.sha256, 'X-Starlight-Bytes': String(file.bytes) } });
  }
  const api = { CACHE, LEGACY_CACHES, FILES, url, read, valid, response };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ModelAssets = api;
})(typeof self === 'undefined' ? globalThis : self);
