declare const sampleRate: number;
declare const registerProcessor: (
  name: string,
  processor: typeof AudioWorkletProcessor
) => void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class BoloPcmProcessor extends AudioWorkletProcessor {
  pending: number[] = [];
  sourceChunkSize = Math.max(1, Math.round(sampleRate / 10));

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) {
      return true;
    }
    for (const sample of channel) {
      this.pending.push(sample);
    }
    while (this.pending.length >= this.sourceChunkSize) {
      const source = this.pending.splice(0, this.sourceChunkSize);
      const output = new Int16Array(1600);
      const ratio = source.length / output.length;
      for (let index = 0; index < output.length; index += 1) {
        const start = Math.floor(index * ratio);
        const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
        let total = 0;
        for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
          total += source[sourceIndex] || 0;
        }
        const value = Math.max(-1, Math.min(1, total / (end - start)));
        output[index] = value < 0 ? value * 0x80_00 : value * 0x7f_ff;
      }
      this.port.postMessage(output.buffer, [output.buffer]);
    }
    return true;
  }
}

registerProcessor("bolo-pcm-processor", BoloPcmProcessor);
