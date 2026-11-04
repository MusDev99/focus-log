// Cat sound: plays sounds/meow.mp3 when you switch between work and break.
// The path is relative so it also works under a subpath (e.g. GitHub Pages).

class CatSound {
  constructor() {
    this.audio = new Audio('sounds/meow.mp3');
    this.audio.preload = 'auto';
  }

  /** Play the meow from the start. Call from a click or key press so the browser allows audio. */
  meow() {
    try {
      this.audio.currentTime = 0;
      const played = this.audio.play();
      if (played && played.catch) played.catch(() => { /* blocked or unavailable: stay silent */ });
    } catch (e) { /* audio unavailable */ }
  }
}

window.catSound = new CatSound();
