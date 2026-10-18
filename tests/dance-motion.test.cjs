const {test}=require('node:test'),assert=require('node:assert/strict');
const Dance=require('../dance-motion.js');
const calm={activity:.08,tension:.1,confidence:.95},lively={activity:.95,tension:.65,confidence:.95};
test('energy biases centre births and calm biases gathering, with every alternative and combination retained',()=>{
  const count=mood=>{
    const styles=[],entries=new Set(),exits=new Set(),pairs=new Set();
    for(let i=0;i<2000;i++) {
      const s=Dance.styles(mood,(i*.61803398875)%1,(i*.41421356237)%1,(i*.73205080757)%1,(i*.2360679775)%1);
      styles.push(s);entries.add(s.entryStyle);exits.add(s.exitStyle);pairs.add(`${s.entryStyle},${s.exitStyle}`);
    }
    assert.equal(entries.size,4);assert.equal(exits.size,4);assert.equal(pairs.size,16);
    return {births:styles.filter(s=>s.entryStyle<2).length,gathers:styles.filter(s=>s.exitStyle%2===0).length};
  };
  const quiet=count(calm),active=count(lively);
  assert.ok(active.births>quiet.births*1.5);
  assert.ok(quiet.gathers>active.gathers*1.5);
  assert.ok(active.births<1600 && quiet.gathers<1700);
});
test('breathing keeps the tempo-dependent beat intervals and grows membership with stable meter',()=>{
  const run=(meter,bpm,confidence=1)=>{
    const clock=new Dance.BreathingPulse();let pulse;
    for(let i=0;i<2400;i++) {
      const cycle=i/120*bpm/60;
      pulse=clock.update({tracking:true,confidence:1,bpm,period:60/bpm,beatCount:Math.floor(cycle),phase:cycle%1,meter,meterConfidence:confidence},1/120);
    }
    return pulse;
  };
  const unknown=run(0,120),known=run(4,120);
  assert.equal(unknown.interval,2);assert.ok(Math.abs(unknown.step-20.16)<.02);
  assert.equal(unknown.participation,2/3);assert.ok(known.participation>.899);
  assert.ok(run(3,120).participation>.899);
  assert.equal(run(4,120,.7).participation,2/3);
  assert.equal(run(0,180).interval,4);assert.equal(run(3,75).interval,1);assert.equal(run(3,120).interval,3);
  const count=pulse=>Array.from({length:1000},(_,i)=>Dance.breathingScale({...pulse,wave:1},i/1000,.8)).filter(s=>s>1.001).length;
  assert.ok(count(unknown)>650 && count(unknown)<690);assert.ok(count(known)>890 && count(known)<925);
});
test('breathing changes only size and remains continuous through meter, clock corrections and silence',()=>{
  const clock=new Dance.BreathingPulse();let last=1,pulse;
  for(let i=0;i<3600;i++) {
    const cycle=i/60*2+(i>1800?8:0);
    pulse=clock.update({tracking:i<3000,confidence:1,bpm:120,period:.5,beatCount:Math.floor(cycle),phase:cycle%1,meter:i<600?0:i<1800?4:3,meterConfidence:1},1/60);
    const scale=Dance.breathingScale(pulse,.7,.9);
    assert.ok(Math.abs(scale-last)<.82);assert.ok(scale>=.65 && scale<=3.05);
    assert.equal(Dance.breathingScale(pulse,.99,.9),1);last=scale;
  }
  assert.ok(Math.abs(last-1)<.0001);assert.equal(pulse.x,undefined);assert.equal(pulse.y,undefined);
});

test('breathing reaches three times normal diameter with a short smooth attack and distinct contraction',()=>{
  const clock=new Dance.BreathingPulse();clock.gain=1;
  const r={tracking:true,confidence:1,bpm:120,period:.5,beatCount:0,phase:0,meter:0,meterConfidence:0};
  const size=phase=>{clock.step=phase;return Dance.breathingScale(clock.update(r,0),0,.5);};
  assert.equal(size(0),.65);assert.equal(size(.16),3);assert.ok(Math.abs(size(.58)-.65)<1e-10);
  assert.ok(size(.10)>size(0)+.6);assert.equal(size(.8),.65);
  for(const boundary of [0,.16,.58,1]) {
    const left=size((boundary-1e-5+1)%1),right=size((boundary+1e-5)%1);
    assert.ok(Math.abs(left-right)<1e-6,'no jump at attack, release or cycle boundary');
  }
});

test('rendering waits for rhythm and rejects silent or unsupported clocks without an absolute volume gate',()=>{
 const r={tracking:true,confidence:.9,bpm:120,period:.5,time:20,lastSupport:19,quiet:0};
 assert.equal(Dance.rhythmVisible({...r,tracking:false}),false);
 assert.equal(Dance.rhythmVisible({...r,lastSupport:10}),false);
 assert.equal(Dance.rhythmVisible({...r,quiet:2}),false);
 assert.equal(Dance.rhythmVisible(r),true);
});
test('pulse peaks stay aligned to corrected attack clock for minutes without accumulating negative corrections',()=>{
 const clock=new Dance.BreathingPulse();let maxError=0,peak=0;
 for(let i=0;i<60*180;i++) {
  const cycle=i/30 + .07*Math.sin(i/180);
  const r={tracking:true,confidence:1,bpm:120,period:.5,beatCount:Math.floor(cycle),phase:cycle%1,meter:0,meterConfidence:0};
  const pulse=clock.update(r,1/60);
  if(i>600) {
   const target=cycle/2+.16,error=((pulse.step-target+.5)%1+1)%1-.5;
   maxError=Math.max(maxError,Math.abs(error));
   if(Math.abs(cycle-Math.round(cycle/2)*2)<.015) peak=Math.max(peak,Dance.breathingScale(pulse,0,.5));
  }
 }
 assert.ok(maxError<.01);assert.ok(peak>2.98);
});
