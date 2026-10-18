'use strict';
// Immutable resource identities shared by setup, inference and their tests.
(function (root) {
  const CACHE = 'starlight-bell-soundanimation-beat-this-final0-ort-1.23.2-v1';
  const FILES = [
    { name: 'beat-this.onnx', label: 'リズム解析モデル', bytes: 83008106, type: 'application/octet-stream', sha256: '5d8a94ce99fb33a6b26df6f6d8076decd52b8fd9439e3206d9b8bcdb1c2881bd' },
    { name: 'beat-this.mjs', label: '解析プログラム', bytes: 169206, type: 'text/javascript', sha256: '508834629cc3d8ef9719a419c99ab12c217f5f7b9d317c737fcfa51a552ea15d' },
    { name: 'ort-wasm-simd-threaded.asyncify.mjs', label: '解析エンジンの準備', bytes: 51911, type: 'text/javascript', sha256: '6542314e268b22bf03b37a046c1b89fddcdf3b807f32ca61d8cc6ec0cbfe1d36' },
    { name: 'ort-wasm-simd-threaded.asyncify.wasm', label: '音声解析エンジン', bytes: 25499390, type: 'application/wasm', sha256: 'babec0bbddb6d3082623b99b7e1391b75e0729bcca076ff8424d7753af97fada' }
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
  const api = { CACHE, FILES, url, read, valid, response };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ModelAssets = api;
})(typeof self === 'undefined' ? globalThis : self);
