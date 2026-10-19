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
 const before=await page.evaluate(()=>({absorbed:testState().vortex.absorbed,expired:testState().vortex.expired}));
 await level(value);
 const result=await page.evaluate(async()=>{
  let maxRadius=0,maxSpeed=0,count=0;const seen=new Set(),end=performance.now()+320;
  while(performance.now()<end){await new Promise(requestAnimationFrame);for(const p of testState().vortex.particles){if(p.age<.14){seen.add(p);maxRadius=Math.max(maxRadius,p.radius);maxSpeed=Math.max(maxSpeed,Math.hypot(p.vx,p.vy));}}}
  window.lastCohort=[...seen];return {count:seen.size,radius:maxRadius,speed:maxSpeed};
 });
 await page.screenshot({path});await level(0);
 if(value>=.1){
  await page.waitForFunction(()=>testState().vortex.particles.some(p=>p.returning&&p.radius>8&&Math.hypot(p.x,p.y)>30&&Math.hypot(p.x,p.y)<160&&p.x*p.vx+p.y*p.vy<0),null,{timeout:10000});
  await page.screenshot({path:path.replace('.png','-returning.png')});
 }
 await page.waitForFunction(()=>testState().vortex.particles.length===0,null,{timeout:24000});
 const finish=await page.evaluate(()=>({absorbed:testState().vortex.absorbed,expired:testState().vortex.expired,allAbsorbed:lastCohort.every(p=>p.finishReason==='absorbed'),returnTime:Math.max(...lastCohort.map(p=>p.age))}));
 return {...result,absorbed:finish.absorbed-before.absorbed,expired:finish.expired-before.expired,allAbsorbed:finish.allAbsorbed,returnTime:finish.returnTime};
}
await sample(.12,artifact('vortex-audio-calibration.png'));
// Simulate a large gain in the shared display path: the raw branch must remain independent.
await page.evaluate(()=>testState().inputGainNode.gain.value=100);
const weak=await sample(.012,artifact('vortex-audio-weak.png'));
const strong=await sample(.12,artifact('vortex-audio-strong.png'));
await page.waitForTimeout(600);
const remaining=await page.evaluate(()=>testState().vortex.particles.length);
// A stepped, slowly rising bass must create a genuinely large, slower cohort.
await level(.06);await page.waitForTimeout(500);
await level(.085);
const slowLarge=await page.evaluate(async()=>{
 const old=new Set(testState().vortex.particles),found=[],end=performance.now()+600;
 while(performance.now()<end){await new Promise(requestAnimationFrame);for(const p of testState().vortex.particles){if(!old.has(p)&&p.age<.1&&p.radius>=8)found.push({radius:p.radius,speed:Math.hypot(p.vx,p.vy)});}}
 return found;
});
await level(0);await page.waitForFunction(()=>testState().vortex.particles.length===0,null,{timeout:24000});
const result={errors,weak,strong,remaining,slowLarge};console.log(JSON.stringify(result));
if(errors.length||!weak.count||!strong.count||strong.speed<weak.speed*3||strong.radius<weak.radius*1.7||remaining!==0||!weak.allAbsorbed||!strong.allAbsorbed||weak.expired||strong.expired||!slowLarge.some(p=>p.speed<strong.speed*.6))throw new Error('Real AudioContext contrast regression failed');
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
