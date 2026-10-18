// Streaming microphone resampler, adapted from the former BeatNet browser integration.
// Mojtaba Heydari et al., CC BY 4.0. See vendor/audio-resampler/NOTICE.md.
'use strict';
(function(root) {
  const SR = 22050;
  class Resampler {
    constructor(rate) {
      if (!Number.isFinite(rate) || rate < 8000 || rate > 192000) throw new Error('未対応の入力サンプルレートです');
      this.rate = rate; this.ratio = rate / SR; this.buffer = new Float32Array(16); this.position = 16; this.totalOutput = 0; this.totalDropped = 0;
      this.kernels = Array.from({ length: 1024 }, (_, phase) => {
        const out = new Float64Array(32), fraction = phase / 1024, cutoff = Math.min(1, SR / rate) * .94; let total = 0;
        for (let k = 0; k < 32; k++) {
          const x = k - 15 - fraction, y = Math.PI * x * cutoff;
          out[k] = (Math.abs(y) < 1e-9 ? 1 : Math.sin(y) / y) * cutoff * (.5 + .5 * Math.cos(Math.PI * x / 17)); total += out[k];
        }
        for (let k = 0; k < 32; k++) out[k] /= total; return out;
      });
    }
    process(pcm) {
      if (this.rate === SR) return pcm;
      const next = new Float32Array(this.buffer.length + pcm.length); next.set(this.buffer); next.set(pcm, this.buffer.length); this.buffer = next;
      const out = new Float32Array(Math.ceil(pcm.length / this.ratio) + 32); let count = 0;
      while (this.position + 16 < next.length) {
        const index = Math.floor(this.position), phase = Math.min(1023, Math.round((this.position - index) * 1024)), kernel = this.kernels[phase]; let value = 0;
        for (let k = 0; k < 32; k++) value += next[index - 15 + k] * kernel[k];
        out[count++] = value; this.totalOutput++; this.position = 16 + this.totalOutput * this.ratio - this.totalDropped;
      }
      const drop = Math.max(0, Math.floor(this.position) - 16); this.buffer = next.slice(drop); this.totalDropped += drop; this.position = 16 + this.totalOutput * this.ratio - this.totalDropped; return out.subarray(0, count);
    }
  }
  function measure(pcm) {
    let mean = 0;
    for (const x of pcm) mean += x;
    mean /= Math.max(1, pcm.length);
    let power = 0, peak = 0;
    for (const x of pcm) { const v=x-mean; power+=v*v; peak=Math.max(peak,Math.abs(v)); }
    return { mean, rms:Math.sqrt(power/Math.max(1,pcm.length)), peak };
  }
  // The threshold lives in the adjusted domain, never in raw microphone units.
  const TARGET_RMS=.1, ADJUSTED_SILENCE=.002;
  function normalize(pcm) {
    const {mean,rms,peak}=measure(pcm);
    const gain=peak>0 ? Math.min(TARGET_RMS/rms,.95/peak) : 0;
    const adjustedRms=rms*gain;
    const quiet=adjustedRms<ADJUSTED_SILENCE;
    for(let i=0;i<pcm.length;i++) pcm[i]=quiet ? 0 : (pcm[i]-mean)*gain;
    return {quiet,rms,gain:quiet?0:gain,adjustedRms};
  }
  // Fast attenuation, gradual gain increase, and reacquisition of a quieter scene.
  // Used by the visual analyser as well as input status; inference retains one
  // constant gain over its whole context so it cannot flatten musical accents.
  class AutoLevel {
    constructor() { this.reset(); }
    reset() { this.reference=0; this.lowFor=0; }
    observe(pcm,rate) {
      const {rms,peak}=measure(pcm),dt=pcm.length/rate;
      if(rms>0) {
        if(!this.reference || rms>this.reference) this.reference=rms;
        else {
          this.lowFor=rms<this.reference*.1 ? this.lowFor+dt : 0;
          this.reference=this.lowFor>.3 ? rms : rms+(this.reference-rms)*Math.exp(-dt/1.2);
          if(this.lowFor>.3) this.lowFor=0;
        }
      }
      const gain=peak>0 ? Math.min(TARGET_RMS/this.reference,.95/peak) : 0;
      const adjustedRms=rms*gain;
      return {rms,gain,adjustedRms,quiet:adjustedRms<ADJUSTED_SILENCE};
    }
  }
  const api = { Resampler, normalize, AutoLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BeatThisAudio = api;
})(typeof self === 'undefined' ? globalThis : self);
