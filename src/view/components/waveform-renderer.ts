export class WaveformRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  drawEmptyState(width: number, height: number): void {
    this.ctx.clearRect(0, 0, width, height);

    // Draw a subtle flat line representing waiting state
    this.ctx.beginPath();
    this.ctx.moveTo(16, height / 2);
    this.ctx.lineTo(width - 16, height / 2);
    this.ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Text label
    this.ctx.font = "11px system-ui, sans-serif";
    this.ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
    this.ctx.textAlign = "center";
    this.ctx.fillText("Esperando grabación o archivo de audio...", width / 2, height / 2 + 18);
  }

  drawLoadingState(width: number, height: number): void {
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.font = "11px system-ui, sans-serif";
    this.ctx.fillStyle = "var(--accent-color)";
    this.ctx.textAlign = "center";
    this.ctx.fillText("Procesando y renderizando forma de onda...", width / 2, height / 2 + 4);
  }

  drawPlaybackState(
    width: number,
    height: number,
    peaks: number[],
    currentTime: number,
    duration: number,
    isTranscribing: boolean,
    transcribePhase: number,
    hoverX: number
  ): void {
    this.ctx.clearRect(0, 0, width, height);

    const totalBars = peaks.length;
    const barWidth = (width - 32) / totalBars;
    const gap = 2; // pixel gap between bars
    const actualBarWidth = Math.max(1.5, barWidth - gap);
    
    // Playback percentage calculations
    const pct = isFinite(duration) && duration > 0 ? currentTime / duration : 0;
    const barsPlayed = Math.floor(pct * totalBars);

    // If transcribing, advance scanning animation position
    let scanBarIndex = -1;
    if (isTranscribing) {
      const scanPosition = (Math.sin(transcribePhase) + 1) / 2; // Sweep radar position from 0 to 1
      scanBarIndex = Math.floor(scanPosition * totalBars);
    }

    const yCenter = height / 2;
    const mainMaxHeight = height * 0.55;
    const reflectionScale = 0.5; // reflection is 50% height of main peak

    for (let i = 0; i < totalBars; i++) {
      const barHeight = peaks[i] * mainMaxHeight;
      const x = 16 + i * barWidth;
      
      // 1. Draw Main Bar (grows upwards from center line)
      const yMain = yCenter - barHeight;
      this.ctx.beginPath();
      this.ctx.roundRect(x, yMain, actualBarWidth, barHeight, actualBarWidth / 2);

      // Color scheme for Main Bar
      if (isTranscribing) {
        const dist = Math.abs(i - scanBarIndex);
        if (dist < 6) {
          const intensity = 1 - dist / 6;
          // Futuristic radar scanner glowing effect between emerald (150) and indigo (240)
          this.ctx.fillStyle = `hsla(${150 + intensity * 90}, 84%, 55%, ${0.2 + intensity * 0.8})`;
        } else {
          this.ctx.fillStyle = "rgba(148, 163, 184, 0.12)"; // Muted gray
        }
      } else if (i <= barsPlayed) {
        this.ctx.fillStyle = "#818cf8"; // var(--accent-hover)
      } else {
        this.ctx.fillStyle = "rgba(148, 163, 184, 0.25)"; // var(--text-muted) with opacity
      }
      this.ctx.fill();

      // 2. Draw Mirrored Reflection (grows downwards from center line)
      const reflectionHeight = barHeight * reflectionScale;
      this.ctx.beginPath();
      this.ctx.roundRect(x, yCenter, actualBarWidth, reflectionHeight, actualBarWidth / 2);

      // Color scheme for Mirrored Reflection (low opacity / translucent)
      if (isTranscribing) {
        const dist = Math.abs(i - scanBarIndex);
        if (dist < 6) {
          const intensity = 1 - dist / 6;
          this.ctx.fillStyle = `hsla(${150 + intensity * 90}, 84%, 55%, ${(0.2 + intensity * 0.8) * 0.25})`;
        } else {
          this.ctx.fillStyle = "rgba(148, 163, 184, 0.04)";
        }
      } else if (i <= barsPlayed) {
        this.ctx.fillStyle = "rgba(129, 140, 248, 0.25)"; // Faded played color
      } else {
        this.ctx.fillStyle = "rgba(148, 163, 184, 0.08)"; // Very faint unplayed color
      }
      this.ctx.fill();
    }

    // Only draw the vertical green playhead if NOT transcribing
    if (!isTranscribing) {
      const playheadX = 16 + pct * (width - 32);
      
      this.ctx.beginPath();
      this.ctx.moveTo(playheadX, 4);
      this.ctx.lineTo(playheadX, height - 4);
      this.ctx.strokeStyle = "#10b981"; // var(--success-color)
      this.ctx.lineWidth = 2;
      this.ctx.shadowColor = "rgba(16, 185, 129, 0.6)";
      this.ctx.shadowBlur = 6;
      this.ctx.stroke();
      
      // Clear shadow configurations for next runs
      this.ctx.shadowBlur = 0;

      // Draw hover dashed playhead and exact seeking time tooltip capsule
      if (hoverX >= 16 && hoverX <= width - 16) {
        this.ctx.beginPath();
        this.ctx.setLineDash([4, 4]);
        this.ctx.moveTo(hoverX, 4);
        this.ctx.lineTo(hoverX, height - 4);
        this.ctx.strokeStyle = "rgba(129, 140, 248, 0.55)"; // var(--accent-hover) at 55% opacity
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
        this.ctx.setLineDash([]); // Reset line dash

        // Calculate time at hover position
        const hoverPct = (hoverX - 16) / (width - 32);
        const hoverTimeSec = hoverPct * duration;
        const mins = Math.floor(hoverTimeSec / 60);
        const secs = Math.floor(hoverTimeSec % 60);
        const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

        // Draw small pill-like tooltip box
        this.ctx.save();
        this.ctx.fillStyle = "rgba(15, 23, 42, 0.95)"; // Deep space slate
        this.ctx.strokeStyle = "rgba(129, 140, 248, 0.4)";
        this.ctx.lineWidth = 1;

        this.ctx.font = "bold 9px system-ui, sans-serif";
        const textWidth = this.ctx.measureText(timeStr).width;
        const boxWidth = textWidth + 10;
        const boxHeight = 16;
        const boxX = Math.max(16, Math.min(width - 16 - boxWidth, hoverX - boxWidth / 2));
        const boxY = 4; // Top of canvas

        this.ctx.beginPath();
        this.ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 4);
        this.ctx.fill();
        this.ctx.stroke();

        // Draw tooltip text
        this.ctx.fillStyle = "#818cf8"; // accent-hover
        this.ctx.textAlign = "center";
        this.ctx.fillText(timeStr, boxX + boxWidth / 2, boxY + 11);
        this.ctx.restore();
      }
    }
  }

  drawLiveMicrophoneWave(
    width: number,
    height: number,
    peaks: number[],
    isRecording: boolean,
    recordingPhase: number,
    currentVol: number
  ): void {
    this.ctx.clearRect(0, 0, width, height);

    const totalBars = peaks.length;
    const maxDisplayBars = 90;

    // Squeeze the waveform dynamically once it overflows the standard 90 columns!
    const barWidth = (width - 32) / Math.max(maxDisplayBars, totalBars);
    const gap = 2;
    const actualBarWidth = Math.max(1.5, barWidth - gap);

    const yCenter = height / 2;
    const mainMaxHeight = height * 0.55;
    const reflectionScale = 0.5;

    for (let i = 0; i < totalBars; i++) {
      const peakVal = peaks[i];
      const barHeight = Math.max(2, peakVal * mainMaxHeight); // minimum 2px height
      const x = 16 + i * barWidth;

      // 1. Main live peak (upwards)
      const yMain = yCenter - barHeight;
      this.ctx.beginPath();
      this.ctx.roundRect(x, yMain, actualBarWidth, barHeight, actualBarWidth / 2);

      if (isRecording && i === totalBars - 1) {
        this.ctx.fillStyle = "#10b981"; // success-color
      } else {
        const ratio = i / Math.max(maxDisplayBars, totalBars);
        this.ctx.fillStyle = `hsla(${240 - ratio * 90}, 75%, 65%, 0.85)`;
      }
      this.ctx.fill();

      // 2. Reflected live peak (downwards)
      const reflectionHeight = barHeight * reflectionScale;
      this.ctx.beginPath();
      this.ctx.roundRect(x, yCenter, actualBarWidth, reflectionHeight, actualBarWidth / 2);

      if (isRecording && i === totalBars - 1) {
        this.ctx.fillStyle = "rgba(16, 185, 129, 0.35)"; // translucent green
      } else {
        const ratio = i / Math.max(maxDisplayBars, totalBars);
        this.ctx.fillStyle = `hsla(${240 - ratio * 90}, 75%, 65%, 0.25)`; // faded gradient
      }
      this.ctx.fill();
    }

    // Draw active premium "● REC" indicator in top right of the canvas
    const dotAlpha = 0.4 + Math.abs(Math.sin(recordingPhase * 1.5)) * 0.6;

    this.ctx.save();
    this.ctx.globalAlpha = dotAlpha;
    this.ctx.fillStyle = "#ef4444";
    this.ctx.beginPath();
    this.ctx.arc(width - 24, 16, 5, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.globalAlpha = 0.6;
    this.ctx.font = "bold 9px system-ui, sans-serif";
    this.ctx.fillStyle = "#ef4444";
    this.ctx.textAlign = "right";
    this.ctx.fillText("REC", width - 34, 19);
    this.ctx.restore();
  }
}
