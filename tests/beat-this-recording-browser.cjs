/* Private recording regression. Audio is decoded into a temporary directory only.
 * node tests/beat-this-recording-browser.cjs /path/to/recording.m4a
 * RECORDING_SCALE=.07 reproduces the reported microphone RMS around .0001.
 * Requires ffmpeg, Playwright and Chromium. Never writes audio into the repository.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const recording=process.argv[2];
if(!recording) throw Error('Pass the recording path as the first argument.');
const scale=Number(process.env.RECORDING_SCALE||.07),root=path.resolve(__dirname,'..');
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'beat-this-recording-'));
  const pcmFile=path.join(temp,'recording.f32');
  execFileSync('ffmpeg',['-v','error','-i',recording,'-ac','1','-ar','22050','-f','f32le',pcmFile]);
  const server=http.createServer((req,res)=>{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=name==='/test-recording.pcm'?pcmFile:path.resolve(root,'.'+(name==='/'?'/index.html':name));
    if(file!==pcmFile && !file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    try{
      res.setHeader('Content-Type',/\.(m?js)$/.test(file)?'text/javascript':file.endsWith('.wasm')?'application/wasm':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':file.endsWith('.html')?'text/html':'application/octet-stream');
      let data=fs.readFileSync(file);
      if(file.endsWith('/app.js')) data=data.toString().replace('  resize();\n  if','  window.recordingState = () => ({ rhythm, beatThisState, beatThisStatus, aiActive, latestInputLevel });\n  resize();\n  if');
      res.end(data);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
    const page=await browser.newPage({serviceWorkers:'block'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({scale})=>{
      navigator.mediaDevices.getUserMedia=async()=>{
        const context=new AudioContext();await context.resume();
        const pcm=new Float32Array(await(await fetch('/test-recording.pcm')).arrayBuffer());
        const buffer=context.createBuffer(1,pcm.length,22050);buffer.copyToChannel(pcm,0);
        const source=context.createBufferSource();source.buffer=buffer;source.loop=true;
        const gain=context.createGain();gain.gain.value=scale;
        const destination=context.createMediaStreamDestination();source.connect(gain);gain.connect(destination);source.start();
        const stop=destination.stream.getTracks()[0].stop.bind(destination.stream.getTracks()[0]);
        destination.stream.getTracks()[0].stop=()=>{source.stop();context.close();stop();};
        window.recordingVolume=value=>gain.gain.setValueAtTime(value,context.currentTime);
        return destination.stream;
      };
    },{scale});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(()=>window.ModelSetup?.complete,null,{timeout:30000});
    await page.click('#start');
    await page.waitForFunction(()=>window.recordingState().aiActive,null,{timeout:90000});
    const state=await page.evaluate(()=>window.recordingState());
    assert.ok(state.beatThisState.inputGain>128,'quiet recording exceeds the old gain cap');
    assert.equal(state.latestInputLevel.quiet,false);
    console.log('PASS recording reaches Beat This and renderer',JSON.stringify({bpm:state.rhythm.bpm,confidence:state.rhythm.confidence,inputRms:state.beatThisState.inputRms,inputGain:state.beatThisState.inputGain,adjustedRms:state.beatThisState.adjustedRms}));
    await page.evaluate(()=>window.recordingVolume(10));await page.waitForTimeout(500);
    const loud=await page.evaluate(()=>window.recordingState().latestInputLevel);
    assert.ok(loud.gain<state.latestInputLevel.gain/10);assert.ok(loud.adjustedRms<=.101);
    await page.evaluate(()=>window.recordingVolume(.0001));await page.waitForTimeout(1200);
    const quiet=await page.evaluate(()=>window.recordingState().latestInputLevel);
    assert.equal(quiet.quiet,false);assert.ok(quiet.gain>loud.gain*1000);
    console.log('PASS live loud → quiet change adjusts gain and reacquires input');
    await page.evaluate(()=>window.recordingVolume(0));await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>window.recordingState().latestInputLevel.quiet),true);
    console.log('PASS digital silence stops input activity');
    assert.deepEqual(errors,[]);await page.click('#stop');
  }finally{await browser?.close();server.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
