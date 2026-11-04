// Character sounds: each character plays its recorded clip (sounds/*.mp3, see SAMPLE_FILES below). These
// voices are the fallback when a clip cannot load: synthesised with the Web Audio API, a sawtooth "voice"
// run through two vocal-tract style formant filters. Per character, 'work' is a short, bright call
// (mew / woof / moo / oink) and 'break' a longer, relaxed one.

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

// Recorded calls (short mp3s, precached by the service worker). The synthesised voices above are the
// fallback if a clip fails to load or decode.
const SAMPLE_FILES = { cat: 'sounds/meow.mp3', dog: 'sounds/dog.mp3', cow: 'sounds/cow.mp3', pig: 'sounds/pig.mp3', cheer: 'sounds/yay.mp3' };
const SAMPLE_LEVEL = { work: 1, break: 0.7 }; // a break call is quieter

class CatSound {
  constructor() {
    this.audioCtx = null;
    this.samples = {}; // character -> Promise<AudioBuffer | null>
  }

  context() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  /** Fetch and decode a character's recording once; resolves null when there is none or it fails. */
  sample(character) {
    const file = SAMPLE_FILES[character];
    const ctx = this.context();
    if (!file || !ctx) return Promise.resolve(null);
    if (!this.samples[character]) {
      this.samples[character] = fetch(file)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('sample missing'))))
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null);
    }
    return this.samples[character];
  }

  /** Warm the chosen character's recording so the first call plays without delay. */
  preload(character) {
    try { this.sample(character); } catch (e) { /* audio unavailable */ }
  }

  /** Play a call ('work' or 'break') in the character's voice. Call from a click or key press so the browser allows audio. */
  meow(kind = 'work', character = 'cat') {
    try {
      const ctx = this.context();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      this.sample(character).then((buffer) => {
        try {
          if (!buffer) {
            scheduleMeow(ctx, ctx.destination, kind, ctx.currentTime + 0.02, character);
            return;
          }
          const source = ctx.createBufferSource();
          const gain = ctx.createGain();
          source.buffer = buffer;
          gain.gain.value = SAMPLE_LEVEL[kind] || 1;
          source.connect(gain);
          gain.connect(ctx.destination);
          source.start();
        } catch (e) { /* audio unavailable */ }
      });
    } catch (e) { /* audio unavailable */ }
  }
}

/** Cheer for a finished task or a reached daily target (the same clip whichever character is chosen). */
CatSound.prototype.cheer = function cheer() {
  try {
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    this.sample('cheer').then((buffer) => {
      try {
        if (!buffer) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start();
      } catch (e) { /* audio unavailable */ }
    });
  } catch (e) { /* audio unavailable */ }
};

window.catSound = new CatSound();
window.scheduleMeow = scheduleMeow;
