const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Tracker}=require('../beat-this-rhythm.js');
const {normalize,Resampler,AutoLevel}=require('../beat-this-audio.js');
function probabilities(start,duration,meter=4,miss=-1) {
  const beatConfidence=new Float32Array(duration*50+1), downbeatConfidence=new Float32Array(beatConfidence.length);
  for(let i=0;i<beatConfidence.length;i++) {
    const t=start+i/50, beat=Math.round((t-.2)/.5);
    if(Math.abs(t-(.2+beat*.5))<.005) {
      beatConfidence[i]=beat===miss ? .05 : .9;
      downbeatConfidence[i]=beat%meter===0 ? .95 : .05;
    }
  }
  return {beatConfidence,downbeatConfidence};
}
for(const meter of [3,4]) test(`phase voting locks ${meter} across sliding windows and retains missed downbeats`,()=>{
  const t=new Tracker();let s;
  for(let end=2;end<=18;end++) s=t.summarize(probabilities(Math.max(0,end-8),Math.min(end,8),meter),Math.max(0,end-8),Math.min(end,8));
  assert.equal(s.meter,meter);assert.equal(s.bpm,120);assert.ok(s.meterConfidence>.6);
  const before=s.beatInBar;
  s=t.summarize(probabilities(11,8,meter,36),11,8);
  assert.equal(s.meter,meter);assert.equal(s.beatInBar,(before+1)%meter+1);
  assert.ok(t.frames.size<=1601);
});
test('sum head keeps a downbeat with weak beat output, crops both edges, NMS rejects close noise',()=>{
  const r=probabilities(100,8,4,204);r.beatConfidence[200]=.8;r.beatConfidence[201]=.99;
  const s=new Tracker().summarize(r,100,8);
  assert.equal(s.bpm,120);assert.ok(s.lastBeatAudioTime<=107.5);
  assert.ok(s.beatCount>10);
});
test('silence resets probability history and meter, uniform downbeat confidence cannot lock',()=>{
  const t=new Tracker();let s;
  for(let end=8;end<=12;end++) s=t.summarize(probabilities(end-8,8),end-8,8);
  assert.equal(s.meter,4);
  s=t.summarize({beatConfidence:[],downbeatConfidence:[]},5,8,true);
  assert.equal(s.confidence,0);assert.equal(s.meter,0);assert.equal(t.frames.size,0);
  for(let end=14;end<=18;end++) {const r=probabilities(end-8,8);r.downbeatConfidence.fill(.8);s=t.summarize(r,end-8,8);}
  assert.equal(s.meter,0);
});
test('noise gate precedes gain and peak limiting preserves waveform ratios',()=>{
  const silent=new Float32Array(22050).fill(.001);assert.equal(normalize(silent).quiet,true);assert.ok(silent.every(x=>x===0));
  const pcm=Float32Array.of(.01,-.02,.03,-.04),n=normalize(pcm);
  assert.ok(Number.isFinite(n.gain));assert.ok(Math.abs((pcm[3]-pcm[2])/(pcm[1]-pcm[0])-7/3)<1e-5);
});
test('resampling is independent of input block boundaries and rejects high frequency aliasing',()=>{
  const input=Float32Array.from({length:48000},(_,i)=>Math.sin(2*Math.PI*14000*i/48000));
  const whole=new Resampler(48000).process(input),r=new Resampler(48000),out=[];
  for(let i=0;i<input.length;i+=2048) out.push(...r.process(input.subarray(i,i+2048)));
  assert.deepEqual(Float32Array.from(out),whole);
  assert.ok(Math.sqrt(whole.slice(100).reduce((s,x)=>s+x*x,0)/(whole.length-100))<.05);
});

for (const rms of [1e-8, .000001, .0001, .001, .0012, .01, .1, .5]) test(`microphone RMS ${rms} reaches inference with finite unclipped normalization`,()=>{
  const pcm=Float32Array.from({length:22050},(_,i)=>Math.SQRT2*rms*Math.sin(2*Math.PI*100*i/22050));
  const n=normalize(pcm);
  assert.equal(n.quiet,false);assert.ok(n.gain>0);
  const actualRms=Math.sqrt(pcm.reduce((s,x)=>s+x*x,0)/pcm.length);
  assert.ok(Math.abs(actualRms-.1)<1e-6);
  assert.ok(pcm.every(x=>Number.isFinite(x)&&Math.abs(x)<=.951));
});
test('digital silence and DC offset remain silent at any adaptive gain',()=>{
  for (const pcm of [new Float32Array(22050),new Float32Array(22050).fill(.001)]) {
    assert.equal(normalize(pcm).quiet,true);assert.ok(pcm.every(x=>x===0));
  }
});

test('adaptive window normalization is invariant to recording level and recovers after loud input',()=>{
  const original=Float32Array.from({length:22050},(_,i)=>(1+Math.sin(i*.0007))*(Math.sin(i*.07)*.2+Math.cos(i*.011)*.1));
  const base=original.slice();normalize(base);
  for(const scale of [1e-6,.0001,.01,1,10]) {
    const pcm=Float32Array.from(original,x=>x*scale);const n=normalize(pcm);
    assert.equal(n.quiet,false);assert.ok(n.adjustedRms>.002);
    assert.ok(pcm.every((x,i)=>Math.abs(x-base[i])<1e-6));
  }
});
test('continuous level control attenuates loud sounds immediately and reacquires very quiet input',()=>{
  const level=new AutoLevel(), block=rms=>Float32Array.from({length:2205},(_,i)=>Math.SQRT2*rms*Math.sin(2*Math.PI*100*i/22050));
  let s=level.observe(block(.00001),22050);assert.ok(s.gain>1000);assert.equal(s.quiet,false);
  s=level.observe(block(.3),22050);assert.ok(s.gain<1);assert.ok(s.adjustedRms<=.100001);
  for(let i=0;i<8;i++) s=level.observe(block(.00001),22050);
  assert.ok(s.gain>1000);assert.equal(s.quiet,false);
  s=level.observe(new Float32Array(2205),22050);assert.equal(s.quiet,true);
});
test('coherent weaker neural peaks survive while low model evidence and irregular timing stay uncertain',()=>{
  const regular=probabilities(0,8);
  regular.beatConfidence=Float32Array.from(regular.beatConfidence,x=>x*.3);
  regular.downbeatConfidence.fill(0);
  const s=new Tracker().summarize(regular,0,8);
  assert.equal(s.bpm,120);assert.ok(s.confidence>.55);
  regular.beatConfidence=Float32Array.from(regular.beatConfidence,x=>x*.1);
  assert.equal(new Tracker().summarize(regular,0,8).confidence,0);
  const irregular={beatConfidence:new Float32Array(401),downbeatConfidence:new Float32Array(401)};
  for(const t of [1,1.32,2.2,2.9,4,4.4,5.4,5.72,6.6]) irregular.beatConfidence[Math.round(t*50)]=.9;
  assert.ok(new Tracker().summarize(irregular,0,8).confidence<.55);
});
test('32-beat meter history retains a supported slow meter even when its phase anchor is over 20 seconds old',()=>{
  const t=new Tracker();let s;
  for(let end=16;end<=60;end+=2) {
    const start=end-16,bp=new Float32Array(801),dp=new Float32Array(801);
    for(let i=0;i<801;i++) {
      const time=start+i/50,beat=Math.round(time-.2);
      if(Math.abs(time-(beat+.2))<.005) {bp[i]=.9;dp[i]=beat%4===0?.95:.05;}
    }
    s=t.summarize({beatConfidence:bp,downbeatConfidence:dp},start,16);
  }
  assert.equal(s.bpm,60);assert.equal(s.meter,4);assert.ok(s.beatCount>=24);assert.ok(t.frames.size<=1601);
  assert.ok(60-t.lock.anchor>20);assert.equal(t.lock.updatedAt,60);
});
test('an exponentially dying filter tail is not periodically re-amplified as a new quiet scene',()=>{
  const level=new AutoLevel();let state;
  const block=amplitude=>Float32Array.from({length:2048},(_,i)=>amplitude*Math.sin(i*.1));
  level.observe(block(.1),44100);
  for(let step=1;step<=12;step++) {
    state=level.observe(block(.1*Math.exp(-step*4)),44100);
    assert.equal(state.drop,false);
    if(step>=2) assert.equal(state.quiet,true);
  }
  for(let step=0;step<10;step++) state=level.observe(block(.000001),44100);
  assert.equal(state.quiet,false,'stable real low input can still be reacquired after silence');
});
