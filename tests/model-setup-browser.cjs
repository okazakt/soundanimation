/* Optional real-browser setup test. Requires Playwright and Chromium. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const counts = new Map(); let failures = 0;
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/soundanimation/')) { res.writeHead(404); return res.end(); }
    const relative = pathname.slice('/soundanimation'.length), file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try {
      if (file.endsWith('asyncify.wasm') && failures === 0) { failures++; res.writeHead(503); return res.end('temporary error'); }
      if (pathname.includes('/vendor/beat-this/')) counts.set(path.basename(file), (counts.get(path.basename(file)) || 0) + 1);
      const type = /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : /\.(onnx|f32)$/.test(file) ? 'application/octet-stream' : 'text/html';
      res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'no-store');
      const data = fs.readFileSync(file);
      if (/\.(onnx|wasm)$/.test(file)) {
        let offset = 0;
        const send = () => { if (res.destroyed) return; if (offset >= data.length) return res.end(); res.write(data.subarray(offset, offset + 262144)); offset += 262144; setTimeout(send, 10); }; send();
      } else res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => { window.microphoneRequests = 0; navigator.mediaDevices.getUserMedia = async () => { window.microphoneRequests++; throw new Error('unexpected microphone request'); }; });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/soundanimation/`);
    await page.waitForFunction(() => window.ModelSetup?.percent > 5 && window.ModelSetup.percent < 95);
    assert.equal(await page.locator('#start').isDisabled(), true);
    assert.match(await page.locator('#setup-percent').textContent(), /%$/);
    await page.waitForFunction(() => window.ModelSetup.phase === 'error', null, { timeout: 30000 });
    assert.equal(await page.locator('#setup-retry').isVisible(), true);
    assert.equal(await page.evaluate(() => document.querySelector('#app-shell').hidden), true);
    assert.equal(await page.evaluate(() => window.microphoneRequests), 0);
    await page.screenshot({ path: '/tmp/beat-this-v19-setup-error.png' });
    await page.click('#setup-retry');
    await page.waitForFunction(() => window.ModelSetup.complete, null, { timeout: 30000 });
    assert.equal(await page.locator('#start').isEnabled(), true);
    for (const name of ['beat-this.onnx', 'beat-this.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) assert.equal(counts.get(name), 1);
    console.log('PASS page setup failure remains blocked; retry reuses completed model and finishes only missing engine');
    const downloaded = [...counts]; await page.reload();
    await page.waitForFunction(() => window.ModelSetup.complete, null, { timeout: 10000 }); assert.deepEqual([...counts], downloaded);
    await context.setOffline(true); await page.reload();
    await page.waitForFunction(() => window.ModelSetup.complete, null, { timeout: 10000 }); assert.deepEqual([...counts], downloaded);
    assert.equal(await page.evaluate(() => window.microphoneRequests), 0); assert.deepEqual(errors, []);
    console.log('PASS online/offline page reloads reuse all files without downloading or opening microphone');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
