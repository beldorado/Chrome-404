const CHUNK_SECONDS = 1;

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.job = null;
    this.port.onmessage = ({ data }) => this.command(data);
  }

  command(data) {
    if (data.type === 'start') {
      // The message can arrive after its start time; slide the window so the clip keeps its full length.
      const requested = Math.round(data.start * sampleRate);
      const late = Math.max(0, currentFrame - requested);
      const startFrame = requested + late;
      this.job = {
        id: data.id,
        startFrame,
        endFrame: Math.max(startFrame + 1, Math.round(data.end * sampleRate) + late),
        chunkSize: Math.round(CHUNK_SECONDS * sampleRate),
        left: [],
        right: [],
        fill: 0,
        frames: 0
      };
    } else if (data.type === 'stop' && this.job?.id === data.id) {
      this.job.endFrame = Math.max(this.job.startFrame + 1, Math.min(this.job.endFrame, Math.round(data.end * sampleRate)));
    } else if (data.type === 'cancel' && this.job?.id === data.id) {
      this.job = null;
    }
  }

  push(l, r) {
    const job = this.job;
    if (job.fill === 0) {
      job.left.push(new Float32Array(job.chunkSize));
      job.right.push(new Float32Array(job.chunkSize));
    }
    job.left[job.left.length - 1][job.fill] = l;
    job.right[job.right.length - 1][job.fill] = r;
    job.frames++;
    job.fill = (job.fill + 1) % job.chunkSize;
  }

  finish() {
    const { id, left, right, frames } = this.job;
    this.job = null;
    this.port.postMessage({ type: 'done', id, left, right, frames, sampleRate }, [...left.map((c) => c.buffer), ...right.map((c) => c.buffer)]);
  }

  process(inputs) {
    if (!this.job) return true;
    const input = inputs[0];
    const n = input[0]?.length ?? 128;
    for (let i = 0; i < n; i++) {
      const frame = currentFrame + i;
      if (frame >= this.job.endFrame) {
        this.finish();
        break;
      }
      if (frame < this.job.startFrame) continue;
      const l = input[0]?.[i] ?? 0;
      this.push(l, input[1]?.[i] ?? l);
    }
    return true;
  }
}

registerProcessor('chrome404-recorder', RecorderProcessor);
