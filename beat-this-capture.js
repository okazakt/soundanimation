/* Capture only. Microphone PCM is sent to a local AI worker. */
'use strict';
class BeatThisCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(2048); this.position = 0; this.firstFrame = 0; this.discontinuity = false;
    this.resetAttacks();
  }
  resetAttacks() {
    this.attacks = []; this.power = 0; this.samples = 0;
    this.previousLevel = 0; this.averageLevel = 0; this.lastAttack = -Infinity;
  }
  detectAttack(sample, time) {
    // Fixed 10ms windows on the audio thread: unaffected by rendering stalls,
    // FFT smoothing, inference time or message delivery time.
    if (!this.samples) this.windowTime = time;
    this.power += sample * sample; this.samples++;
    if (this.samples < Math.round(sampleRate * .01)) return;
    const level = Math.sqrt(this.power / this.samples);
    if (level > .00001 && level > this.previousLevel * 1.6 &&
        level > this.averageLevel * 2.2 && this.windowTime - this.lastAttack > .19) {
      this.attacks.push(this.windowTime); this.lastAttack = this.windowTime;
    }
    this.averageLevel += (level - this.averageLevel) * (1 - Math.exp(-this.samples / sampleRate / .65));
    this.previousLevel = level; this.power = 0; this.samples = 0;
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!channels || !channels.length || !channels[0].length) {
      // Never combine a partial block from before a missing input with audio
      // after it: its first timestamp would describe unrelated samples.
      this.position = 0; this.discontinuity = true; this.resetAttacks(); return true;
    }
    for (let i = 0; i < channels[0].length; i++) {
      if (!this.position) { this.firstFrame = currentFrame + i; this.firstTime = currentTime + i / sampleRate; }
      let sample = 0; for (const channel of channels) sample += channel[i];
      this.detectAttack(sample / channels.length, currentTime + i / sampleRate);
      this.buffer[this.position++] = sample / channels.length;
      if (this.position === this.buffer.length) {
        this.port.postMessage({ pcm: this.buffer, firstFrame: this.firstFrame, audioTime: this.firstTime,
          sampleRate, discontinuity: this.discontinuity, attacks: this.attacks }, [this.buffer.buffer]);
        this.attacks = [];
        this.discontinuity = false;
        this.buffer = new Float32Array(2048); this.position = 0;
      }
    }
    return true;
  }
}
registerProcessor('beat-this-capture', BeatThisCapture);
