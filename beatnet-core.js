/* BeatNet browser port — adapted from Mojtaba Heydari et al., CC BY 4.0.
 * Unchanged model weights; see vendor/beatnet/NOTICE.md and LICENSE.txt.
 * No audio leaves the device. Pure JavaScript DSP, CRNN and bounded PF cascade.
 */
'use strict';
(function (root) {
  const SR = 22050, FRAME = 1411, HOP = 441;
  const sigmoid = x => 1 / (1 + Math.exp(-x));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  class FFT {
    constructor(n) {
      this.n = n; this.reverse = new Uint32Array(n);
      const bits = Math.log2(n);
      for (let i = 0; i < n; i++) { let v = i, r = 0; for (let k = 0; k < bits; k++) { r = r * 2 + (v & 1); v >>>= 1; } this.reverse[i] = r; }
      this.cos = Float64Array.from({ length: n / 2 }, (_, i) => Math.cos(2 * Math.PI * i / n));
      this.sin = Float64Array.from({ length: n / 2 }, (_, i) => Math.sin(2 * Math.PI * i / n));
    }
    transform(re, im, inverse = false) {
      const n = this.n;
      for (let i = 0; i < n; i++) { const j = this.reverse[i]; if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
      for (let size = 2; size <= n; size *= 2) {
        const half = size / 2, step = n / size;
        for (let start = 0; start < n; start += size) for (let j = 0; j < half; j++) {
          const k = j * step, c = this.cos[k], s = this.sin[k] * (inverse ? 1 : -1);
          const a = start + j, b = a + half, tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
      if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
  }
  class Features {
    constructor(config) {
      if (config.frameSize !== FRAME || config.sampleRate !== SR || config.filters.length !== 136) throw new Error('BeatNet前処理の形式が一致しません');
      this.filters = config.filters; this.fft = new FFT(4096);
      this.cos = Float64Array.from({ length: FRAME }, (_, i) => Math.cos(Math.PI * i * i / FRAME));
      this.sin = Float64Array.from({ length: FRAME }, (_, i) => Math.sin(Math.PI * i * i / FRAME));
      this.window = Float64Array.from({ length: FRAME }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / (FRAME - 1)));
      this.kernelRe = new Float64Array(4096); this.kernelIm = new Float64Array(4096);
      for (let i = 0; i < FRAME; i++) {
        this.kernelRe[i] = this.cos[i]; this.kernelIm[i] = this.sin[i];
        if (i) { this.kernelRe[4096 - i] = this.cos[i]; this.kernelIm[4096 - i] = this.sin[i]; }
      }
      this.fft.transform(this.kernelRe, this.kernelIm);
      this.re = new Float64Array(4096); this.im = new Float64Array(4096);
      this.magnitude = new Float32Array(705); this.previous = new Float32Array(136); this.first = true;
    }
    process(pcm) {
      if (pcm.length !== FRAME) throw new Error('BeatNet音声フレーム長が不正です');
      const re = this.re, im = this.im; re.fill(0); im.fill(0);
      for (let i = 0; i < FRAME; i++) { const x = pcm[i] * this.window[i]; re[i] = x * this.cos[i]; im[i] = -x * this.sin[i]; }
      this.fft.transform(re, im);
      for (let i = 0; i < 4096; i++) {
        const r = re[i], v = im[i]; re[i] = r * this.kernelRe[i] - v * this.kernelIm[i]; im[i] = r * this.kernelIm[i] + v * this.kernelRe[i];
      }
      this.fft.transform(re, im, true);
      for (let i = 0; i < 705; i++) {
        const r = Math.fround(re[i] * this.cos[i] + im[i] * this.sin[i]);
        const v = Math.fround(im[i] * this.cos[i] - re[i] * this.sin[i]);
        this.magnitude[i] = Math.hypot(r, v);
      }
      const out = new Float32Array(272);
      for (let b = 0; b < 136; b++) {
        const f = this.filters[b]; let value = 0;
        for (let k = 0; k < f.values.length; k++) value += this.magnitude[f.start + k] * f.values[k];
        out[b] = Math.log10(Math.fround(value) + 1);
        out[b + 136] = this.first ? 0 : Math.max(0, out[b] - this.previous[b]); this.previous[b] = out[b];
      }
      this.first = false; return out;
    }
  }
  function dense(weights, bias, input, rows, cols, output) {
    for (let row = 0; row < rows; row++) {
      let a = 0, b = 0, c = 0, d = 0, j = 0; const base = row * cols;
      for (; j + 3 < cols; j += 4) {
        a += weights[base + j] * input[j]; b += weights[base + j + 1] * input[j + 1];
        c += weights[base + j + 2] * input[j + 2]; d += weights[base + j + 3] * input[j + 3];
      }
      let sum = a + b + c + d + bias[row]; for (; j < cols; j++) sum += weights[base + j] * input[j]; output[row] = sum;
    }
    return output;
  }
  class Network {
    constructor(manifest, buffer) {
      if (manifest.bytes !== buffer.byteLength || manifest.inputSize !== 272 || manifest.hiddenSize !== 150 || manifest.layers !== 2) throw new Error('BeatNetモデルの形式が一致しません');
      this.weights = {};
      for (const [name, item] of Object.entries(manifest.weights)) {
        if (item.offset < 0 || (item.offset + item.length) * 4 > buffer.byteLength) throw new Error('BeatNetモデルの重みが破損しています');
        this.weights[name] = new Float32Array(buffer, item.offset * 4, item.length);
      }
      this.pool = new Float32Array(262); this.projected = new Float32Array(150);
      this.layers = Array.from({ length: 2 }, (_, layer) => {
        const ih = this.weights[`lstm.weight_ih_l${layer}`], hh = this.weights[`lstm.weight_hh_l${layer}`];
        const bi = this.weights[`lstm.bias_ih_l${layer}`], bh = this.weights[`lstm.bias_hh_l${layer}`];
        const weight = new Float32Array(600 * 300), bias = new Float32Array(600);
        for (let row = 0; row < 600; row++) {
          weight.set(ih.subarray(row * 150, row * 150 + 150), row * 300);
          weight.set(hh.subarray(row * 150, row * 150 + 150), row * 300 + 150); bias[row] = bi[row] + bh[row];
        }
        return { weight, bias, h: new Float32Array(150), c: new Float32Array(150), input: new Float32Array(300), gates: new Float32Array(600) };
      });
      this.logits = new Float32Array(3);
    }
    process(features) {
      if (features.length !== 272) throw new Error('BeatNet特徴量の次元が不正です');
      const w = this.weights, cw = w['conv1.weight'], cb = w['conv1.bias'];
      for (let channel = 0; channel < 2; channel++) for (let i = 0; i < 131; i++) {
        let a = cb[channel], b = cb[channel];
        for (let j = 0; j < 10; j++) { const v = cw[channel * 10 + j]; a += v * features[i * 2 + j]; b += v * features[i * 2 + j + 1]; }
        this.pool[channel * 131 + i] = Math.max(0, a, b);
      }
      let input = dense(w['linear0.weight'], w['linear0.bias'], this.pool, 150, 262, this.projected);
      for (const layer of this.layers) {
        layer.input.set(input); layer.input.set(layer.h, 150);
        dense(layer.weight, layer.bias, layer.input, 600, 300, layer.gates);
        for (let i = 0; i < 150; i++) {
          layer.c[i] = sigmoid(layer.gates[i + 150]) * layer.c[i] + sigmoid(layer.gates[i]) * Math.tanh(layer.gates[i + 300]);
          layer.h[i] = sigmoid(layer.gates[i + 450]) * Math.tanh(layer.c[i]);
        }
        input = layer.h;
      }
      dense(w['linear.weight'], w['linear.bias'], input, 3, 150, this.logits);
      const max = Math.max(...this.logits), values = Float32Array.from(this.logits, v => Math.exp(v - max));
      const total = values[0] + values[1] + values[2]; for (let i = 0; i < 3; i++) values[i] /= total; return values;
    }
  }
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
  class StateSpace {
    constructor(minimum, maximum) {
      this.first = []; this.last = []; this.interval = []; this.position = []; this.group = [];
      for (let interval = minimum; interval <= maximum; interval++) {
        this.first.push(this.interval.length);
        for (let p = 0; p < interval; p++) { this.interval.push(interval); this.position.push(p); this.group.push(interval - minimum); }
        this.last.push(this.interval.length - 1);
      }
    }
  }
  class Tracker {
    constructor(seed = 1) {
      this.seed = seed; this.beat = new StateSpace(14, 55); this.bar = new StateSpace(2, 4);
      this.particles = Int32Array.from({ length: 1500 }, () => Math.floor(this.random() * this.beat.interval.length));
      this.down = Int32Array.from({ length: 250 }, () => Math.floor(this.random() * this.bar.interval.length));
      this.transitions = this.beat.first.map((_, row) => {
        const values = this.beat.first.map((_, col) => Math.exp(-60 * Math.abs((14 + col) / (14 + row) - 1)));
        const total = values.reduce((a, b) => a + b, 0); let sum = 0; return values.map(v => (sum += v / total));
      });
      this.frame = -1; this.lastTick = -1000; this.lastEvent = -1000; this.lastDownbeat = -1000;
      this.beatCount = 0; this.downbeatCount = 0; this.lastNumber = 0; this.lastType = 0;
      this.counts = new Int32Array(this.beat.interval.length); this.barCounts = new Int32Array(this.bar.interval.length);
    }
    random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
    resample(particles, space, observation, injected = []) {
      const candidates = new Int32Array(particles.length + injected.length); candidates.set(particles); candidates.set(injected, particles.length);
      const cumulative = new Float64Array(candidates.length); let total = 0;
      for (let i = 0; i < candidates.length; i++) { total += Math.max(1e-8, observation(candidates[i])); cumulative[i] = total; }
      const out = new Int32Array(particles.length); let index = 0;
      for (let j = 0; j < out.length; j++) {
        const target = (j + this.random()) * total / out.length;
        while (index < cumulative.length - 1 && cumulative[index] < target) index++;
        out[j] = candidates[index];
      }
      return out;
    }
    process(probabilities) {
      const [beatProbability, downProbability] = probabilities, rawActivation = Math.max(beatProbability, downProbability);
      const activation = rawActivation < .4 ? .03 : rawActivation;
      this.frame++; this.counts.fill(0); for (const p of this.particles) this.counts[p]++;
      let cumulative = 0, gathering = 0;
      for (; gathering < this.counts.length - 1; gathering++) { cumulative += this.counts[gathering]; if (cumulative >= this.particles.length / 2) break; }
      const interval = this.beat.interval[gathering]; let event = false, downbeat = false;
      if (this.beat.position[gathering] < 4 && this.frame - this.lastTick > .4 * interval) {
        this.lastTick = this.frame;
        for (let i = 0; i < this.down.length; i++) {
          const state = this.down[i], group = this.bar.group[state];
          if (state === this.bar.last[group]) {
            const r = this.random(); let nextGroup = group;
            if (r >= .9) nextGroup = (group + 1 + Math.floor((r - .9) / .05)) % 3;
            this.down[i] = this.bar.first[nextGroup];
          } else this.down[i]++;
        }
        if (rawActivation >= .4) {
          const injected = downProbability > .7 ? this.bar.first : [];
          this.down = this.resample(this.down, this.bar, p => this.bar.position[p] === 0 ? downProbability : beatProbability, injected);
          this.barCounts.fill(0); for (const p of this.down) this.barCounts[p]++;
          const best = this.barCounts.indexOf(Math.max(...this.barCounts));
          event = true; downbeat = this.bar.position[best] === 0 && this.lastType !== 1 && downProbability > .4;
          this.lastType = downbeat ? 1 : 2; this.lastNumber = this.bar.position[best] + 1;
          this.lastEvent = this.frame; this.beatCount++;
          if (downbeat) { this.lastDownbeat = this.frame; this.downbeatCount++; }
        }
      }
      for (let i = 0; i < this.particles.length; i++) {
        const state = this.particles[i], group = this.beat.group[state];
        if (state === this.beat.last[group]) {
          const r = this.random(), distribution = this.transitions[group]; let nextGroup = 0;
          while (nextGroup < distribution.length - 1 && distribution[nextGroup] < r) nextGroup++;
          this.particles[i] = this.beat.first[nextGroup];
        } else this.particles[i]++;
      }
      if (activation > .1) {
        const injected = activation > .8 ? this.beat.first.filter((_, i) => i % 6 === this.frame % 4) : [];
        this.particles = this.resample(this.particles, this.beat, p => this.beat.position[p] === 0 ? activation : .03, injected);
      }
      const tempoMass = new Float64Array(42), meterMass = [0, 0, 0];
      for (const p of this.particles) tempoMass[this.beat.group[p]]++;
      for (const p of this.down) meterMass[this.bar.group[p]]++;
      const mode = tempoMass.indexOf(Math.max(...tempoMass)); let weight = 0, meanInterval = 0, phaseSupport = 0;
      for (let g = Math.max(0, mode - 2); g <= Math.min(41, mode + 2); g++) { weight += tempoMass[g]; meanInterval += tempoMass[g] * (g + 14); }
      const centrePhase = this.beat.position[gathering] / interval;
      for (const p of this.particles) {
        const difference = Math.abs(this.beat.position[p] / this.beat.interval[p] - centrePhase);
        if (Math.min(difference, 1 - difference) < .16) phaseSupport++;
      }
      const confidence = Math.sqrt(weight / this.particles.length * phaseSupport / this.particles.length) * Math.min(1, this.beatCount / 8);
      const meterIndex = meterMass.indexOf(Math.max(...meterMass));
      return { time: this.frame / 50, event, downbeat, bpm: meanInterval ? 3000 * weight / meanInterval : 0,
        confidence, phase: centrePhase, beatProbability, downProbability,
        beatCount: this.beatCount, beatInBar: this.lastNumber,
        lastBeatTime: this.lastEvent / 50, meter: meterIndex + 2,
        meterConfidence: this.downbeatCount >= 3 ? meterMass[meterIndex] / this.down.length : 0,
        meterMass: meterMass.map(n => n / this.down.length), downbeatCount: this.downbeatCount };
    }
  }
  class Pipeline {
    constructor(manifest, weights, config, inputRate) {
      this.network = new Network(manifest, weights); this.features = new Features(config);
      this.resampler = new Resampler(inputRate); this.tracker = new Tracker();
      this.pcm = new Float32Array(0); this.samples = 0; this.origin = null; this.quiet = 0;
    }
    process(input, inputTime = 0) {
      if (this.origin === null) this.origin = inputTime;
      const converted = this.resampler.process(input), pcm = new Float32Array(this.pcm.length + converted.length);
      pcm.set(this.pcm); pcm.set(converted, this.pcm.length); let offset = 0;
      const states = [];
      while (offset + FRAME <= pcm.length) {
        const frame = pcm.subarray(offset, offset + FRAME);
        let power = 0; for (const v of frame) power += v * v;
        const rms = Math.sqrt(power / FRAME);
        this.quiet = rms < .0005 ? this.quiet + .02 : 0;
        const state = this.tracker.process(this.network.process(this.features.process(frame)));
        state.audioTime = this.origin + (this.samples + (FRAME - 1) / 2) / SR;
        state.lastBeatAudioTime = this.origin + (FRAME - 1) / 2 / SR + state.lastBeatTime;
        state.rms = rms; state.quiet = this.quiet;
        states.push(state); offset += HOP; this.samples += HOP;
      }
      this.pcm = pcm.slice(offset); return states;
    }
  }
  const api = { SR, FRAME, HOP, FFT, Features, Network, Resampler, Tracker, Pipeline };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BeatNetCore = api;
})(typeof self === 'undefined' ? globalThis : self);
