/* Optional real-browser smoke test: node tests/beatnet-browser.cjs
 * Requires Playwright and Chromium. Uses only locally synthesized test audio.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'beatnet-browser-'));
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
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try {
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : file.endsWith('.f32') ? 'application/octet-stream' : 'text/html';
      res.setHeader('Content-Type', type);
      let data = fs.readFileSync(file);
      if (file.endsWith('/app.js')) data = data.toString().replace('  resize();\n  if', '  window.beatNetTest = () => ({ rhythm, basicRhythm, beatNetState, beatNetStatus, aiActive });\n  resize();\n  if');
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    for (const meter of [3, 4]) {
      const wav = path.join(temporary, `meter-${meter}.wav`); synthesize(wav, meter);
      const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
        args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(url); await page.click('#start');
        await page.waitForFunction(expected => {
          const s = window.beatNetTest(); return s.aiActive && s.rhythm.meter === expected && Math.abs(s.rhythm.bpm - 120) < 4;
        }, meter, { timeout: 25000 });
        await page.waitForTimeout(4000);
        const result = await page.evaluate(() => ({ bpm: window.beatNetTest().rhythm.bpm, meter: window.beatNetTest().rhythm.meter }));
        assert.equal(result.meter, meter); assert.ok(Math.abs(result.bpm - 120) < 5); assert.ok(await page.evaluate(() => window.beatNetTest().aiActive)); console.log('PASS microphone → resampler → BeatNet → renderer', result);
        await page.selectOption('#analysis-engine', 'basic');
        assert.equal(await page.evaluate(() => window.beatNetTest().rhythm.engine), 'basic');
        await page.selectOption('#analysis-engine', 'beatnet'); await page.waitForTimeout(500);
        await page.click('#stop');
        assert.equal(await page.evaluate(() => window.beatNetTest().beatNetState), null);
        assert.deepEqual(errors, []);
        if (meter === 4) {
          const offlineContext = await browser.newContext({ serviceWorkers: 'allow' });
          const offlinePage = await offlineContext.newPage();
          await offlinePage.goto(url);
          await offlinePage.evaluate(() => navigator.serviceWorker.ready);
          await offlinePage.reload();
          await offlinePage.waitForFunction(() => navigator.serviceWorker.controller !== null);
          await offlineContext.setOffline(true); await offlinePage.click('#start');
          await offlinePage.waitForFunction(() => window.beatNetTest().beatNetState?.time > .5, null, { timeout: 12000 });
          assert.ok(Number.isFinite(await offlinePage.evaluate(() => window.beatNetTest().beatNetState.bpm)));
          await offlinePage.click('#stop'); await offlineContext.close();
          console.log('PASS offline cached model, worker and AudioWorklet');
        }
        // Failure must leave the live microphone visualization available.
        await page.route('**/vendor/beatnet/model-1.f32', route => route.fulfill({ status: 404, body: '' }));
        await page.click('#start');
        await page.waitForFunction(() => window.beatNetTest().beatNetStatus.includes('従来方式で継続'));
        assert.equal(await page.evaluate(() => window.beatNetTest().rhythm.engine), 'basic');
        await page.click('#stop'); console.log('PASS mode switching, cancellation and model-load fallback');
      } finally { await browser.close(); }
    }
  } finally { server.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
