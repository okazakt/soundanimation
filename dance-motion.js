'use strict';
// Visual choreography only. Rhythm and mood arrive from the existing analysers.
(function(root) {
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function energy(mood) {
    const confidence=clamp(mood.confidence,0,1);
    const measured=clamp(mood.activity*.85+mood.tension*.15,0,1);
    return .5+(measured-.5)*(.3+.7*confidence);
  }
  function styles(mood,birth,exit,birthVariant,exitVariant) {
    const drive=energy(mood);
    // Every family remains possible. Freeze a choice for the whole episode.
    const centreProbability=.30+.45*drive;
    const gatherProbability=.78-.42*drive;
    return {entryStyle:(birth<centreProbability?0:2)+(birthVariant<.5?0:1),
      exitStyle:(exit<gatherProbability?0:1)+(exitVariant<.5?0:2),
      centreProbability,gatherProbability};
  }
  function sample(rhythm,mood,id,time) {
    const confidence=clamp(rhythm.confidence,0,1),drive=energy(mood);
    const phase=clamp(rhythm.phase,0,1),cycle=rhythm.beatCount+phase;
    const meter=(rhythm.meter===3 || rhythm.meter===4) && rhythm.beatInBar>0 ? rhythm.meter : 0;
    const position=meter ? rhythm.beatInBar-1+phase : 0;
    const bar=meter?position/meter:0;
    const known=meter?clamp((rhythm.meterConfidence-.45)/.35,0,1):0;
    const individuality=.76+.24*Math.sin(id*2.31+.8)**2;
    const direction=id%2?-1:1;
    const beatWave=Math.sin(phase*Math.PI*2);
    const fallbackX=Math.sin(cycle*Math.PI+id*.12)*.48;
    let side=fallbackX,rise=-beatWave*.4,swirl=0,accent=Math.exp(-phase*7)*.45;
    if(meter===3) {
      // A long circular sweep over three steps, with a weighted first step.
      side=Math.sin(bar*Math.PI*2)*.92;
      rise=-beatWave*(rhythm.beatInBar===1?.8:.44)-Math.sin(bar*Math.PI*2)*.18;
      swirl=Math.cos(bar*Math.PI*2)*.55;
      accent=Math.exp(-phase*7)*(rhythm.beatInBar===1?1:.4);
    } else if(meter===4) {
      // Alternating side steps, a bounce on 2/4, an opening on 1/3.
      side=Math.sin(position*Math.PI)*.72+Math.sin(bar*Math.PI*2)*.28;
      rise=-beatWave*(rhythm.beatInBar%2===0?.75:.45)-Math.sin(bar*Math.PI*2)*.22;
      swirl=Math.sin(bar*Math.PI*2)*.3;
      accent=Math.exp(-phase*7)*(rhythm.beatInBar===1?1:rhythm.beatInBar===3?.65:.4);
    }
    accent=Math.exp(-phase*7)*.45+(accent-Math.exp(-phase*7)*.45)*known;
    side=fallbackX+(side-fallbackX)*known;
    rise=-beatWave*.4+(rise+beatWave*.4)*known;
    const gain=confidence*(.4+.6*drive)*individuality;
    // Independent slow breaths keep ensembles from repeating a rigid loop.
    const breath=.88+.12*Math.sin(time*.19+id*1.71);
    return {energy:drive,x:side*gain*direction*breath,y:rise*gain,
      swirl:swirl*known*gain*direction,accent:accent*confidence,
      spread:1+(accent-.2)*gain*.20,
      turn:(Math.sin(cycle*Math.PI/2+id*.61)*.48+beatWave*.1)*confidence+swirl*known*gain*.24,
      hue:(Math.sin(cycle*Math.PI/4+id*.4)*28+Math.cos(phase*Math.PI*2)*18)*confidence+swirl*known*gain*10};
  }
  // Persistent pulse timing. Changing meter never resets its phase.
  class BreathingPulse {
    constructor() { this.step=0;this.last=null;this.interval=2;this.fast=false;this.meter=0;this.candidate=0;this.stable=0;this.recognition=0;this.gain=0; }
    update(r,dt) {
      const tracking=!!r.tracking && r.confidence>.2 && r.period>0;
      const candidate=r.meterConfidence>.65 && (r.meter===3 || r.meter===4)?r.meter:0;
      if(candidate!==this.candidate) {this.candidate=candidate;this.stable=0;}
      this.stable+=dt;
      if(this.stable>=2) this.meter=candidate;
      const cycle=r.beatCount+clamp(r.phase,0,1);
      const delta=tracking && this.last!==null ? clamp(cycle-this.last,0,dt/r.period*1.5) : 0;
      this.last=tracking?cycle:null;
      const previous=Math.floor(this.step);
      this.step+=delta/this.interval;
      if(Math.floor(this.step)!==previous || this.gain<.01) {
        const threshold=this.meter===3?90:150;
        if(r.bpm>threshold+8)this.fast=true;
        if(r.bpm<threshold-8)this.fast=false;
        this.interval=this.meter===3?(this.fast?3:1):(this.fast?4:2);
      }
      const recognised=tracking && this.meter===candidate && candidate!==0 && r.meterConfidence>=.8 && this.stable>=2;
      this.recognition+=(Number(recognised)-this.recognition)*(1-Math.exp(-dt/1.6));
      this.gain+=((tracking?1:0)-this.gain)*(1-Math.exp(-dt/(tracking?1.2:.65)));
      const phase=this.step%1;
      const smooth=t=>{t=clamp(t,0,1);return t*t*t*(10+t*(-15+6*t));};
      // Short attack, distinct return, then a quiet interval. Endpoint velocity
      // and acceleration are zero, so the sharper accent has no size jumps.
      const envelope=phase<.16?smooth(phase/.16):1-smooth((phase-.16)/.42);
      return {wave:(2*envelope-1)*this.gain,
        participation:2/3+(.9-2/3)*this.recognition,
        interval:this.interval,step:this.step,meter:this.meter,gain:this.gain};
    }
  }
  function breathingScale(pulse,rank,drive) {
    // Each particle keeps its own membership rank; new members fade in rather
    // than switching size when the recognition threshold crosses them.
    const t=clamp((pulse.participation-rank)/.035+.5,0,1);
    const weight=t*t*(3-2*t);
    return 1+pulse.wave*(pulse.wave>0 ? .95+.1*clamp(drive,0,1) : .35)*weight;
  }
  const api={energy,styles,sample,BreathingPulse,breathingScale};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.DanceMotion=api;
})(typeof self==='undefined'?globalThis:self);
