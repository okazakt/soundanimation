'use strict';
importScripts('./model-assets.js?v=2026.10.19.47');
let busy = false;
const emit = state => self.postMessage(state);
self.onmessage = async ({ data }) => {
  if (data.type !== 'prepare' || busy) return;
  busy = true;
  const assets = self.ModelAssets, base = self.location.href;
  let loaded = 0, total = 0;
  const report = (phase, file, bytes = loaded) => emit({ type: 'progress', phase, label: file?.label, loaded: bytes, total,
    percent: total ? Math.min(100, bytes / total * 100) : null });
  try {
    report('checking');
    if (typeof caches === 'undefined') throw new Error('このブラウザでモデルを保存できません。保存設定を確認してください。');
    const cache = await caches.open(assets.CACHE), missing = [];
    for (const file of assets.FILES) {
      report('checking', file);
      const saved = await cache.match(assets.url(file, base));
      if (saved?.status === 200) {
        if (saved.headers.get('X-Starlight-SHA256') === file.sha256 && saved.headers.get('X-Starlight-Bytes') === String(file.bytes)) continue;
        // Validate saved resources lacking verification metadata without downloading again.
        let bytes;
        try { bytes = await assets.read(saved, file.bytes); } catch {}
        if (bytes && await assets.valid(bytes, file)) {
          // The already-saved body is usable even if upgrading its metadata
          // would exceed quota. Recheck it next time rather than re-download.
          try { await cache.put(assets.url(file, base), assets.response(bytes, file)); } catch {}
          continue;
        }
        await cache.delete(assets.url(file, base));
      }
      missing.push(file);
    }
    total = missing.reduce((sum, file) => sum + file.bytes, 0);
    for (const file of missing) {
      report('downloading', file);
      // A separate URL keeps the cache-first service worker from buffering the
      // full response before we can observe the actual network stream.
      const download = new URL(assets.url(file, base)); download.searchParams.set('download', file.sha256.slice(0, 16));
      const controller = new AbortController(); let timer;
      const touch = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), 60000); };
      let bytes, lastReport = -Infinity;
      try {
        touch();
        const response = await fetch(download.href, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`データを取得できませんでした（${response.status}）。接続を確認して再試行してください。`);
        bytes = await assets.read(response, file.bytes, received => {
          touch(); const now = performance.now();
          if (now - lastReport >= 80 || received === file.bytes) { report('downloading', file, loaded + received); lastReport = now; }
        });
      } finally { clearTimeout(timer); }
      loaded += file.bytes; report('verifying', file);
      if (!await assets.valid(bytes, file)) throw new Error('データの確認に失敗しました。再試行すると、このファイルを取得し直します。');
      report('saving', file); await cache.put(assets.url(file, base), assets.response(bytes, file));
    }
    // Retire the large model only after all replacement resources are saved.
    for (const name of assets.LEGACY_CACHES || []) { try { await caches.delete(name); } catch {} }
    emit({ type: 'ready', percent: 100, reused: missing.length === 0, downloadedBytes: loaded });
  } catch (error) {
    const message = error.name === 'QuotaExceededError' ? '端末に保存できませんでした。空き容量やブラウザの保存設定を確認して再試行してください。'
      : error.name === 'SecurityError' ? 'このブラウザでデータを保存できません。保存設定を確認して再試行してください。'
      : error.name === 'TypeError' ? 'データを取得できませんでした。インターネット接続を確認して再試行してください。'
      : error.name === 'AbortError' ? '通信が進まないため中断しました。接続を確認して再試行してください。'
      : error.message || '準備に失敗しました。接続を確認して再試行してください。';
    emit({ type: 'error', message, loaded, total, percent: total ? Math.min(100, loaded / total * 100) : null });
  } finally { busy = false; }
};
