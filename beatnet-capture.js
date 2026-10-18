/* Capture only. Microphone PCM is sent to a local AI worker. */
'use strict';
class BeatNetCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.position = 0; this.firstFrame = 0; this.discontinuity = false; }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!channels || !channels.length || !channels[0].length) {
      // Never combine a partial block from before a missing input with audio
      // after it: its first timestamp would describe unrelated samples.
      this.position = 0; this.discontinuity = true; return true;
    }
    for (let i = 0; i < channels[0].length; i++) {
      if (!this.position) { this.firstFrame = currentFrame + i; this.firstTime = currentTime + i / sampleRate; }
      let sample = 0; for (const channel of channels) sample += channel[i];
      this.buffer[this.position++] = sample / channels.length;
      if (this.position === this.buffer.length) {
        this.port.postMessage({ pcm: this.buffer, firstFrame: this.firstFrame, audioTime: this.firstTime,
          sampleRate, discontinuity: this.discontinuity }, [this.buffer.buffer]);
        this.discontinuity = false;
        this.buffer = new Float32Array(2048); this.position = 0;
      }
    }
    return true;
  }
}
registerProcessor('beatnet-capture', BeatNetCapture);
