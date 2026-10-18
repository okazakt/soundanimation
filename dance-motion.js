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
    return 1+pulse.wave*(pulse.wave>0 ? 1.95+.1*clamp(drive,0,1) : .35)*weight;
  }
  const api={energy,styles,BreathingPulse,breathingScale};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.DanceMotion=api;
})(typeof self==='undefined'?globalThis:self);
