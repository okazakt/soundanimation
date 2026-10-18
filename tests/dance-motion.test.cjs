const {test}=require('node:test'),assert=require('node:assert/strict');
const Dance=require('../dance-motion.js');
const calm={activity:.08,tension:.1,confidence:.95},lively={activity:.95,tension:.65,confidence:.95};
const rhythm={beatCount:12,phase:.5,confidence:.9,meter:3,meterConfidence:1,beatInBar:1,period:.5};
test('triple meter sweeps over a bar while quadruple meter alternates side steps',()=>{
  const triple=[],quad=[];
  for(let beat=1;beat<=4;beat++){
    if(beat<=3) triple.push(Dance.sample({...rhythm,meter:3,beatInBar:beat},lively,0,0).x);
    quad.push(Dance.sample({...rhythm,meter:4,beatInBar:beat},lively,0,0).x);
  }
  assert.ok(triple[0]>0 && Math.abs(triple[1])<.001 && triple[2]<0);
  assert.deepEqual(quad.map(Math.sign),[1,-1,1,-1]);
});
test('the first beat has an accent, mood scales movement, and voices retain individual motion',()=>{
  const first=Dance.sample({...rhythm,phase:0,beatInBar:1},lively,0,0);
  const weak=Dance.sample({...rhythm,phase:0,beatInBar:2},lively,0,0);
  assert.ok(first.accent>weak.accent*2);
  const quiet=Dance.sample(rhythm,calm,0,0),active=Dance.sample(rhythm,lively,0,0);
  assert.ok(Math.hypot(active.x,active.y)>Math.hypot(quiet.x,quiet.y)*1.5);
  const voices=Array.from({length:10},(_,id)=>Dance.sample(rhythm,lively,id,1));
  assert.ok(new Set(voices.map(v=>v.x.toFixed(4))).size>7);
});
test('uncertain meter uses the same free groove and silence suppresses beat choreography',()=>{
  const unknown=Dance.sample({...rhythm,meter:0,meterConfidence:0},lively,2,1);
  const uncertain=Dance.sample({...rhythm,meter:4,meterConfidence:0},lively,2,1);
  assert.deepEqual(uncertain,unknown);
  const silent=Dance.sample({...rhythm,confidence:0},lively,2,1);
  for(const key of ['x','y','swirl','accent','turn','hue']) assert.ok(silent[key]===0);
});
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
test('all choreography values stay finite and bounded across tempo, meter, mood and confidence',()=>{
  for(const bpm of [55,90,120,200]) for(const meter of [0,3,4]) for(const mood of [calm,lively]) {
    for(let i=0;i<100;i++) {
      const r={...rhythm,meter,beatInBar:meter?i%meter+1:0,beatCount:i,phase:(i*.17)%1,period:60/bpm};
      const s=Dance.sample(r,mood,i%10,i*60/bpm);
      assert.ok(Object.values(s).every(Number.isFinite));
      assert.ok(Math.abs(s.x)<=1 && Math.abs(s.y)<=1 && s.spread>.8 && s.spread<1.3);
    }
  }
});

test('centre traverses triangle edges every two beats and diamond edges after stable four meter',()=>{
  const run=(meter,bpm,seconds)=>{
    const path=new Dance.CentrePath(),samples=[];
    for(let i=0;i<seconds*120;i++) {
      const cycle=i/120*bpm/60;
      const point=path.update({tracking:true,confidence:1,bpm,period:60/bpm,beatCount:Math.floor(cycle),phase:cycle%1,meter,meterConfidence:1},1/120);
      samples.push(point);
    }
    return {path,samples};
  };
  const triangle=run(0,120,24);
  assert.equal(triangle.path.interval,2);assert.ok(Math.abs(triangle.path.step-24)<.02);
  // Settled vertices are separated by 20% of viewport width.
  const a=triangle.samples[120*20],b=triangle.samples[120*21];
  assert.ok(Math.abs(Math.hypot(a.x-b.x,a.y-b.y)-.2)<.002);
  const diamond=run(4,120,24);
  assert.equal(diamond.path.interval,2);assert.ok(diamond.path.morph>.999);
  const c=diamond.samples[120*20],d=diamond.samples[120*21];
  assert.ok(Math.abs(Math.hypot(c.x-d.x,c.y-d.y)-.2)<.002);
  assert.equal(run(0,180,15).path.interval,4);
  assert.equal(run(3,75,15).path.interval,1);
  assert.equal(run(3,120,15).path.interval,3);
});
test('centre remains continuous through meter changes, clock corrections and silence',()=>{
  const path=new Dance.CentrePath();let last={x:0,y:0};
  for(let i=0;i<3600;i++) {
    const cycle=i/60*2+(i>1800?8:0);
    const point=path.update({tracking:i<3000,confidence:1,bpm:120,period:.5,beatCount:Math.floor(cycle),phase:cycle%1,meter:i<600?0:i<1800?4:3,meterConfidence:1},1/60);
    assert.ok(Math.hypot(point.x-last.x,point.y-last.y)<.012,'no teleport when pattern changes');
    assert.ok(Math.abs(point.x)<.15 && Math.abs(point.y)<.15);last=point;
  }
  assert.ok(Math.hypot(last.x,last.y)<.0001);
});
