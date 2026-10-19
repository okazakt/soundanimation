const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require.resolve('../sw.js'), 'utf8');
const base = 'https://example.test/soundanimation/';
const modelCache = 'starlight-bell-soundanimation-beat-this-small0-ort-1.23.2-cpu-v2';
const files = ['beat-this-small0.onnx', 'beat-this-cpu.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
const url = name => base + 'vendor/beat-this/' + name;
function fixture() {
  const stores = new Map(), fetched = [], installed = [], removed = [];
  let offline = false, quota = false, status = 200;
  const response = () => ({ status, ok: status >= 200 && status < 300, clone() { return this; } });
  const key = request => typeof request === 'string' ? request : request.url;
  const caches = { async keys() { return [...stores.keys()]; }, async delete(name) { removed.push(name); return stores.delete(name); }, async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return { async match(request) { return store.get(key(request)); }, async put(request, r) { if (quota) throw new Error('QuotaExceededError'); store.set(key(request), r); }, async addAll(paths) { installed.push(...paths); } };
  } };
  const boot = (source = code) => {
    const events = {}; let claims = 0;
    const self = { location: { href: base + 'sw.js' }, skipWaiting: async () => {}, clients: { claim: async () => claims++ }, addEventListener: (type, fn) => events[type] = fn };
    vm.runInNewContext(source, { self, caches, URL, Response: { error: () => ({ error: true }) }, fetch: async request => {
      fetched.push(key(request)); if (offline) throw new Error('offline'); return response();
    } });
    return { events, claims: () => claims, async get(name, cache = 'default') {
      let pending; events.fetch({ request: { url: url(name), method: 'GET', cache }, respondWith: p => pending = p, waitUntil() {} });
      return pending;
    } };
  };
  return { boot, stores, fetched, installed, removed, setOffline: value => offline = value, setQuota: value => quota = value, setStatus: value => status = value };
}
test('AI cache stays independent of shell installation, survives upgrades, and serves offline without repeated downloads', async () => {
  const f = fixture(), first = f.boot();
  await new Promise(resolve => first.events.install({ waitUntil: p => p.then(resolve) }));
  assert.ok(f.installed.every(path => !path.endsWith('.onnx') && !path.endsWith('.wasm')));
  for (const name of files) assert.equal((await first.get(name)).status, 200);
  assert.equal(f.fetched.length, 4);
  await f.boot().get(files[0]); assert.equal(f.fetched.length, 4, 'reload must use persisted model without fetching');
  f.stores.set('sensor-cache', new Map()); f.stores.set('starlight-bell-soundanimation-v0', new Map());
  const upgrade = f.boot(code.replaceAll('2026.10.19.48', '2026.10.19.49'));
  await new Promise(resolve => upgrade.events.activate({ waitUntil: p => p.then(resolve) }));
  assert.equal(upgrade.claims(), 1); assert.ok(f.stores.has(modelCache)); assert.ok(f.stores.has('sensor-cache'));
  assert.ok(f.removed.includes('starlight-bell-soundanimation-v0')); assert.ok(!f.removed.includes(modelCache));
  f.setOffline(true);
  for (const name of files) assert.equal((await upgrade.get(name)).status, 200);
  assert.equal(f.fetched.length, 4, 'even offline reload needs no network for any required AI asset');
});
test('failed or partial downloads never poison the cache; unavailable storage still permits online analysis', async () => {
  const f = fixture(), sw = f.boot();
  for (const status of [404, 500, 206]) { f.setStatus(status); assert.equal((await sw.get(files[0])).status, status); }
  assert.equal(f.stores.get(modelCache).size, 0);
  f.setStatus(200); f.setQuota(true);
  assert.equal((await sw.get(files[0])).status, 200); assert.equal(f.stores.get(modelCache).size, 0);
  f.setQuota(false); await sw.get(files[0]); assert.equal(f.stores.get(modelCache).size, 1);
  const before = f.fetched.length; await sw.get(files[0], 'reload'); assert.equal(f.fetched.length, before + 1);
});
test('cache-first routing ignores other applications and outside requests', async () => {
  const { events } = fixture().boot();
  for (const other of ['https://example.test/other/vendor/beat-this/beat-this-small0.onnx', 'https://other.test/soundanimation/vendor/beat-this/beat-this-small0.onnx', base + 'vendor/beat-this/unknown.wasm']) {
    events.fetch({ request: { url: other, method: 'GET' }, respondWith() { assert.fail('outside request intercepted'); } });
  }
});
