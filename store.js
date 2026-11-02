// localStorage-backed data layer (tasks, sessions, settings, stats). No DOM, so it can be
// unit-tested with `node --test` by passing any object with getItem/setItem.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PomodoroStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const KEYS = { tasks: 'pomodoro-tasks', sessions: 'pomodoro-sessions', settings: 'pomodoro-settings' };
  const MAX_TASK_LENGTH = 80;
  const MAX_ESTIMATE = 20;
  const MAX_POINTS = 100;
  const MAX_SESSION_SECONDS = 24 * 60 * 60;
  const TOP_TASKS_LIMIT = 10;
  const VALID_MODES = ['focus', 'shortBreak', 'longBreak'];

  const DEFAULT_SETTINGS = {
    focus_duration: 25,
    short_break: 5,
    long_break: 15,
    long_break_interval: 4,
    auto_start: 0,
    daily_goal: 4,
    daily_points_goal: 10,
    theme: 'light',
  };

  // key -> [min, max] for integers, or an array of allowed strings.
  const SETTING_RULES = {
    focus_duration: [1, 90],
    short_break: [1, 30],
    long_break: [1, 60],
    long_break_interval: [1, 10],
    auto_start: [0, 1],
    daily_goal: [1, 24],
    daily_points_goal: [1, 500],
    theme: ['light', 'dark'],
  };

  /** 'YYYY-MM-DD' for a Date in local time. */
  function localDayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDays(date, n) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  }

  /** Keep only known settings with valid values; invalid entries are dropped. */
  function cleanSettings(data) {
    const clean = {};
    if (!data || typeof data !== 'object') return clean;
    Object.keys(SETTING_RULES).forEach((key) => {
      if (!(key in data)) return;
      const rule = SETTING_RULES[key];
      let value = data[key];
      if (typeof rule[0] === 'string') {
        if (rule.includes(value)) clean[key] = value;
        return;
      }
      if (typeof value === 'boolean') value = Number(value);
      if (Number.isInteger(value) && value >= rule[0] && value <= rule[1]) clean[key] = value;
    });
    return clean;
  }

  /** Consecutive active days ending today (or yesterday if today has no session yet). */
  function computeStreak(activeDays, today) {
    const active = new Set(activeDays);
    let day = today;
    if (!active.has(localDayKey(day))) day = addDays(day, -1);
    let streak = 0;
    while (active.has(localDayKey(day))) {
      streak++;
      day = addDays(day, -1);
    }
    return streak;
  }

  /** Neutralise spreadsheet formula injection: prefix cells starting with = + - @ (or tab/CR). */
  function csvSafe(value) {
    const s = String(value);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }

  function csvCell(value) {
    const s = csvSafe(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const round1 = (n) => Math.round(n * 10) / 10;

  const BACKUP_APP = 'pomodoro-focus-dashboard';
  const BACKUP_VERSION = 1;

  /** Eisenhower/Covey quadrant: 1 urgent+important, 2 important, 3 urgent, 4 neither; null = not sorted yet. */
  const cleanQuadrant = (q) => (Number.isInteger(q) && q >= 1 && q <= 4 ? q : null);
  const clampEstimate = (n) => (Number.isInteger(n) ? Math.min(MAX_ESTIMATE, Math.max(0, n)) : 0);
  /** Optional story points; 0 = not scored. */
  const cleanPoints = (n) => (Number.isInteger(n) ? Math.min(MAX_POINTS, Math.max(0, n)) : 0);

  /** A task from an imported backup, normalised, or null if unusable. */
  function cleanTask(t) {
    if (!t || typeof t !== 'object' || typeof t.text !== 'string' || !t.text.trim()) return null;
    if (typeof t.id !== 'string' && typeof t.id !== 'number') return null;
    const created = Date.parse(t.created_at);
    const done = Date.parse(t.completed_at);
    const completed = t.completed === true;
    return {
      id: String(t.id),
      text: t.text.trim().slice(0, MAX_TASK_LENGTH),
      completed,
      estimate: clampEstimate(t.estimate),
      quadrant: cleanQuadrant(t.quadrant),
      points: cleanPoints(t.points),
      created_at: Number.isNaN(created) ? new Date(0).toISOString() : new Date(created).toISOString(),
      completed_at: completed && !Number.isNaN(done) ? new Date(done).toISOString() : null,
    };
  }

  /** A session from an imported backup, normalised, or null if unusable. */
  function cleanSession(s) {
    if (!s || typeof s !== 'object' || !VALID_MODES.includes(s.mode)) return null;
    if (typeof s.id !== 'string' && typeof s.id !== 'number') return null;
    const d = s.duration_seconds;
    const at = Date.parse(s.completed_at);
    if (!Number.isInteger(d) || d < 1 || d > MAX_SESSION_SECONDS || Number.isNaN(at)) return null;
    return {
      id: String(s.id), mode: s.mode, duration_seconds: d,
      completed_at: new Date(at).toISOString(),
      task_id: s.task_id == null ? null : String(s.task_id),
    };
  }

  /** Longest run of consecutive days in a list of 'YYYY-MM-DD' keys. */
  function longestStreak(dayKeys) {
    const days = [...new Set(dayKeys)].sort();
    let best = 0;
    let run = 0;
    let prev = null;
    days.forEach((key) => {
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      run = prev && localDayKey(addDays(prev, 1)) === key ? run + 1 : 1;
      best = Math.max(best, run);
      prev = date;
    });
    return best;
  }

  function createStore(storage, now = () => new Date()) {
    let lastId = 0;

    function read(key, fallback) {
      try {
        const v = JSON.parse(storage.getItem(key));
        return v === null || v === undefined ? fallback : v;
      } catch (e) {
        return fallback;
      }
    }

    function write(key, value) {
      try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota / unavailable */ }
    }

    function newId() {
      lastId = Math.max(lastId + 1, now().getTime());
      return String(lastId);
    }

    function readList(key) {
      const v = read(key, []);
      return Array.isArray(v) ? v : [];
    }

    const rawTasks = () => readList(KEYS.tasks);
    const rawSessions = () => readList(KEYS.sessions);
    const focusSessions = () => rawSessions().filter((s) => s.mode === 'focus');

    function getSettings() {
      return { ...DEFAULT_SETTINGS, ...cleanSettings(read(KEYS.settings, {})) };
    }

    /** Merge valid entries into saved settings; returns the full settings object. */
    function saveSettings(partial) {
      const next = { ...getSettings(), ...cleanSettings(partial) };
      write(KEYS.settings, next);
      return next;
    }

    /** Tasks in creation order, each with `actual` = focus sessions logged against it. */
    function listTasks() {
      const counts = {};
      focusSessions().forEach((s) => {
        if (s.task_id != null) counts[s.task_id] = (counts[s.task_id] || 0) + 1;
      });
      return rawTasks().map((t) => ({
        ...t, quadrant: cleanQuadrant(t.quadrant), points: cleanPoints(t.points),
        completed_at: t.completed_at || null, actual: counts[t.id] || 0,
      }));
    }

    function addTask(text, estimate = 0, quadrant = null, points = 0) {
      const clean = typeof text === 'string' ? text.trim().slice(0, MAX_TASK_LENGTH) : '';
      if (!clean) return null;
      const task = {
        id: newId(), text: clean, completed: false, estimate: clampEstimate(estimate), quadrant: cleanQuadrant(quadrant),
        points: cleanPoints(points), created_at: now().toISOString(), completed_at: null,
      };
      write(KEYS.tasks, rawTasks().concat(task));
      return task;
    }

    function updateTask(id, fields) {
      let found = false;
      const tasks = rawTasks().map((t) => {
        if (t.id !== id) return t;
        found = true;
        const next = { ...t };
        if (typeof fields.completed === 'boolean' && fields.completed !== (t.completed === true)) {
          next.completed = fields.completed;
          // points count on the day the task was finished
          next.completed_at = fields.completed ? now().toISOString() : null;
        }
        if (typeof fields.text === 'string' && fields.text.trim()) next.text = fields.text.trim().slice(0, MAX_TASK_LENGTH);
        if (Number.isInteger(fields.estimate)) next.estimate = Math.min(MAX_ESTIMATE, Math.max(0, fields.estimate));
        if ('quadrant' in fields) next.quadrant = cleanQuadrant(fields.quadrant);
        if ('points' in fields) next.points = cleanPoints(fields.points);
        return next;
      });
      if (found) write(KEYS.tasks, tasks);
      return found;
    }

    function deleteTask(id) {
      const tasks = rawTasks();
      const kept = tasks.filter((t) => t.id !== id);
      if (kept.length !== tasks.length) write(KEYS.tasks, kept);
      return kept.length !== tasks.length;
    }

    /** Put a deleted task back (undo), at `index` in the list; ignored if its id already exists. */
    function restoreTask(task, index) {
      const clean = cleanTask(task);
      const tasks = rawTasks();
      if (!clean || tasks.some((t) => t.id === clean.id)) return false;
      const at = Number.isInteger(index) ? Math.min(Math.max(0, index), tasks.length) : tasks.length;
      tasks.splice(at, 0, clean);
      write(KEYS.tasks, tasks);
      return true;
    }

    /** Reorder tasks to follow `ids`; unknown ids are ignored, tasks missing from `ids` keep their place at the end. */
    function reorderTasks(ids) {
      const tasks = rawTasks();
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const seen = new Set();
      const ordered = [];
      ids.forEach((id) => {
        if (byId.has(id) && !seen.has(id)) {
          seen.add(id);
          ordered.push(byId.get(id));
        }
      });
      write(KEYS.tasks, ordered.concat(tasks.filter((t) => !seen.has(t.id))));
    }

    /** Everything needed to restore this app on another browser/device. */
    function exportBackup() {
      return {
        app: BACKUP_APP, version: BACKUP_VERSION, exported_at: now().toISOString(),
        settings: getSettings(), tasks: rawTasks(), sessions: rawSessions(),
      };
    }

    /**
     * Merge a backup into the current data: tasks and sessions are added by id (existing ids are kept),
     * settings are taken from the backup. Throws an Error with a user-facing message if the file is not a backup.
     * Returns {tasks, sessions} = how many were added.
     */
    function importBackup(data) {
      if (!data || typeof data !== 'object' || data.app !== BACKUP_APP || !Array.isArray(data.tasks) || !Array.isArray(data.sessions)) {
        throw new Error('This file is not a Pomodoro backup.');
      }
      if (!(data.version <= BACKUP_VERSION)) throw new Error('This backup was made by a newer version of the app.');

      const tasks = rawTasks();
      const taskIds = new Set(tasks.map((t) => t.id));
      const newTasks = data.tasks.map(cleanTask).filter((t) => t && !taskIds.has(t.id) && taskIds.add(t.id));

      const sessions = rawSessions();
      const sessionIds = new Set(sessions.map((s) => s.id));
      const newSessions = data.sessions.map(cleanSession).filter((s) => s && !sessionIds.has(s.id) && sessionIds.add(s.id));

      write(KEYS.tasks, tasks.concat(newTasks));
      write(KEYS.sessions, sessions.concat(newSessions)
        .sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at)));
      saveSettings(data.settings);
      return { tasks: newTasks.length, sessions: newSessions.length };
    }

    function logSession({ mode = 'focus', duration_seconds = 1500, task_id = null } = {}) {
      if (!VALID_MODES.includes(mode)) return null;
      if (!Number.isInteger(duration_seconds) || duration_seconds < 1 || duration_seconds > MAX_SESSION_SECONDS) return null;
      const session = {
        id: newId(), mode, duration_seconds,
        completed_at: now().toISOString(),
        task_id: task_id == null ? null : String(task_id),
      };
      write(KEYS.sessions, rawSessions().concat(session));
      return session;
    }

    /** {dayKey: {seconds, count}} for focus sessions in local time. */
    function perDay() {
      const out = {};
      focusSessions().forEach((s) => {
        const key = localDayKey(new Date(s.completed_at));
        const d = out[key] || (out[key] = { seconds: 0, count: 0 });
        d.seconds += s.duration_seconds;
        d.count++;
      });
      return out;
    }

    /** Today, last 7 days, streak and totals. */
    function summary() {
      const today = now();
      const days = perDay();
      const daily = [];
      for (let i = 6; i >= 0; i--) {
        const d = addDays(today, -i);
        const key = localDayKey(d);
        daily.push({
          date: key,
          label: d.toLocaleDateString('en-US', { weekday: 'short' }),
          minutes: round1((days[key] ? days[key].seconds : 0) / 60),
        });
      }
      const t = days[localDayKey(today)] || { seconds: 0, count: 0 };
      const all = focusSessions();
      return {
        today_minutes: round1(t.seconds / 60),
        today_sessions: t.count,
        streak: computeStreak(Object.keys(days), today),
        total_sessions: all.length,
        total_minutes: round1(all.reduce((acc, s) => acc + s.duration_seconds, 0) / 60),
        daily_breakdown: daily,
      };
    }

    /** Focus time per task (top `limit` by minutes), including sessions with no/deleted task. */
    function taskStats(limit = TOP_TASKS_LIMIT) {
      const titles = {};
      rawTasks().forEach((t) => { titles[t.id] = t.text; });
      const groups = new Map();
      focusSessions().forEach((s) => {
        const g = groups.get(s.task_id) || { task_id: s.task_id, sessions: 0, seconds: 0 };
        g.sessions++;
        g.seconds += s.duration_seconds;
        groups.set(s.task_id, g);
      });
      return [...groups.values()]
        .sort((a, b) => b.seconds - a.seconds || String(a.task_id).localeCompare(String(b.task_id)))
        .slice(0, limit)
        .map((g) => ({
          task_id: g.task_id,
          label: g.task_id == null ? 'No task' : titles[g.task_id] || '(deleted task)',
          sessions: g.sessions,
          minutes: round1(g.seconds / 60),
        }));
    }

    /** Focus minutes per local day for the last `days` days, oldest first, zero-filled. */
    function heatmap(days = 84) {
      const today = now();
      const per = perDay();
      const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const key = localDayKey(addDays(today, -i));
        const d = per[key] || { seconds: 0, count: 0 };
        out.push({ date: key, minutes: round1(d.seconds / 60), sessions: d.count });
      }
      return out;
    }

    /** Focus on one local day ('YYYY-MM-DD'): totals plus minutes per task, busiest first. */
    function dayDetail(dateKey) {
      const titles = {};
      rawTasks().forEach((t) => { titles[t.id] = t.text; });
      const groups = new Map();
      let seconds = 0;
      let count = 0;
      focusSessions().forEach((s) => {
        if (localDayKey(new Date(s.completed_at)) !== dateKey) return;
        seconds += s.duration_seconds;
        count++;
        const g = groups.get(s.task_id) || { task_id: s.task_id, sessions: 0, seconds: 0 };
        g.sessions++;
        g.seconds += s.duration_seconds;
        groups.set(s.task_id, g);
      });
      return {
        date: dateKey,
        minutes: round1(seconds / 60),
        sessions: count,
        tasks: [...groups.values()]
          .sort((a, b) => b.seconds - a.seconds)
          .map((g) => ({
            label: g.task_id == null ? 'No task' : titles[g.task_id] || '(deleted task)',
            sessions: g.sessions,
            minutes: round1(g.seconds / 60),
          })),
      };
    }

    /**
     * Last 7 days (including today) compared with the 7 days before, plus best day,
     * top task this week and the longest streak ever.
     */
    function weeklyReview() {
      const today = now();
      const per = perDay();
      const sumDays = (from, to) => {
        let seconds = 0;
        let count = 0;
        for (let i = from; i <= to; i++) {
          const d = per[localDayKey(addDays(today, -i))];
          if (d) { seconds += d.seconds; count += d.count; }
        }
        return { minutes: round1(seconds / 60), sessions: count };
      };
      const thisWeek = sumDays(0, 6);
      const lastWeek = sumDays(7, 13);

      let bestDay = null;
      for (let i = 6; i >= 0; i--) {
        const d = addDays(today, -i);
        const entry = per[localDayKey(d)];
        if (entry && (!bestDay || entry.seconds / 60 > bestDay.minutes)) {
          bestDay = { date: localDayKey(d), label: d.toLocaleDateString('en-US', { weekday: 'long' }), minutes: round1(entry.seconds / 60) };
        }
      }

      const weekStart = addDays(today, -6).getTime();
      const titles = {};
      rawTasks().forEach((t) => { titles[t.id] = t.text; });
      const perTask = {};
      focusSessions().forEach((s) => {
        if (s.task_id == null || Date.parse(s.completed_at) < weekStart) return;
        perTask[s.task_id] = (perTask[s.task_id] || 0) + s.duration_seconds;
      });
      const topId = Object.keys(perTask).sort((a, b) => perTask[b] - perTask[a])[0];

      return {
        this_week: thisWeek,
        last_week: lastWeek,
        // null when there is nothing to compare against
        change_percent: lastWeek.minutes > 0 ? Math.round(((thisWeek.minutes - lastWeek.minutes) / lastWeek.minutes) * 100) : null,
        best_day: bestDay,
        top_task: topId ? { label: titles[topId] || '(deleted task)', minutes: round1(perTask[topId] / 60) } : null,
        longest_streak: longestStreak(Object.keys(per)),
      };
    }

    /**
     * Story points scored per local day (a task scores its points on the day it was completed):
     * today vs the daily target, the last 7 days, days-on-target streak and points still open.
     */
    function pointsSummary() {
      const today = now();
      const goal = getSettings().daily_points_goal;
      const perDayPoints = {};
      const todayKey = localDayKey(today);
      const todayTasks = [];
      let open = 0;
      rawTasks().forEach((t) => {
        const points = cleanPoints(t.points);
        if (!points) return;
        if (t.completed !== true) { open += points; return; }
        const at = Date.parse(t.completed_at);
        if (Number.isNaN(at)) return; // finished before points were tracked
        const key = localDayKey(new Date(at));
        perDayPoints[key] = (perDayPoints[key] || 0) + points;
        if (key === todayKey) todayTasks.push({ id: String(t.id), text: t.text, points, at });
      });
      const pointsOn = (d) => perDayPoints[localDayKey(d)] || 0;
      const daily = [];
      for (let i = 6; i >= 0; i--) {
        const d = addDays(today, -i);
        daily.push({ date: localDayKey(d), label: d.toLocaleDateString('en-US', { weekday: 'short' }), points: pointsOn(d) });
      }
      let lastWeek = 0;
      for (let i = 7; i <= 13; i++) lastWeek += pointsOn(addDays(today, -i));
      const onTarget = Object.keys(perDayPoints).filter((k) => perDayPoints[k] >= goal);
      return {
        today: pointsOn(today),
        goal,
        week_total: daily.reduce((acc, d) => acc + d.points, 0),
        last_week_total: lastWeek,
        streak: computeStreak(onTarget, today),
        open_points: open,
        daily_breakdown: daily,
        today_tasks: todayTasks.sort((a, b) => a.at - b.at).map(({ at, ...rest }) => rest),
      };
    }

    /** Full session history as CSV text (local timestamps, task title resolved). */
    function sessionsCsv() {
      const titles = {};
      rawTasks().forEach((t) => { titles[t.id] = t.text; });
      const lines = [['id', 'mode', 'duration_seconds', 'completed_at_local', 'task_id', 'task'].join(',')];
      rawSessions().forEach((s) => {
        const d = new Date(s.completed_at);
        const local = `${localDayKey(d)} ${d.toTimeString().slice(0, 8)}`;
        const row = [s.id, s.mode, s.duration_seconds, local, s.task_id ?? '', titles[s.task_id] ?? ''];
        lines.push(row.map(csvCell).join(','));
      });
      return lines.join('\n') + '\n';
    }

    return {
      getSettings, saveSettings, listTasks, addTask, updateTask, deleteTask, restoreTask, reorderTasks,
      logSession, summary, pointsSummary, taskStats, heatmap, dayDetail, weeklyReview, sessionsCsv, exportBackup, importBackup,
    };
  }

  return { createStore, KEYS, DEFAULT_SETTINGS, localDayKey, computeStreak, longestStreak, csvSafe, cleanSettings };
});
