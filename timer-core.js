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

  // ---- Developer views: where the time went by ticket or repo, whether story points track effort, work in progress ----

  /** Local midnight, `days - 1` days before `now` (so the window is `days` calendar days ending today). */
  function windowStart(now, days) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
  }

  /**
   * Where a task's work lives, from the first link in its text: a Jira ticket (by key), a GitHub repo
   * (PRs and issues of one repo group together) or a site. null when the text has no link.
   */
  function sourceOfText(text) {
    const href = firstTaskLink(text);
    if (!href) return null;
    let url;
    try {
      url = new URL(href);
    } catch (e) {
      return null;
    }
    const jira = url.pathname.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/) || (url.searchParams.get('selectedIssue') || '').match(/^([A-Z][A-Z0-9_]*-\d+)$/);
    if (jira) return { kind: 'jira', key: `jira:${jira[1]}`, label: jira[1], href };
    const gh = url.hostname === 'github.com' && url.pathname.match(/^\/([^/]+)\/([^/]+)/);
    if (gh) return { kind: 'github', key: `github:${gh[1]}/${gh[2]}`.toLowerCase(), label: `${gh[1]}/${gh[2]}`, href: `https://github.com/${gh[1]}/${gh[2]}` };
    const host = url.hostname.replace(/^www\./, '');
    return { kind: 'other', key: `other:${host}`, label: host, href: `${url.protocol}//${url.host}` };
  }

  /**
   * Focus time of the last `days` days grouped by the ticket or repo in each task's link, largest first.
   * `tasks` as from store.listTasks(), `sessions` as from store.listFocusSessions(). Time with no link (or no
   * task) counts toward the total but not to a group.
   * Returns {totalSeconds, linkedSeconds, streams: [{kind, key, label, href, seconds, share, tasks, done, points}]}.
   */
  function timeBySource(tasks, sessions, now, days = 7) {
    const from = windowStart(now, days);
    const byId = new Map(tasks.map((t) => [String(t.id), t]));
    const groups = new Map();
    let totalSeconds = 0;
    let linkedSeconds = 0;
    sessions.forEach((s) => {
      const seconds = s.duration_seconds;
      if (!(seconds > 0) || !(Date.parse(s.completed_at) >= from)) return;
      totalSeconds += seconds;
      const task = s.task_id == null ? null : byId.get(String(s.task_id));
      const source = task ? sourceOfText(task.text) : null;
      if (!source) return;
      linkedSeconds += seconds;
      const group = groups.get(source.key) || { source, seconds: 0, ids: new Set() };
      group.seconds += seconds;
      group.ids.add(String(task.id));
      groups.set(source.key, group);
    });
    const streams = [...groups.values()].map((g) => {
      const done = [...g.ids].map((id) => byId.get(id)).filter((t) => t.completed === true);
      return {
        ...g.source,
        seconds: g.seconds,
        share: totalSeconds ? g.seconds / totalSeconds : 0,
        tasks: g.ids.size,
        done: done.length,
        points: done.reduce((sum, t) => sum + (Number.isInteger(t.points) ? t.points : 0), 0),
      };
    });
    streams.sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
    return { totalSeconds, linkedSeconds, streams };
  }

  /** Time under which a finished task is too short to say anything about its size. */
  const MIN_SIZING_MS = 5 * 60 * 1000;

  /**
   * Do bigger story points take longer? Finished, scored tasks of the last `days` days with at least 5 minutes
   * on their own clock, averaged per point value (ascending). `verdict` is 'tracks' when time grows with points,
   * 'drifts' when a bigger size averaged under 90% of the next smaller one (with the pair in `example`), and
   * null with fewer than three sizes to compare.
   */
  function sizingCheck(tasks, now, days = 28) {
    const from = windowStart(now, days);
    const bySize = new Map();
    tasks.forEach((t) => {
      if (t.completed !== true || !Number.isInteger(t.points) || t.points < 1) return;
      if (!(Date.parse(t.completed_at) >= from) || !(t.elapsed_ms >= MIN_SIZING_MS)) return;
      const g = bySize.get(t.points) || { points: t.points, tasks: 0, ms: 0 };
      g.tasks++;
      g.ms += t.elapsed_ms;
      bySize.set(t.points, g);
    });
    const rows = [...bySize.values()].sort((a, b) => a.points - b.points).map((g) => ({ points: g.points, tasks: g.tasks, avgMs: g.ms / g.tasks }));
    if (rows.length < 3) return { rows, verdict: null, example: null };
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].avgMs < rows[i - 1].avgMs * 0.9) return { rows, verdict: 'drifts', example: [rows[i - 1].points, rows[i].points] };
    }
    return { rows, verdict: 'tracks', example: null };
  }

  /** The sentence under the sizing check, or '' when there is nothing to say (fewer than three sizes). */
  function sizingVerdictText(check) {
    if (check.verdict === 'tracks') return 'Bigger sizes take longer: your story points track effort.';
    if (check.verdict !== 'drifts' || !check.example) return '';
    const [small, big] = check.example;
    const article = /^(8|11|18)/.test(String(big)) ? 'An' : 'A'; // "an 8", "an 11", "an 18"
    return `${article} ${big} SP task took less time than a ${small} SP one. Re-size after finishing so the next estimate is closer.`;
  }

  /** Started but not finished: open tasks that have time on their clock or are running now. */
  function wipTasks(tasks) {
    return tasks.filter((t) => t.completed !== true && (t.running === true || t.elapsed_ms > 0));
  }

  return {
    heatLevel, heatmapCells, formatElapsed, shortUrl, taskTextParts, taskDisplayText, firstTaskLink,
    goalProgress, shortcutAction, sourceOfText, timeBySource, sizingCheck, sizingVerdictText, wipTasks,
  };
});
