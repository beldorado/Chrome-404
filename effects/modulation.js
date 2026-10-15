import { lfo, ramp, stereoInput } from './lib.js';

export function stereoModDelay(ctx, { baseDelay, maxDelay = 0.05 }) {
  const input = stereoInput(ctx);
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const left = ctx.createDelay(maxDelay);
  const right = ctx.createDelay(maxDelay);
  left.delayTime.value = baseDelay;
  right.delayTime.value = baseDelay;
  input.connect(splitter);
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);

  const osc = lfo(ctx, 'sine', 0.5);
  const depthL = ctx.createGain();
  const depthR = ctx.createGain();
  osc.connect(depthL).connect(left.delayTime);
  osc.connect(depthR).connect(right.delayTime);

  return {
    input,
    output: merger,
    nodes: [splitter, merger, left, right, osc, depthL, depthR],
    setRate: (hz, immediate) => ramp(ctx, osc.frequency, hz, immediate),
    setDepth(seconds, immediate) {
      ramp(ctx, depthL.gain, seconds, immediate);
      ramp(ctx, depthR.gain, -seconds, immediate);
    },
    setBase(seconds, immediate) {
      ramp(ctx, left.delayTime, seconds, immediate);
      ramp(ctx, right.delayTime, seconds, immediate);
    }
  };
}
