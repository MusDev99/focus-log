// Cat sounds, synthesised with the Web Audio API (no audio files): a sawtooth "voice" run through two
// vocal-tract style formant filters. 'work' is a short, bright "mew!"; 'break' is a long, relaxed "mrrow~".

const CAT_VOICES = {
  work: {
    duration: 0.42,
    pitch: [540, 840, 600],       // Hz: start, peak, end
    peakAt: 0.3,                  // peak position, as a share of the duration
    formant1: [700, 1050, 640],
    formant2: [1900, 2400, 1700],
    vibrato: 0,
    level: 0.5,
  },
  break: {
    duration: 0.9,
    pitch: [400, 640, 330],
    peakAt: 0.35,
    formant1: [620, 900, 560],
    formant2: [1500, 2000, 1300],
    vibrato: 7,
    level: 0.45,
  },
};

/** Schedule one meow on any AudioContext (live or offline) starting at `start` seconds. */
function scheduleMeow(ctx, destination, kind, start) {
  const v = CAT_VOICES[kind] || CAT_VOICES.work;
  const end = start + v.duration;
  const peak = start + v.duration * v.peakAt;

  const sweep = (param, [from, top, to]) => {
    param.setValueAtTime(from, start);
    param.linearRampToValueAtTime(top, peak);
    param.exponentialRampToValueAtTime(to, end);
  };

  const voice = ctx.createOscillator();
  voice.type = 'sawtooth';
  sweep(voice.frequency, v.pitch);

  if (v.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.setValueAtTime(v.vibrato, start);
    depth.gain.setValueAtTime(14, start);
    lfo.connect(depth);
    depth.connect(voice.frequency);
    lfo.start(start);
    lfo.stop(end + 0.05);
  }

  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, start);
  out.gain.exponentialRampToValueAtTime(v.level, start + 0.04);
  out.gain.exponentialRampToValueAtTime(v.level * 0.7, peak);
  out.gain.exponentialRampToValueAtTime(0.0001, end);
  out.connect(destination);

  [[v.formant1, 1.6, 5], [v.formant2, 1, 8]].forEach(([freqs, gain, q]) => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(q, start);
    sweep(filter.frequency, freqs);
    const level = ctx.createGain();
    level.gain.setValueAtTime(gain, start);
    voice.connect(filter);
    filter.connect(level);
    level.connect(out);
  });

  voice.start(start);
  voice.stop(end + 0.05);
}

class CatSound {
  constructor() {
    this.audioCtx = null;
  }

  /** Play a meow ('work' or 'break'). Call from a click or key press so the browser allows audio. */
  meow(kind = 'work') {
    try {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      scheduleMeow(this.audioCtx, this.audioCtx.destination, kind, this.audioCtx.currentTime + 0.02);
    } catch (e) { /* audio unavailable */ }
  }
}

window.catSound = new CatSound();
window.scheduleMeow = scheduleMeow;
