/* Optional real-browser smoke test: node tests/beat-this-pwa-browser.cjs
 * Requires Playwright and Chromium. Uses only locally synthesized test audio.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-this-pwa-'));
function synthesize(file, meter) {
  const rate = 16000, length = rate * 26, wav = Buffer.alloc(44 + length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(length * 2, 40);
  let random = 7; const noise = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 2147483648 - 1; };
  for (let i = 0; i < length; i++) {
    const t = i / rate, beat = Math.floor(t * 2), phase = t % .5, position = beat % meter;
    const kick = (position === 0 ? .52 : meter === 4 && position === 2 ? .2 : 0) * Math.exp(-phase * 24) * Math.sin(2 * Math.PI * (60 * phase + 2 * (1 - Math.exp(-phase * 40))));
    const snare = (position % 2 ? .16 : .04) * Math.exp(-phase * 32) * noise();
    const hat = .08 * Math.exp(-(t % .25) * 90) * noise();
    const chord = Math.floor(beat / meter) % 2 ? [293.66, 349.23, 440] : [261.63, 329.63, 392];
    const harmony = chord.reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * t) * .012, 0);
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, kick + snare + hat + harmony)) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, wav);
}
(async () => {
  const counts = new Map();
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/soundanimation/')) { res.writeHead(404); return res.end(); }
    const relative = pathname.slice('/soundanimation'.length);
    const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try {
      if (pathname.includes('/vendor/beat-this/')) counts.set(path.basename(file), (counts.get(path.basename(file)) || 0) + 1);
      const type = /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : /\.(onnx|f32)$/.test(file) ? 'application/octet-stream' : 'text/html';
      res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'no-store');
      let data = fs.readFileSync(file);
      if (file.endsWith('/app.js')) data = data.toString().replace('  resize();\n  if', `  window.beatThisTest = () => ({ rhythm, beatThisState, beatThisStatus, aiActive, beatThisStorageStatus });
  window.injectInputGap = () => beatThisClient.worker.postMessage({ type: 'pcm', pcm: new Float32Array(2048), audioTime: audio.currentTime + 2, rate: audio.sampleRate });
  resize();\n  if`);
      if (/\.(onnx|wasm)$/.test(file)) {
        let offset = 0;
        const send = () => { if (res.destroyed) return; if (offset >= data.length) return res.end(); res.write(data.subarray(offset, offset + 262144)); offset += 262144; setTimeout(send, 10); };
        send();
      } else res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const wav = path.join(temporary, 'meter-4.wav'); synthesize(wav, 4);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
  let log;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    await context.addInitScript(() => {
      window.microphoneRequests = 0; const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => { window.microphoneRequests++; return get(...args); };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') console.log('BROWSER', msg.text()); });
    log = setInterval(async () => { try { console.log('STATUS', await page.evaluate(() => window.beatThisTest && ({ engine: window.beatThisTest().beatThisStatus, storage: window.beatThisTest().beatThisStorageStatus, state: window.beatThisTest().beatThisState?.time, input: document.querySelector('#debug-input').textContent }))); } catch {} }, 5000);
    await page.goto(`http://127.0.0.1:${server.address().port}/soundanimation/`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForFunction(() => window.ModelSetup?.phase === 'downloading' && window.ModelSetup.percent > 5 && window.ModelSetup.percent < 95);
    assert.equal(await page.locator('#start').isDisabled(), true);
    assert.equal(await page.evaluate(() => document.querySelector('#app-shell').inert), true);
    assert.equal(await page.evaluate(() => window.microphoneRequests), 0);
    await page.screenshot({ path: '/tmp/beat-this-v19-setup.png' });
    await page.waitForFunction(() => window.ModelSetup?.complete, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.microphoneRequests), 0);
    console.log('PASS page view streams percentage and blocks operations before microphone access');
     await page.click('#start');
    await page.waitForFunction(() => window.beatThisTest().beatThisState?.time >= 8, null, { timeout: 60000 });
    await page.waitForFunction(() => window.beatThisTest().beatThisStorageStatus.includes('保存済み'));
    for (const name of ['beat-this-small0.onnx', 'beat-this-cpu.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) assert.equal(counts.get(name), 1, name);
    const downloaded = [...counts];
    console.log('PASS page setup persists model and all runtime assets once', downloaded);
    await page.click('#stop'); await context.setOffline(true); await page.reload();
    await page.waitForFunction(() => window.ModelSetup?.complete, null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => window.microphoneRequests), 0);
     await page.click('#start');
    await page.waitForFunction(() => window.beatThisTest().beatThisState?.time >= 8, null, { timeout: 60000 });
    await page.waitForFunction(() => window.beatThisTest().beatThisStorageStatus.includes('保存済み'));
    assert.deepEqual([...counts], downloaded);
    console.log('PASS offline reload runs real inference without downloading any AI asset');
    await page.evaluate(() => window.injectInputGap());
    await page.waitForFunction(() => window.beatThisTest().beatThisStatus.includes('自動再同期'));
    assert.equal(await page.evaluate(() => window.beatThisTest().beatThisState), null);
    await page.waitForFunction(() => window.beatThisTest().beatThisState?.resyncCount >= 1, null, { timeout: 45000 });
    assert.deepEqual([...counts], downloaded);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/beat-this-v19-pwa.png' });
    console.log('PASS input gap invalidates phase, then inference recovers without reload or model download');
    await page.click('#stop');
  } finally { clearInterval(log); await browser.close(); server.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
