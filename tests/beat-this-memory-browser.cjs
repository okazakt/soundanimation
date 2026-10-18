/* Optional real-browser smoke test: node tests/beat-this-memory-browser.cjs
 * Requires Playwright and Chromium. Uses only locally synthesized test audio.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(process.env.BEAT_THIS_ROOT || path.join(__dirname, '..')), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-this-memory-'));
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
      res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : /\.(onnx|f32)$/.test(file) ? 'application/octet-stream' : 'text/html');
      let data = fs.readFileSync(file);
      if (file.endsWith('/app.js')) data = data.toString().replace('  resize();\n  if', '  window.beatThisTest = () => ({ beatThisState, beatThisStatus, aiActive, rhythm });\n  resize();\n  if');
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const wav = path.join(temporary, 'four.wav'); synthesize(wav, 4);
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
  let timer, stage = 'setup', peak = {}, page, lastAudioTime=-Infinity;
  const observations=[];
  try {
    const cdp = await browser.newBrowserCDPSession();
    const sample = async () => {
      const info = await cdp.send('SystemInfo.getProcessInfo'); let kb = 0;
      for (const proc of info.processInfo.filter(p => p.type === 'renderer')) {
        try { const status = fs.readFileSync(`/proc/${proc.id}/status`, 'utf8'); kb += Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0); } catch {}
      }
      peak[stage] = Math.max(peak[stage] || 0, kb / 1024);
      if(page) {
        const s=await page.evaluate(()=>window.beatThisTest?.().beatThisState).catch(()=>null);
        if(s && s.audioTime!==lastAudioTime) {lastAudioTime=s.audioTime;observations.push({windowSeconds:s.windowSeconds,processingMs:s.processingMs,windowLimitSeconds:s.windowLimitSeconds,hopSeconds:s.hopSeconds});}
      }
    };
    timer = setInterval(() => sample().catch(() => {}), 250);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    page = await context.newPage();
    page.on('pageerror', error => console.log('PAGEERROR', error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.ModelSetup?.complete, null, { timeout: 60000 }); await sample();
    stage = 'load';  await page.click('#start');
    await page.waitForFunction(() => { const s=window.beatThisTest().beatThisState;return s && s.windowSeconds===s.windowLimitSeconds; }, null, { timeout: 60000 }); await sample();
    stage = 'inference'; await page.waitForTimeout(Number(process.env.BEAT_THIS_DURATION_MS || 16000)); await sample();
    console.log('MEMORY', JSON.stringify({ root, rendererPeakMiB: peak, observations, state: await page.evaluate(() => ({ ...window.beatThisTest().beatThisState, canvasWidth: document.querySelector('#canvas').width, status: window.beatThisTest().beatThisStatus })) }));
    assert.ok(await page.evaluate(() => window.beatThisTest().beatThisState?.bpm > 0)); await page.click('#stop');
  } finally { clearInterval(timer); await browser.close(); server.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
