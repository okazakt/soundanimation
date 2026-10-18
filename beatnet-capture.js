/* Audio capture only. Microphone PCM is sent to the local BeatNet worker. */
'use strict';
class BeatNetCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.position = 0; this.firstFrame = 0; }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0]; if (!channels || !channels.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      if (!this.position) this.firstFrame = currentFrame + i;
      let sample = 0; for (const channel of channels) sample += channel[i];
      this.buffer[this.position++] = sample / channels.length;
      if (this.position === this.buffer.length) {
        this.port.postMessage({ pcm: this.buffer, firstFrame: this.firstFrame }, [this.buffer.buffer]);
        this.buffer = new Float32Array(2048); this.position = 0;
      }
    }
    return true;
  }
}
registerProcessor('beatnet-capture', BeatNetCapture);
