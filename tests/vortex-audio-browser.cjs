const {chromium}=require('playwright');
const fs=require('fs');
const path=require('path');
const os=require('os');
const artifact= name=>path.join(process.env.VORTEX_ARTIFACT_DIR || os.tmpdir(),name);
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:390,height:740}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const root=path.resolve(__dirname,'..')+path.sep;
await page.setContent(fs.readFileSync(root+'index.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'').replace(/<link[^>]*>/g,''));
await page.addStyleTag({path:root+'style.css'});
await page.evaluate(async()=>{
window.ModelSetup={complete:true};
const context=new AudioContext();const bus=context.createGain();bus.gain.value=0;
const destination=context.createMediaStreamDestination();bus.connect(destination);
for(const [hz,amplitude] of [[220,1],[1100,.6],[4000,.3]]){const oscillator=context.createOscillator(),gain=context.createGain();oscillator.frequency.value=hz;gain.gain.value=amplitude;oscillator.connect(gain);gain.connect(bus);oscillator.start();}
window.testAudio={context,bus};await context.resume();
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>destination.stream,addEventListener(){}}});
});
for(const path of ['beat-clock.js','dance-motion.js'])await page.addScriptTag({path:root+path});
const code=fs.readFileSync(root+'app.js','utf8').replace('  resize();\n  if','  window.testState=()=>({vortex,inputGainNode,vortexAnalyser});\n  resize();\n  if');
await page.addScriptTag({content:code});
await page.evaluate(()=>{document.querySelector('#model-setup').remove();const shell=document.querySelector('#app-shell');shell.hidden=false;shell.inert=false;document.querySelector('#start').disabled=false;document.querySelector('details').open=false;});
await page.locator('#previous-mode').click();await page.locator('#start').click();
async function level(value){await page.evaluate(v=>{testAudio.bus.gain.setValueAtTime(v,testAudio.context.currentTime);},value);}
async function sample(value,path){
 await level(value);
 const result=await page.evaluate(async()=>{
  let maxRadius=0,maxSpeed=0,count=0;const seen=new Set(),end=performance.now()+320;
  while(performance.now()<end){await new Promise(requestAnimationFrame);for(const p of testState().vortex.particles){if(p.age<.14){seen.add(p);maxRadius=Math.max(maxRadius,p.radius);maxSpeed=Math.max(maxSpeed,Math.hypot(p.vx,p.vy));}}}
  return {count:seen.size,radius:maxRadius,speed:maxSpeed};
 });
 await page.screenshot({path});await level(0);await page.waitForTimeout(2500);return result;
}
await sample(.12,artifact('vortex-audio-calibration.png'));
// Simulate a large gain in the shared display path: the raw branch must remain independent.
await page.evaluate(()=>testState().inputGainNode.gain.value=100);
const weak=await sample(.012,artifact('vortex-audio-weak.png'));
const strong=await sample(.12,artifact('vortex-audio-strong.png'));
await page.waitForTimeout(600);
const remaining=await page.evaluate(()=>testState().vortex.particles.length);
const result={errors,weak,strong,remaining};console.log(JSON.stringify(result));
if(errors.length||!weak.count||!strong.count||strong.speed<weak.speed*3||strong.radius<weak.radius*1.7||remaining!==0)throw new Error('Real AudioContext contrast regression failed');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
