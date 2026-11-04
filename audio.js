// Character sounds, synthesised with the Web Audio API (no audio files): a sawtooth "voice" run through
// two vocal-tract style formant filters. Per character, 'work' is a short, bright call (mew / woof / moo /
// oink) and 'break' a longer, relaxed one.

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

const CHARACTER_VOICES = {
  cat: CAT_VOICES,
  dog: {
    work: { duration: 0.2, pitch: [330, 420, 220], peakAt: 0.25, formant1: [700, 900, 600], formant2: [1100, 1400, 1000], vibrato: 0, level: 0.55 },
    break: { duration: 0.45, pitch: [260, 330, 170], peakAt: 0.3, formant1: [600, 800, 520], formant2: [1000, 1300, 900], vibrato: 0, level: 0.5 },
  },
  cow: {
    work: { duration: 0.85, pitch: [150, 190, 130], peakAt: 0.4, formant1: [450, 520, 420], formant2: [850, 950, 800], vibrato: 5, level: 0.55 },
    break: { duration: 1.4, pitch: [130, 165, 105], peakAt: 0.45, formant1: [420, 500, 400], formant2: [800, 900, 750], vibrato: 4, level: 0.5 },
  },
  pig: {
    work: { duration: 0.3, pitch: [230, 310, 170], peakAt: 0.3, formant1: [520, 640, 480], formant2: [1500, 1800, 1400], vibrato: 28, depth: 40, level: 0.5 },
    break: { duration: 0.6, pitch: [190, 260, 140], peakAt: 0.35, formant1: [480, 600, 440], formant2: [1400, 1700, 1300], vibrato: 22, depth: 36, level: 0.45 },
  },
};

/** Schedule one call on any AudioContext (live or offline) starting at `start` seconds. */
function scheduleMeow(ctx, destination, kind, start, character = 'cat') {
  const voices = CHARACTER_VOICES[character] || CAT_VOICES;
  const v = voices[kind] || voices.work;
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
    depth.gain.setValueAtTime(v.depth || 14, start);
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

  /** Play a call ('work' or 'break') in the character's voice. Call from a click or key press so the browser allows audio. */
  meow(kind = 'work', character = 'cat') {
    try {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.audioCtx = new AudioContext();
      }
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      scheduleMeow(this.audioCtx, this.audioCtx.destination, kind, this.audioCtx.currentTime + 0.02, character);
    } catch (e) { /* audio unavailable */ }
  }
}

window.catSound = new CatSound();
window.scheduleMeow = scheduleMeow;
