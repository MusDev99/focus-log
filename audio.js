// Cat sounds: sounds/meow.mp3 when you switch between work and break, sounds/yay.mp3 as a cheer
// when a task is done or a daily target is reached.
// The path is relative so it also works under a subpath (e.g. GitHub Pages).

class CatSound {
  constructor() {
    this.audio = new Audio('sounds/meow.mp3');
    this.audio.preload = 'auto';
    this.cheerAudio = new Audio('sounds/yay.mp3');
    this.cheerAudio.preload = 'auto';
  }

  play(audio) {
    try {
      audio.currentTime = 0;
      const played = audio.play();
      if (played && played.catch) played.catch(() => { /* blocked or unavailable: stay silent */ });
    } catch (e) { /* audio unavailable */ }
  }

  /** Play the meow from the start. Call from a click or key press so the browser allows audio. */
  meow() { this.play(this.audio); }

  /** Cheer for a finished task or a reached daily target. */
  cheer() { this.play(this.cheerAudio); }
}

window.catSound = new CatSound();
