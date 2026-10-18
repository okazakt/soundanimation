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
  function normalize(pcm) {
    let power = 0, peak = 0;
    for (const x of pcm) { power += x*x; peak = Math.max(peak, Math.abs(x)); }
    const rms = Math.sqrt(power / Math.max(1, pcm.length));
    // Gate before gain: never amplify silence. Cap gain and preserve crest factor.
    const quiet = rms < .003;
    const gain = quiet ? 0 : Math.min(8, .1 / rms, .95 / Math.max(peak, 1e-9));
    for (let i = 0; i < pcm.length; i++) pcm[i] *= gain;
    return { quiet, rms, gain };
  }
  const api = { Resampler, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BeatThisAudio = api;
})(typeof self === 'undefined' ? globalThis : self);
