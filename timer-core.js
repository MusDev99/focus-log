// Pure timer logic (no DOM) so it can be unit-tested with `node --test`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TimerCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const MODES = ['focus', 'shortBreak', 'longBreak'];
  const STORAGE_KEY = 'pomodoro-timer-state';

  /** Duration in seconds for a mode, given config in minutes. */
  function modeDuration(mode, config) {
    if (mode === 'shortBreak') return config.short_break * 60;
    if (mode === 'longBreak') return config.long_break * 60;
    return config.focus_duration * 60;
  }

  /** Whole seconds left until endsAt (never negative). Wall-clock based, so it cannot drift. */
  function remainingSeconds(endsAt, now) {
    return Math.max(0, Math.ceil((endsAt - now) / 1000));
  }

  /** Mode that follows `mode`, where completedCycles already includes a just-finished focus. */
  function nextMode(mode, completedCycles, longBreakInterval) {
    if (mode !== 'focus') return 'focus';
    return completedCycles % longBreakInterval === 0 ? 'longBreak' : 'shortBreak';
  }

  /** Snapshot of the timer to persist across reloads. */
  function snapshot(state, now) {
    return {
      mode: state.mode,
      running: state.running,
      endsAt: state.running ? now + state.timeLeft * 1000 : null,
      timeLeft: state.timeLeft,
      completedCycles: state.completedCycles,
      activeTaskId: state.activeTaskId || null,
    };
  }

  /**
   * Rebuild timer state from a stored snapshot.
   * Returns null if the snapshot is missing/invalid; `expired: true` if a running
   * timer finished while the page was closed.
   */
  function restore(raw, now, config) {
    let s = raw;
    if (typeof raw === 'string') {
      try { s = JSON.parse(raw); } catch (e) { return null; }
    }
    if (!s || typeof s !== 'object' || !MODES.includes(s.mode)) return null;

    const total = modeDuration(s.mode, config);
    const cycles = Number.isInteger(s.completedCycles) && s.completedCycles >= 0 ? s.completedCycles : 0;
    const base = { mode: s.mode, completedCycles: cycles, activeTaskId: s.activeTaskId || null };

    if (s.running && Number.isFinite(s.endsAt)) {
      const left = remainingSeconds(s.endsAt, now);
      if (left === 0) return { ...base, running: false, timeLeft: 0, expired: true };
      return { ...base, running: true, timeLeft: Math.min(left, total), expired: false };
    }
    const left = Number.isFinite(s.timeLeft) ? Math.min(Math.max(0, Math.floor(s.timeLeft)), total) : total;
    return { ...base, running: false, timeLeft: left > 0 ? left : total, expired: false };
  }

  /** mm:ss */
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /** Daily goal progress as {done, goal, percent (0-100), reached}. */
  function goalProgress(done, goal) {
    const g = Math.max(1, goal | 0);
    return { done, goal: g, percent: Math.min(100, Math.round((done / g) * 100)), reached: done >= g };
  }

  /** Map a keyboard event key to a timer action, or null. Ignores typing in form fields. */
  function shortcutAction(key, target) {
    const tag = target && target.tagName;
    if (key === ' ' && (tag === 'BUTTON' || tag === 'A')) return null; // native click handles it
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return null;
    switch (key) {
      case ' ': return 'toggle';
      case 'r': case 'R': return 'reset';
      case '1': return 'focus';
      case '2': return 'shortBreak';
      case '3': return 'longBreak';
      default: return null;
    }
  }

  /** Heat level 0-4 for a day's focus minutes relative to the busiest day (0 = no focus). */
  function heatLevel(minutes, maxMinutes) {
    if (!(minutes > 0) || !(maxMinutes > 0)) return 0;
    return Math.min(4, Math.max(1, Math.ceil((minutes / maxMinutes) * 4)));
  }

  /**
   * Lay heatmap days out for a 7-row, column-flow grid (row 0 = Sunday):
   * leading nulls push the first date onto its weekday row.
   */
  function heatmapCells(days) {
    if (!days.length) return [];
    const firstDow = new Date(days[0].date + 'T00:00:00Z').getUTCDay();
    return Array(firstDow).fill(null).concat(days);
  }

  /** "2/4 🍅" style progress text; "3 🍅" when there is no estimate. */
  function estimateLabel(actual, estimate) {
    if (!estimate) return actual > 0 ? `${actual} 🍅` : '';
    return `${actual}/${estimate} 🍅`;
  }

  // http(s) links, or www. ones; trailing punctuation belongs to the sentence, not the link
  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const TRAILING_RE = /[.,;:!?)\]}'"]+$/;

  /** Short, readable form of a URL: host (no www.) plus path, cut to `max` chars. */
  function shortUrl(href, max = 40) {
    let label;
    try {
      const u = new URL(href);
      label = u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
    } catch (e) {
      label = href;
    }
    return label.length > max ? label.slice(0, max - 1) + '…' : label;
  }

  /**
   * Split task text into plain text and links, for rendering without innerHTML:
   * [{type:'text', value}, {type:'link', href, label}]. Only http(s) links are produced.
   */
  function taskTextParts(text) {
    const parts = [];
    let last = 0;
    String(text).replace(URL_RE, (match, offset) => {
      const raw = match.replace(TRAILING_RE, '');
      if (offset > last) parts.push({ type: 'text', value: text.slice(last, offset) });
      const href = /^www\./i.test(raw) ? `https://${raw}` : raw;
      parts.push({ type: 'link', href, label: shortUrl(href) });
      last = offset + raw.length;
      return match;
    });
    if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
    return parts;
  }

  /** Task text with links shortened, for places that show plain text (pill, stats, toasts). */
  function taskDisplayText(text) {
    return taskTextParts(text).map(p => (p.type === 'link' ? p.label : p.value)).join('');
  }

  /** First link in the task text, or null. */
  function firstTaskLink(text) {
    const link = taskTextParts(text).find(p => p.type === 'link');
    return link ? link.href : null;
  }

  return {
    heatLevel, heatmapCells, estimateLabel, shortUrl, taskTextParts, taskDisplayText, firstTaskLink,
    MODES, STORAGE_KEY, modeDuration, remainingSeconds, nextMode,
    snapshot, restore, formatTime, goalProgress, shortcutAction,
  };
});
