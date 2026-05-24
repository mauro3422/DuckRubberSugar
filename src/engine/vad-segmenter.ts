export interface VadSegment {
  start: number;
  end: number;
}

export interface VadResult {
  segments: VadSegment[];
  silenceThreshold: number;
  frameCount: number;
}

export class VadSegmenter {
  static readonly FRAME_DURATION_SECONDS = 0.05;
  static readonly SILENCE_THRESHOLD_MIN = 0.003;
  static readonly SILENCE_ENERGY_RATIO = 0.12;
  static readonly MIN_CHUNK_SECONDS = 1.5;
  static readonly MAX_CHUNK_SECONDS = 4.5;
  static readonly SILENCE_CONTINUITY_SECONDS = 0.35;

  static segment(buffer: AudioBuffer, targetCount: number): VadResult {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const totalSamples = buffer.length;
    const frameSize = Math.floor(sampleRate * this.FRAME_DURATION_SECONDS);
    const frameCount = Math.floor(totalSamples / frameSize);

    if (frameCount < 10) {
      return {
        segments: this.uniformChunks(totalSamples, targetCount),
        silenceThreshold: this.SILENCE_THRESHOLD_MIN,
        frameCount,
      };
    }

    const energies = this.computeFrameEnergies(data, frameSize, frameCount);
    const silenceThreshold = this.computeSilenceThreshold(energies);

    const segments = this.detectSegments(
      totalSamples, sampleRate, frameSize, frameCount,
      energies, silenceThreshold, targetCount
    );

    if (segments.length < 2) {
      return {
        segments: this.uniformChunks(totalSamples, targetCount),
        silenceThreshold,
        frameCount,
      };
    }

    return { segments, silenceThreshold, frameCount };
  }

  private static computeFrameEnergies(data: Float32Array, frameSize: number, frameCount: number): number[] {
    const energies: number[] = new Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      const startIdx = i * frameSize;
      for (let j = 0; j < frameSize; j++) {
        sum += Math.abs(data[startIdx + j]);
      }
      energies[i] = sum / frameSize;
    }
    return energies;
  }

  private static computeSilenceThreshold(energies: number[]): number {
    const totalEnergy = energies.reduce((a, b) => a + b, 0);
    const averageEnergy = totalEnergy / energies.length;
    return Math.max(this.SILENCE_THRESHOLD_MIN, averageEnergy * this.SILENCE_ENERGY_RATIO);
  }

  private static detectSegments(
    totalSamples: number, sampleRate: number, frameSize: number, frameCount: number,
    energies: number[], silenceThreshold: number, targetCount: number
  ): VadSegment[] {
    const cuts: number[] = [0];
    const minDistanceSamples = Math.floor(sampleRate * this.MIN_CHUNK_SECONDS);
    const maxDistanceSamples = Math.floor(sampleRate * this.MAX_CHUNK_SECONDS);
    const silenceFramesRequired = Math.ceil(this.SILENCE_CONTINUITY_SECONDS / this.FRAME_DURATION_SECONDS);

    let lastCutSample = 0;
    let silenceFrameCount = 0;
    let lowestEnergyFrameInWindow = 0;
    let lowestEnergyInWindow = Infinity;

    for (let i = 0; i < frameCount; i++) {
      const currentSample = i * frameSize;
      const energy = energies[i];
      const distance = currentSample - lastCutSample;

      if (distance >= minDistanceSamples && energy < lowestEnergyInWindow) {
        lowestEnergyInWindow = energy;
        lowestEnergyFrameInWindow = currentSample;
      }

      if (energy < silenceThreshold) {
        silenceFrameCount++;
      } else {
        silenceFrameCount = 0;
      }

      if (silenceFrameCount >= silenceFramesRequired && distance >= minDistanceSamples) {
        const silenceStart = currentSample - (silenceFrameCount * frameSize);
        cuts.push(Math.floor(silenceStart + (currentSample - silenceStart) / 2));
        lastCutSample = cuts[cuts.length - 1];
        i = Math.floor(lastCutSample / frameSize);
        silenceFrameCount = 0;
        lowestEnergyInWindow = Infinity;
        lowestEnergyFrameInWindow = 0;
      } else if (distance >= maxDistanceSamples) {
        const cut = lowestEnergyFrameInWindow > 0 ? lowestEnergyFrameInWindow : currentSample;
        cuts.push(cut);
        lastCutSample = cut;
        i = Math.floor(cut / frameSize);
        silenceFrameCount = 0;
        lowestEnergyInWindow = Infinity;
        lowestEnergyFrameInWindow = 0;
      }
    }

    if (totalSamples - lastCutSample > sampleRate * 0.5) {
      cuts.push(totalSamples);
    } else {
      cuts[cuts.length - 1] = totalSamples;
    }

    if (cuts.length < 3) {
      return this.uniformChunks(totalSamples, targetCount);
    }

    const segments: VadSegment[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      segments.push({ start: cuts[i], end: cuts[i + 1] });
    }
    return segments;
  }

  private static uniformChunks(totalSamples: number, targetCount: number): VadSegment[] {
    const segments: VadSegment[] = [];
    for (let i = 0; i < targetCount; i++) {
      segments.push({
        start: Math.floor((i / targetCount) * totalSamples),
        end: Math.floor(((i + 1) / targetCount) * totalSamples),
      });
    }
    return segments;
  }
}
