const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  let Processor, frame = 48000 * 10; const messages = [];
  const scope = { Float32Array, sampleRate: 48000, currentFrame: frame, currentTime: frame / 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } }, registerProcessor: (_, value) => Processor = value };
  vm.runInNewContext(fs.readFileSync(require.resolve('../beatnet-capture.js'), 'utf8'), scope);
  const processor = new Processor();
  return { messages, step(value, length = 128) { scope.currentFrame = frame; scope.currentTime = frame / 48000;
    processor.process(value === null ? [[]] : [[new Float32Array(length).fill(value)]], [[new Float32Array(length)]]); frame += length; } };
}
test('capture reports source sample rate and audio time across varying render quantum sizes', () => {
  const f = fixture(); for (let i = 0; i < 8; i++) f.step(.5, 256);
  assert.equal(f.messages.length, 1); const m = f.messages[0];
  assert.equal(m.audioTime, 10); assert.equal(m.firstFrame, 480000); assert.equal(m.sampleRate, 48000);
  assert.ok(m.pcm.every(x => x === .5)); assert.equal(m.discontinuity, false);
});
test('missing input discards a partial pre-gap block instead of mixing it into new audio', () => {
  const f = fixture(); for (let i = 0; i < 4; i++) f.step(.9);
  f.step(null, 48000); for (let i = 0; i < 16; i++) f.step(.2);
  assert.equal(f.messages.length, 1); const m = f.messages[0];
  assert.ok(m.pcm.every(x => Math.abs(x - .2) < 1e-6)); assert.equal(m.discontinuity, true);
  assert.ok(Math.abs(m.audioTime - (11 + 512 / 48000)) < 1e-8);
  for (let i = 0; i < 16; i++) f.step(.2);
  assert.equal(f.messages[1].discontinuity, false);
});
