'use strict';
// App-specific tempo/meter summary. Beat This! predicts beat/downbeat times;
// it does not directly classify a time signature. Values here are not accuracy.
(function (root) {
  const median = values => { const a = [...values].sort((a, b) => a - b); return a.length ? a[Math.floor(a.length / 2)] : 0; };
  function summarize(result, start, duration) {
    // Discard the most recent 400 ms: boundary predictions have little future context.
    const beats = result.beats.filter(t => t >= .12 && t <= duration - .4);
    const intervals = beats.slice(1).map((t, i) => t - beats[i]).slice(-16);
    const period = median(intervals), bpm = period ? 60 / period : 0;
    const agreement = intervals.length ? intervals.filter(t => Math.abs(t - period) < period * .16).length / intervals.length : 0;
    const confidence = agreement * Math.min(1, intervals.length / 8);
    const down = [...new Set(result.downbeats.filter(t => t >= .12 && t <= duration - .4)
      .map(t => beats.findIndex(b => Math.abs(b - t) < .04)).filter(i => i >= 0))].sort((a, b) => a - b);
    const counts = [0, 0, 0];
    for (let i = 1; i < down.length; i++) { const n = down[i] - down[i - 1]; if (n >= 2 && n <= 4) counts[n - 2]++; }
    const total = Math.max(1, down.length - 1), best = Math.max(...counts), meter = best ? counts.indexOf(best) + 2 : 0;
    // At least two matching complete bars before displaying a meter.
    const meterConfidence = best / total * Math.min(1, best / 2);
    const last = beats.at(-1) ?? 0, frame = Math.min(result.beatConfidence.length - 1, Math.round(last * 50));
    return { time: duration, bpm, confidence: bpm >= 55 && bpm <= 215 ? confidence : 0, beatCount: beats.length,
      meter, meterConfidence, meterMass: counts.map(n => n / total),
      beatInBar: meter && down.length ? (beats.length - 1 - down.at(-1)) % meter + 1 : 0,
      audioTime: start + duration, lastBeatAudioTime: beats.length ? start + last : -100,
      quiet: 0, beatProbability: result.beatConfidence[frame] ?? 0, downProbability: result.downbeatConfidence[frame] ?? 0,
      windowSeconds: duration, processedFrames: Math.floor(duration * 50) + 1 };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { summarize };
  else root.BeatThisRhythm = { summarize };
})(typeof self === 'undefined' ? globalThis : self);
