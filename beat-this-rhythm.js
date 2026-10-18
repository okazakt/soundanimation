'use strict';
// App postprocessing of Beat This probabilities; scores are heuristic confidence.
(function(root) {
  const median = a => a.length ? [...a].sort((x,y) => x-y)[Math.floor(a.length/2)] : 0;
  class Tracker {
    constructor() { this.reset(); }
    reset() { this.frames = new Map(); this.lock = null; this.pending = null; this.votes = 0; this.lastEnd = -Infinity; }
    summarize(result, start, duration, quiet = false) {
      const end = start + duration;
      if (quiet) this.reset();
      const bp = result.beatConfidence, dp = result.downbeatConfidence;
      // Both edges need context. Overlapping trusted frames overwrite previous estimates.
      if (!quiet) for (let i = 25; i < Math.min(bp.length, dp.length) && i / 50 <= duration - .5; i++) {
        this.frames.set(Math.round(start * 50) + i, [Math.max(bp[i], dp[i]), dp[i]]);
      }
      for (const k of this.frames.keys()) if (k / 50 < end - 16) this.frames.delete(k);
      const frames = [...this.frames].sort((a,b) => a[0]-b[0]);
      // Model probabilities on distant microphone music are weaker than clean
      // recordings. Use their own background level, not a fixed 50% cutoff.
      const values=frames.map(([,v])=>v[0]), baseline=median(values);
      const maximum=Math.max(0,...values);
      const threshold=Math.max(.1,baseline+(maximum-baseline)*.1);
      const modelStrength=Math.max(0,Math.min(1,(maximum-baseline-.1)/.2));
      const peaks = frames.filter(([k, [score]], i) => score >= threshold &&
        frames.slice(Math.max(0,i-3), i+4).every(([j,[other]]) => other < score || (other === score && j >= k)));
      // Greedy strongest-first NMS: at most 200 BPM (300 ms between beats).
      const selected = [];
      for (const peak of peaks.sort((a,b) => b[1][0]-a[1][0])) {
        if (selected.every(p => Math.abs(p[0]-peak[0]) >= 15)) selected.push(peak);
      }
      const beats = selected.sort((a,b) => a[0]-b[0]).slice(-16);
      const intervals = beats.slice(1).map((b,i) => (b[0]-beats[i][0])/50);
      const period = median(intervals), bpm = period ? 60/period : 0;
      const confidence = intervals.length ? modelStrength * intervals.filter(t => Math.abs(t-period) < period*.16).length / intervals.length * Math.min(1,intervals.length/8) : 0;
      const hypotheses = [];
      if (beats.length >= 8) for (const meter of [3,4]) for (let phase=0; phase<meter; phase++) {
        const on = beats.filter((_,i) => i%meter === phase).map(b => b[1][1]);
        const off = beats.filter((_,i) => i%meter !== phase).map(b => b[1][1]);
        if (on.length < 2) continue;
        const mean = a => a.reduce((s,x)=>s+x,0)/a.length;
        hypotheses.push({meter, phase, score:mean(on), contrast:mean(on)-mean(off), anchor:beats[phase][0]/50});
      }
      hypotheses.sort((a,b) => (b.score+b.contrast)-(a.score+a.contrast));
      const best = hypotheses[0];
      const eligible = best && best.score >= .5 && best.contrast >= .15 && confidence >= .55;
      if (eligible && end > this.lastEnd + .1) {
        const samePhase = this.lock && this.lock.meter === best.meter &&
          Math.abs((best.anchor-this.lock.anchor)/period - Math.round((best.anchor-this.lock.anchor)/period/best.meter)*best.meter) < .3;
        if (samePhase) { this.lock = {...best, confidence:Math.min(1,best.score)}; this.votes=0; this.pending=null; }
        else {
          // Candidate identity uses an absolute bar phase, stable as the window slides.
          const sameCandidate = this.pending && this.pending.meter === best.meter &&
            Math.abs((best.anchor-this.pending.anchor)/period - Math.round((best.anchor-this.pending.anchor)/period/best.meter)*best.meter) < .3;
          this.votes = sameCandidate ? this.votes+1 : 1; this.pending=best;
          if (this.votes >= 3) { this.lock={...best,confidence:best.score}; this.votes=0; }
        }
      } else if (!eligible) { this.votes=0; this.pending=null; }
      this.lastEnd=end;
      if (this.lock && (!beats.length || end-this.lock.anchor > 20)) this.lock=null;
      const last = beats.at(-1), lastTime = last ? last[0]/50 : -100;
      const meter = this.lock?.meter || 0;
      const index = meter && period ? Math.round((lastTime-this.lock.anchor)/period) : 0;
      return { time:duration, bpm, confidence:bpm>=55 && bpm<=200 ? confidence : 0,
        beatCount:beats.length, meter, meterConfidence:this.lock?.confidence || 0,
        meterMass:[0, ...[3,4].map(m => Math.max(0,...hypotheses.filter(h=>h.meter===m).map(h=>h.score)))],
        beatInBar:meter ? ((index%meter)+meter)%meter+1 : 0,
        audioTime:end, lastBeatAudioTime:lastTime, quiet:quiet ? duration : 0,
        beatProbability:Math.max(0,...bp.slice(25,Math.max(25,bp.length-25))),
        downProbability:Math.max(0,...dp.slice(25,Math.max(25,dp.length-25))), peakThreshold:threshold,
        windowSeconds:duration, processedFrames:bp.length };
    }
  }
  const summarize = (result,start,duration) => new Tracker().summarize(result,start,duration);
  const api={Tracker,summarize};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.BeatThisRhythm=api;
})(typeof self === 'undefined' ? globalThis : self);
