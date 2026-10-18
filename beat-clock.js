'use strict';
// Beat This seeds the clock. Acoustic attacks can correct/extend it, never seed it.
(function(root) {
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const mod=(x,n)=>(x%n+n)%n;
  class BeatClock {
    constructor() { this.reset(); }
    reset() {
      this.seeded=false; this.suspended=false; this.waitingResume=false; this.requireAfter=-Infinity;
      this.lastObservation=-Infinity; this.lastModelSupport=-Infinity;
      this.lastAttack=-Infinity; this.attackCount=0; this.tempoCandidate=null; this.meterCandidate=null;
      this.dropAt=-Infinity;this.dropAttacks=0;this.lastDropAttack=-Infinity;
      this.meter=0; this.meterConfidence=0; this.downIndex=0; this.confidence=0;
    }
    observeModel(s,now) {
      if(!s || !Number.isFinite(now) || !Number.isFinite(s.audioTime) || s.audioTime<=this.lastObservation) return false;
      this.lastObservation=s.audioTime;
      if(s.quiet || !(s.confidence>=.55) || !(s.bpm>=55 && s.bpm<=200) || !(s.beatCount>=6) ||
        !Number.isFinite(s.lastBeatAudioTime) || s.lastBeatAudioTime<this.requireAfter ||
        s.lastBeatAudioTime>now+.1 || now-s.lastBeatAudioTime>12 || now-s.audioTime>10) return false;
      // The capture clock already includes inference, queueing and delivery delay.
      // Do not subtract processingMs a second time.
      const nextPeriod=60/s.bpm;
      if(!this.seeded || this.suspended || now-this.lastModelSupport>24) {
        this.seeded=true; this.suspended=false; this.period=nextPeriod;
        this.anchor=s.lastBeatAudioTime; this.baseCount=s.beatCount;
        this.meter=0; this.meterCandidate=null; this.tempoCandidate=null;
        this.lastAttack=-Infinity;this.attackCount=0;
      } else {
        const difference=Math.abs(nextPeriod/this.period-1);
        let adopted=this.period;
        if(difference<.08) {
          adopted=this.period*.85+nextPeriod*.15; this.tempoCandidate=null;
        } else {
          const c=this.tempoCandidate;
          if(c && Math.abs(nextPeriod/c.period-1)<.05) {c.count++;c.period=c.period*.5+nextPeriod*.5;}
          else this.tempoCandidate={period:nextPeriod,count:1,since:s.audioTime};
          const candidate=this.tempoCandidate;
          if(candidate.count>=3 && s.audioTime-candidate.since>=4) {
            adopted=candidate.period; this.tempoCandidate=null; this.attackCount=0;
          }
        }
        // Preserve the current beat number and fractional phase as speed changes.
        const position=(now-this.anchor)/this.period;
        this.anchor=now-position*adopted; this.period=adopted;
        const nearest=Math.round((s.lastBeatAudioTime-this.anchor)/this.period);
        const error=s.lastBeatAudioTime-(this.anchor+nearest*this.period);
        this.anchor+=clamp(error*.2,-this.period*.04,this.period*.04);
      }
      // Old beats repeated by overlapping windows must not renew support forever.
      this.lastModelSupport=Math.max(this.lastModelSupport,s.lastBeatAudioTime);
      this.confidence=s.confidence;
      if(s.lastBeatAudioTime>this.dropAt) {this.dropAt=-Infinity;this.dropAttacks=0;}
      if((s.meter===3 || s.meter===4) && s.meterConfidence>.6 && s.beatInBar>0) {
        const beatIndex=Math.round((s.lastBeatAudioTime-this.anchor)/this.period);
        const downIndex=mod(beatIndex-(s.beatInBar-1),s.meter);
        if(!this.meter) {this.meter=s.meter;this.downIndex=downIndex;this.meterConfidence=s.meterConfidence;}
        else if(this.meter===s.meter && this.downIndex===downIndex) {
          this.meterConfidence=this.meterConfidence*.8+s.meterConfidence*.2;this.meterCandidate=null;
        } else {
          const c=this.meterCandidate;
          if(c && c.meter===s.meter && c.downIndex===downIndex) c.count++;
          else this.meterCandidate={meter:s.meter,downIndex,count:1,since:s.audioTime};
          const candidate=this.meterCandidate;
          if(candidate.count>=3 && s.audioTime-candidate.since>=4) {
            this.meter=s.meter;this.downIndex=downIndex;this.meterConfidence=s.meterConfidence;this.meterCandidate=null;
          }
        }
      }
      return true;
    }
    noticeDrop(time) {
      if(this.seeded && Number.isFinite(time)) {this.dropAt=time;this.dropAttacks=0;this.lastDropAttack=-Infinity;}
    }
    attack(time) {
      if(!this.seeded || this.suspended || !Number.isFinite(time) || time-this.lastModelSupport>24 || time-this.lastAttack<this.period*.5) return false;
      const index=Math.round((time-this.anchor)/this.period);
      const error=time-(this.anchor+index*this.period);
      if(Math.abs(error)>this.period*.18) return false; // Reject offbeats and unrelated noise.
      if(Number.isFinite(this.lastAttack) && index>this.lastAttackIndex) {
        const observed=(time-this.lastAttack)/(index-this.lastAttackIndex);
        if(Math.abs(observed/this.period-1)<.06) {
          const position=(time-this.anchor)/this.period;
          const next=this.period+clamp((observed-this.period)*.1,-this.period*.005,this.period*.005);
          this.anchor=time-position*next;this.period=next;
        }
      }
      if(time-this.lastAttack>this.period*3) this.attackCount=0;
      this.anchor+=clamp(error*.1,-this.period*.02,this.period*.02);
      this.lastAttack=time; this.lastAttackIndex=index; this.attackCount++;
      if(time>this.dropAt && Number.isFinite(this.dropAt)) {
        this.dropAttacks=time-this.lastDropAttack<this.period*1.5 ? this.dropAttacks+1 : 1;
        this.lastDropAttack=time;
      }
      return true;
    }
    project(now,quietFor=0) {
      if(!this.seeded || !Number.isFinite(now)) return null;
      if(Number.isFinite(this.dropAt) && now-this.dropAt>Math.max(1,this.period*3.5) && this.dropAttacks<3) {
        this.requireAfter=Math.max(this.requireAfter,this.dropAt);this.suspended=true;this.waitingResume=false;return null;
      }
      if(quietFor>=Math.max(.8,this.period*1.5)) {
        if(!this.suspended) this.requireAfter=now-quietFor;
        this.suspended=true;this.waitingResume=true;this.attackCount=0;return null;
      }
      if(this.suspended) {
        if(this.waitingResume && quietFor<.05) {this.requireAfter=Math.max(this.requireAfter,now-.1);this.waitingResume=false;}
        return null;
      }
      const modelAge=now-this.lastModelSupport,attackAge=now-this.lastAttack;
      const attackSupported=this.attackCount>=3 && attackAge<=Math.max(1,this.period*2.5);
      if(modelAge>24 || (modelAge>12 && !attackSupported)) return null;
      const position=(now-this.anchor)/this.period,whole=Math.floor(position),phase=position-whole;
      return {bpm:60/this.period,period:this.period,phase,
        lastBeatAudioTime:this.anchor+whole*this.period,beatCount:this.baseCount+whole,
        meter:this.meter,meterConfidence:this.meterConfidence,
        beatInBar:this.meter?mod(whole-this.downIndex,this.meter)+1:0,
        confidence:this.confidence*Math.exp(-Math.max(0,modelAge-4)/30),
        modelAge,attackAge,assisted:attackSupported && modelAge>4};
    }
  }
  if(typeof module!=='undefined' && module.exports) module.exports={BeatClock};
  else root.BeatClock=BeatClock;
})(typeof self==='undefined'?globalThis:self);
