const {test}=require('node:test'),assert=require('node:assert/strict');
const {BeatClock}=require('../beat-clock.js');
const state=(time,extra={})=>({bpm:120,confidence:.9,audioTime:time,lastBeatAudioTime:time-.5,beatCount:20,meter:4,meterConfidence:.9,beatInBar:1,quiet:0,...extra});
test('audio-clock projection includes capture, crop, compute and delivery delay exactly once',()=>{
  const c=new BeatClock();c.observeModel(state(16,{lastBeatAudioTime:15.5,processingMs:3000}),19.75);
  const p=c.project(19.75);assert.equal(p.bpm,120);assert.equal(p.phase,.5);assert.equal(p.lastBeatAudioTime,19.5);assert.equal(p.beatInBar,1);
});
test('small tempo jitter is smoothed and a single large tempo or meter outlier cannot change the clock',()=>{
  const c=new BeatClock();c.observeModel(state(10),10);
  c.observeModel(state(12,{bpm:122}),12);assert.ok(Math.abs(c.project(12).bpm-120)<1);
  c.observeModel(state(14,{bpm:80,meter:3}),14);const p=c.project(14);
  assert.ok(p.bpm>119);assert.equal(p.meter,4);
});
test('a persistent new tempo and meter can replace the established clock',()=>{
  const c=new BeatClock();c.observeModel(state(10),10);
  for(const time of [12,14,16]) c.observeModel(state(time,{bpm:90,meter:3,beatInBar:1,lastBeatAudioTime:time}),time);
  assert.ok(Math.abs(c.project(16).bpm-90)<.01);
  // Meter adoption requires a stable absolute phase, not just a repeated label.
  for(const time of [18,20,22,24,26]) c.observeModel(state(time,{bpm:90,meter:3,beatInBar:1,lastBeatAudioTime:time}),time);
  assert.equal(c.project(26).meter,3);
});
test('aligned attacks bridge a weak model but cannot seed tempo, invent meter or extend forever',()=>{
  const c=new BeatClock();assert.equal(c.attack(0),false);assert.equal(c.project(0),null);
  c.observeModel(state(1,{lastBeatAudioTime:.5,meter:0,meterConfidence:0}),1);
  for(let t=1;t<=20;t+=.5) c.attack(t);
  const p=c.project(20);assert.ok(p.assisted);assert.equal(p.bpm,120);assert.equal(p.meter,0);
  assert.equal(c.project(26),null);
});
test('offbeats, isolated late attacks and weak predictions do not renew an expired clock',()=>{
  const c=new BeatClock();c.observeModel(state(1,{lastBeatAudioTime:.5}),1);
  for(let t=1.25;t<15;t+=.5) assert.equal(c.attack(t),false);
  c.observeModel(state(14,{confidence:.2}),14);
  assert.equal(c.project(14),null);
  c.attack(15);assert.equal(c.project(15),null);
});
test('silence suspends prediction; old inference cannot resume it, fresh music can restart at a slower tempo',()=>{
  const c=new BeatClock();c.observeModel(state(8,{lastBeatAudioTime:7.5}),8);
  assert.equal(c.project(10,1),null);
  assert.equal(c.observeModel(state(10,{lastBeatAudioTime:8}),10),false);
  assert.equal(c.project(10.2,0),null);
  assert.equal(c.observeModel(state(12,{bpm:70,lastBeatAudioTime:11.5}),12),true);
  assert.equal(c.project(12).bpm,70);
});
test('late out-of-order results do not rewind phase or overwrite tempo',()=>{
  const c=new BeatClock();c.observeModel(state(12),14);
  const before=c.project(14.2);
  assert.equal(c.observeModel(state(10,{bpm:80}),14.2),false);
  assert.deepEqual(c.project(14.2),before);
});
test('a relative level drop without matching attacks stops coasting even with a nonzero microphone noise floor',()=>{
  const c=new BeatClock();c.observeModel(state(8),8);c.noticeDrop(9);
  assert.equal(c.project(11),null);
  assert.equal(c.observeModel(state(12,{lastBeatAudioTime:8.5}),12),false);
  assert.equal(c.observeModel(state(14,{lastBeatAudioTime:13.5,bpm:80}),14),true);
  assert.equal(c.project(14).bpm,80);
});
test('a volume decrease with a continuing matching rhythm retains the established tempo',()=>{
  const c=new BeatClock();c.observeModel(state(8),8);c.noticeDrop(9);
  for(const time of [9.5,10,10.5,11]) c.attack(time);
  assert.equal(c.project(11).bpm,120);
});
test('missing meter or weak neural output preserves a previously established bar phase while the clock is supported',()=>{
  const c=new BeatClock();c.observeModel(state(8),8);
  c.observeModel(state(10,{meter:0,meterConfidence:0}),10);
  c.observeModel(state(12,{meter:3,meterConfidence:.9,confidence:.2}),12);
  const p=c.project(12);assert.equal(p.meter,4);assert.ok(p.meterConfidence>.6);
});
test('a fresh neural estimate after a fully expired clock reseeds instead of reviving the old tempo',()=>{
  const c=new BeatClock();c.observeModel(state(1),1);assert.equal(c.project(30),null);
  c.observeModel(state(32,{bpm:90}),32);assert.equal(c.project(32).bpm,90);
});
