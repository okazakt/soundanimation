const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const assets = require('../model-assets.js');
function fixture() {
  const data = [Uint8Array.of(1,2,3,4), Uint8Array.of(5,6,7)];
  const files = data.map((bytes, i) => ({ name: i ? 'runtime.wasm' : 'model.onnx', label: `file ${i}`, bytes: bytes.length,
    type: i ? 'application/wasm' : 'application/octet-stream', sha256: createHash('sha256').update(bytes).digest('hex') }));
  const messages = [], stored = new Map(), fetched = [], retired = []; let fail = false, quota = false, corrupt = false, clock = 0, checks = 0;
  const api = { ...assets, FILES: files, async valid(...args) { checks++; return assets.valid(...args); } };
  const cache = { async match(url) { return stored.get(url)?.clone(); }, async put(url, response) { if (quota) throw new DOMException('quota', 'QuotaExceededError'); stored.set(url, response.clone()); }, async delete(url) { return stored.delete(url); } };
  const self = { location: { href: 'https://example.test/app/model-setup-worker.js' }, ModelAssets: api, postMessage: m => messages.push(m) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../model-setup-worker.js'), 'utf8'), {
    self, importScripts() {}, URL, AbortController, setTimeout, clearTimeout, performance: { now: () => clock += 100 },
    caches: { open: async () => cache, delete: async name => { retired.push(name); return true; } }, fetch: async url => {
      fetched.push(url); const i = url.includes('runtime.wasm') ? 1 : 0;
      if (fail && i) return new Response('', { status: 503 });
      const bytes = corrupt ? Uint8Array.of(9) : data[i];
      return new Response(new ReadableStream({ start(controller) { for (const b of bytes) controller.enqueue(Uint8Array.of(b)); controller.close(); } }));
    }
  });
  return { files, data, messages, stored, fetched, retired, checks: () => checks, run: () => self.onmessage({ data: { type: 'prepare' } }),
    setFail: value => fail = value, setQuota: value => quota = value, setCorrupt: value => corrupt = value };
}
test('setup streams real byte progress and only declares ready after verified persistent writes', async () => {
  const f = fixture(); await f.run();
  const received = f.messages.filter(m => m.phase === 'downloading' && m.percent !== null).map(m => m.percent);
  assert.ok(received.some(p => p > 0 && p < 100)); assert.equal(received.at(-1), 100);
  assert.ok(received.every((p, i) => !i || p >= received[i-1]));
  assert.equal(f.messages.at(-1).type, 'ready'); assert.equal(f.stored.size, 2); assert.equal(f.checks(), 2);
  assert.ok(f.fetched.every(url => new URL(url).searchParams.has('download')));
  await f.run(); assert.equal(f.fetched.length, 2); assert.equal(f.checks(), 2, 'verified metadata avoids reading entire models on every page view');
  assert.equal(f.messages.at(-1).reused, true);
});
test('existing v18 cache migrates in place without another network download', async () => {
  const f = fixture();
  for (let i = 0; i < f.files.length; i++) f.stored.set(assets.url(f.files[i], 'https://example.test/app/'), new Response(f.data[i]));
  await f.run(); assert.equal(f.fetched.length, 0); assert.equal(f.checks(), 2); assert.equal(f.messages.at(-1).reused, true);
  await f.run(); assert.equal(f.checks(), 2);
});
test('failed download keeps completed files so retry downloads only missing files', async () => {
  const f = fixture(); f.setFail(true); await f.run();
  assert.equal(f.messages.at(-1).type, 'error'); assert.equal(f.stored.size, 1);
  f.setFail(false); await f.run(); assert.equal(f.stored.size, 2);
  assert.equal(f.fetched.filter(url => url.includes('model.onnx')).length, 1);
  assert.equal(f.fetched.filter(url => url.includes('runtime.wasm')).length, 2);
});
test('truncated responses and storage failures never enable the app or cache bad data', async () => {
  const f = fixture(); f.setCorrupt(true); await f.run();
  assert.equal(f.messages.at(-1).type, 'error'); assert.equal(f.stored.size, 0);
  f.setCorrupt(false); f.setQuota(true); await f.run();
  assert.equal(f.messages.at(-1).type, 'error'); assert.match(f.messages.at(-1).message, /空き容量/); assert.equal(f.stored.size, 0);
});
test('a damaged cached file is repaired individually while the remaining cache is reused', async () => {
  const f = fixture(); await f.run(); const count = f.fetched.length;
  f.stored.set(assets.url(f.files[0], 'https://example.test/app/'), new Response(Uint8Array.of(9)));
  await f.run(); assert.equal(f.fetched.length, count + 1); assert.equal(f.messages.at(-1).type, 'ready');
});
test('resource byte counts and hashes match the shipped files', async () => {
  for (const file of assets.FILES) {
    const bytes = fs.readFileSync(require.resolve('../vendor/beat-this/' + file.name));
    assert.equal(bytes.length, file.bytes); assert.ok(await assets.valid(bytes, file));
  }
});
test('verified legacy bodies remain usable when there is no room to upgrade cache metadata', async () => {
  const f = fixture();
  for (let i = 0; i < f.files.length; i++) f.stored.set(assets.url(f.files[i], 'https://example.test/app/'), new Response(f.data[i]));
  f.setQuota(true); await f.run();
  assert.equal(f.messages.at(-1).type, 'ready'); assert.equal(f.fetched.length, 0); assert.equal(f.stored.size, 2);
});

test('large legacy cache is retired only after all lightweight resources are verified and saved', async () => {
  const f = fixture(); f.setFail(true); await f.run(); assert.equal(f.retired.length, 0);
  f.setFail(false); await f.run(); assert.deepEqual(f.retired, assets.LEGACY_CACHES);
  assert.equal(f.messages.at(-1).type, 'ready');
});
