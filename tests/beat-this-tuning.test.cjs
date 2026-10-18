const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Tracker}=require('../beat-this-rhythm.js');
const {normalize,Resampler}=require('../beat-this-audio.js');
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
  assert.ok(t.frames.size<=801);
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
  assert.ok(n.gain<=8);assert.ok(Math.abs(pcm[3]/pcm[0]+4)<1e-5);
});
test('resampling is independent of input block boundaries and rejects high frequency aliasing',()=>{
  const input=Float32Array.from({length:48000},(_,i)=>Math.sin(2*Math.PI*14000*i/48000));
  const whole=new Resampler(48000).process(input),r=new Resampler(48000),out=[];
  for(let i=0;i<input.length;i+=2048) out.push(...r.process(input.subarray(i,i+2048)));
  assert.deepEqual(Float32Array.from(out),whole);
  assert.ok(Math.sqrt(whole.slice(100).reduce((s,x)=>s+x*x,0)/(whole.length-100))<.05);
});
