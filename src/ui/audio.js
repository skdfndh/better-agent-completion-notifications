/**
 * Web Audio API 声音提示引擎
 * 针对 completed, attention, error 合成清脆微触感提示音
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  play(cue) {
    if (!this.enabled || !cue) return;
    try {
      const ctx = this.ensureContext();
      const now = ctx.currentTime;

      if (cue === 'completed') {
        this.playCompleted(ctx, now);
      } else if (cue === 'attention') {
        this.playAttention(ctx, now);
      } else if (cue === 'error') {
        this.playError(ctx, now);
      }
    } catch (err) {
      console.warn('[SoundEngine] Playback failed:', err);
    }
  }

  playCompleted(ctx, now) {
    // 优雅的双音升阶泛音 (E5: 659.25Hz -> B5: 987.77Hz)
    const notes = [
      { freq: 659.25, time: now, duration: 0.28 },
      { freq: 987.77, time: now + 0.08, duration: 0.45 },
    ];

    notes.forEach(({ freq, time, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.16, time + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + duration);
    });
  }

  playAttention(ctx, now) {
    // 温和清脆的两声提醒音 (A5: 880Hz, 两次微脉冲)
    [0, 0.12].forEach((offset) => {
      const time = now + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, time);
      osc.frequency.exponentialRampToValueAtTime(1174.66, time + 0.08); // 滑音至 D6

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.18, time + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + 0.18);
    });
  }

  playError(ctx, now) {
    // 带有阻尼感的两段低音警示 (240Hz -> 180Hz)
    [
      { freq: 240, time: now, duration: 0.15 },
      { freq: 180, time: now + 0.1, duration: 0.25 },
    ].forEach(({ freq, time, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.2, time + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + duration);
    });
  }
}

export const soundEngine = new SoundEngine();
