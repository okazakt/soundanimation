/* Optional real-browser smoke test: node tests/beat-this-browser.cjs
 * Requires Playwright and Chromium. Uses only locally synthesized test audio.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-this-browser-'));
const inputGain = Number(process.env.BEAT_THIS_INPUT_GAIN || 1);
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
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (kick + snare + hat + harmony) * inputGain)) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, wav);
}
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try {
      const type = (file.endsWith('.js') || file.endsWith('.mjs')) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : (file.endsWith('.f32') || file.endsWith('.onnx')) ? 'application/octet-stream' : file.endsWith('.wasm') ? 'application/wasm' : 'text/html';
      res.setHeader('Content-Type', type);
      let data = fs.readFileSync(file);
      if (file.endsWith('/app.js')) data = data.toString().replace('  resize();\n  if', '  window.beatThisTest = () => ({ rhythm, basicRhythm, beatThisState, beatThisStatus, aiActive });\n  resize();\n  if');
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    for (const meter of (process.env.BEAT_THIS_METER ? [Number(process.env.BEAT_THIS_METER)] : [3, 4])) {
      const wav = path.join(temporary, `meter-${meter}.wav`); synthesize(wav, meter);
      const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
        args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
      let log;
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
        const requested = []; page.on('request', request => requested.push(request.url()));
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        await page.waitForFunction(() => window.ModelSetup?.complete, null, { timeout: 30000 });
         await page.click('#start');
        page.on('console', msg => { if (msg.type() === 'error') console.log('BROWSER', msg.text()); });
        log = setInterval(async () => { try { console.log(await page.evaluate(() => ({ status: window.beatThisTest().beatThisStatus, state: window.beatThisTest().beatThisState && { bpm: window.beatThisTest().beatThisState.bpm, meter: window.beatThisTest().beatThisState.meter, meterConfidence: window.beatThisTest().beatThisState.meterConfidence, processingMs: window.beatThisTest().beatThisState.processingMs }, active: window.beatThisTest().aiActive }))); } catch {} }, 5000);
        await page.waitForFunction(expected => {
          const s = window.beatThisTest(); return s.aiActive && (expected === 3 || s.rhythm.meter === expected) && Math.abs(s.rhythm.bpm - 120) < 8;
        }, meter, { timeout: 90000 });
        clearInterval(log); await page.waitForTimeout(4000);
        const result = await page.evaluate(() => ({ bpm: window.beatThisTest().rhythm.bpm, meter: window.beatThisTest().rhythm.meter }));
        if (meter === 4) assert.equal(result.meter, meter); // small0's synthetic triple-meter accuracy is not established.
        assert.ok(Math.abs(result.bpm - 120) < 8); assert.ok(await page.evaluate(() => window.beatThisTest().aiActive)); console.log('PASS microphone → resampler → Beat This! → renderer', result);
        console.log('STATE', await page.evaluate(() => ({ status: window.beatThisTest().beatThisStatus, debug: document.querySelector('#debug-ai').textContent, inputRms: window.beatThisTest().beatThisState?.inputRms, inputGain: window.beatThisTest().beatThisState?.inputGain })));
        if (inputGain < 1) {
          const levels = await page.evaluate(() => window.beatThisTest().beatThisState);
          assert.ok(levels.inputRms > 0 && levels.inputRms < .003, 'low input reproduces the previous silence gate regression');
          assert.ok(levels.inputGain > 8, 'low input receives enough gain');
        }
        await page.waitForTimeout(12000);
        assert.ok(await page.evaluate(() => window.beatThisTest().beatThisState.windowSeconds === 8 && !window.beatThisTest().beatThisStatus.includes('リズム判定を停止')), 'rolling inference reaches a full window without accumulating a capture backlog');
        if (meter === 4) await page.screenshot({ path: '/tmp/beat-this-browser.png' });
        assert.ok(!requested.some(url => url.includes('beatnet')));
        await page.click('#stop');
        assert.equal(await page.evaluate(() => window.beatThisTest().beatThisState), null);
        assert.deepEqual(errors, []);
        await page.route('**/vendor/beat-this/beat-this-small0.onnx', route => route.fulfill({ status: 404, body: '' }));
        await page.click('#start');
        await page.waitForFunction(() => window.beatThisTest().beatThisStatus.includes('リズム判定を停止'));
        assert.equal(await page.evaluate(() => window.beatThisTest().rhythm.engine), 'basic');
        await page.click('#stop');
        console.log('PASS bounded live windows, lazy assets, stop, switching and model-load fallback');
      } finally { clearInterval(log); await browser.close(); }
    }
  } finally { server.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
