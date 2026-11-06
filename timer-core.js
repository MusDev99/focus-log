// Pure helpers for the work/break clock and task text (no DOM) so it can be unit-tested with `node --test`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TimerCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /** Time spent as "m:ss" (or "h:mm:ss" from one hour), from milliseconds. */
  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  /** Daily goal progress as {done, goal, percent (0-100), reached}. */
  function goalProgress(done, goal) {
    const g = Math.max(1, goal | 0);
    return { done, goal: g, percent: Math.min(100, Math.round((done / g) * 100)), reached: done >= g };
  }

  /** Map a keyboard event key to a clock action ('toggle', 'work', 'break'), or null. Ignores typing in form fields. */
  function shortcutAction(key, target) {
    const tag = target && target.tagName;
    if (key === ' ' && (tag === 'BUTTON' || tag === 'A')) return null; // native click handles it
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return null;
    switch (key) {
      case ' ': return 'toggle';
      case '1': return 'work';
      case '2': return 'break';
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
    heatLevel, heatmapCells, formatElapsed, shortUrl, taskTextParts, taskDisplayText, firstTaskLink,
    goalProgress, shortcutAction,
  };
});
