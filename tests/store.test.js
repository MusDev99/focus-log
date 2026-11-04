// Unit tests for store.js — run with `node --test tests/*.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../store.js');

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    raw: data,
  };
}

/** Store with a controllable clock (local time). */
function makeStore(start = new Date(2026, 9, 28, 10, 0, 0)) {
  const clock = { t: start };
  const storage = memoryStorage();
  const store = S.createStore(storage, () => clock.t);
  return { store, storage, clock };
}

test('settings fall back to defaults and only keep valid values', () => {
  const { store } = makeStore();
  assert.deepEqual(store.getSettings(), S.DEFAULT_SETTINGS);
  const saved = store.saveSettings({ focus_duration: 50, short_break: 999, theme: 'neon', bogus: 1, auto_start: true });
  assert.equal(saved.focus_duration, 50);
  assert.equal(saved.short_break, 5);
  assert.equal(saved.theme, 'light');
  assert.equal(saved.auto_start, 1);
  assert.equal('bogus' in saved, false);
  assert.equal(store.getSettings().focus_duration, 50);
});

test('corrupt storage is ignored instead of crashing', () => {
  const { store, storage } = makeStore();
  storage.setItem(S.KEYS.tasks, '{not json');
  storage.setItem(S.KEYS.sessions, '"a string"');
  assert.deepEqual(store.listTasks(), []);
  assert.equal(store.summary().total_sessions, 0);
});

test('task CRUD trims text, clamps estimate and gives unique ids', () => {
  const { store } = makeStore();
  assert.equal(store.addTask('   '), null);
  const a = store.addTask('  Write report  ', 50);
  const b = store.addTask('x'.repeat(300), -3);
  assert.notEqual(a.id, b.id);
  assert.equal(a.text, 'Write report');
  assert.equal(a.estimate, 20);
  assert.equal(b.text.length, 200);
  assert.equal(b.estimate, 0);

  assert.equal(store.updateTask(a.id, { completed: true }), true);
  assert.equal(store.updateTask('missing', { completed: true }), false);
  assert.equal(store.listTasks()[0].completed, true);

  assert.equal(store.deleteTask(b.id), true);
  assert.equal(store.deleteTask(b.id), false);
  assert.deepEqual(store.listTasks().map((t) => t.id), [a.id]);
});

test('logSession validates input and counts focus sessions per task', () => {
  const { store } = makeStore();
  const t = store.addTask('Deep work', 3);
  assert.equal(store.logSession({ mode: 'nap' }), null);
  assert.equal(store.logSession({ duration_seconds: 0 }), null);
  store.logSession({ mode: 'focus', duration_seconds: 1500, task_id: t.id });
  store.logSession({ mode: 'focus', duration_seconds: 1500, task_id: t.id });
  store.logSession({ mode: 'shortBreak', duration_seconds: 300, task_id: t.id });
  assert.equal(store.listTasks()[0].actual, 2);
});

test('summary buckets by local day and computes the streak', () => {
  const { store, clock } = makeStore(new Date(2026, 9, 26, 9));
  store.logSession({ duration_seconds: 1500 });          // Mon
  clock.t = new Date(2026, 9, 27, 23, 30);
  store.logSession({ duration_seconds: 600 });           // Tue late evening
  clock.t = new Date(2026, 9, 28, 8);
  store.logSession({ duration_seconds: 1500 });          // Wed (today)
  store.logSession({ mode: 'longBreak', duration_seconds: 900 });

  const s = store.summary();
  assert.equal(s.today_sessions, 1);
  assert.equal(s.today_minutes, 25);
  assert.equal(s.streak, 3);
  assert.equal(s.total_sessions, 3);
  assert.equal(s.total_minutes, 60);
  assert.equal(s.daily_breakdown.length, 7);
  assert.equal(s.daily_breakdown[6].date, '2026-10-28');
  assert.equal(s.daily_breakdown[5].minutes, 10);
});

test('computeStreak counts from yesterday when today is empty, and stops at gaps', () => {
  const today = new Date(2026, 9, 28);
  assert.equal(S.computeStreak(['2026-10-27', '2026-10-26', '2026-10-24'], today), 2);
  assert.equal(S.computeStreak(['2026-10-25'], today), 0);
  assert.equal(S.computeStreak([], today), 0);
});

test('taskStats groups by task, labels missing tasks, sorts by minutes', () => {
  const { store } = makeStore();
  const a = store.addTask('A');
  const b = store.addTask('B');
  store.logSession({ duration_seconds: 600, task_id: a.id });
  store.logSession({ duration_seconds: 1800, task_id: b.id });
  store.logSession({ duration_seconds: 300 });
  store.deleteTask(a.id);
  const rows = store.taskStats();
  assert.deepEqual(rows.map((r) => r.label), ['B', '(deleted task)', 'No task']);
  assert.equal(rows[0].minutes, 30);
});

test('heatmap is zero-filled, oldest first, ending today', () => {
  const { store } = makeStore();
  store.logSession({ duration_seconds: 1200 });
  const days = store.heatmap(14);
  assert.equal(days.length, 14);
  assert.equal(days[13].date, '2026-10-28');
  assert.equal(days[13].minutes, 20);
  assert.equal(days[0].date, '2026-10-15');
  assert.equal(days[0].minutes, 0);
});

test('sessionsCsv escapes quotes/commas and neutralises formulas', () => {
  const { store } = makeStore();
  const t = store.addTask('=HYPERLINK("x"), evil');
  store.logSession({ duration_seconds: 1500, task_id: t.id });
  const lines = store.sessionsCsv().trim().split('\n');
  assert.equal(lines[0], 'id,mode,duration_seconds,completed_at_local,task_id,task');
  assert.match(lines[1], /,focus,1500,2026-10-28 10:00:00,/);
  assert.ok(lines[1].endsWith(`"'=HYPERLINK(""x""), evil"`));
});

test('data persists across store instances on the same storage', () => {
  const { store, storage } = makeStore();
  store.addTask('Keep me');
  const again = S.createStore(storage);
  assert.equal(again.listTasks()[0].text, 'Keep me');
});

test('reorderTasks follows the given ids and keeps unlisted tasks at the end', () => {
  const { store } = makeStore();
  const a = store.addTask('A');
  const b = store.addTask('B');
  const c = store.addTask('C');
  store.reorderTasks([c.id, 'nope', a.id, c.id]);
  assert.deepEqual(store.listTasks().map((t) => t.text), ['C', 'A', 'B']);
  assert.equal(b.text, 'B');
});

test('backup round-trips into an empty browser', () => {
  const { store } = makeStore();
  const t = store.addTask('Ship it', 2);
  store.logSession({ duration_seconds: 1500, task_id: t.id });
  store.saveSettings({ focus_duration: 45, theme: 'dark' });
  const backup = JSON.parse(JSON.stringify(store.exportBackup()));

  const other = makeStore().store;
  assert.deepEqual(other.importBackup(backup), { tasks: 1, sessions: 1 });
  assert.equal(other.listTasks()[0].text, 'Ship it');
  assert.equal(other.listTasks()[0].actual, 1);
  assert.equal(other.getSettings().focus_duration, 45);
  assert.equal(other.getSettings().theme, 'dark');
});

test('importing merges by id: re-importing adds nothing, other devices data is kept', () => {
  const { store, clock } = makeStore();
  store.addTask('Laptop task');
  const backup = store.exportBackup();
  assert.deepEqual(store.importBackup(backup), { tasks: 0, sessions: 0 });

  clock.t = new Date(2026, 9, 28, 11);
  const phone = makeStore(new Date(2026, 9, 28, 12)).store;
  phone.addTask('Phone task');
  phone.importBackup(backup);
  assert.deepEqual(phone.listTasks().map((t) => t.text).sort(), ['Laptop task', 'Phone task']);
});

test('importBackup rejects other files and skips invalid rows', () => {
  const { store } = makeStore();
  assert.throws(() => store.importBackup({ hello: 1 }), /not a Pomodoro backup/);
  assert.throws(() => store.importBackup(null), /not a Pomodoro backup/);
  const base = store.exportBackup();
  assert.throws(() => store.importBackup({ ...base, version: 99 }), /newer version/);

  const result = store.importBackup({
    ...base,
    tasks: [{ id: 'ok', text: '  Valid  ', estimate: 99 }, { id: 'bad', text: '' }, 'junk', { text: 'no id' }],
    sessions: [
      { id: 's1', mode: 'focus', duration_seconds: 1500, completed_at: '2026-10-27T10:00:00Z', task_id: 'ok' },
      { id: 's2', mode: 'nap', duration_seconds: 600, completed_at: '2026-10-27T10:00:00Z' },
      { id: 's3', mode: 'focus', duration_seconds: -5, completed_at: '2026-10-27T10:00:00Z' },
      { id: 's4', mode: 'focus', duration_seconds: 600, completed_at: 'not a date' },
    ],
    settings: { focus_duration: 500 },
  });
  assert.deepEqual(result, { tasks: 1, sessions: 1 });
  const [task] = store.listTasks();
  assert.equal(task.text, 'Valid');
  assert.equal(task.estimate, 20);
  assert.equal(task.actual, 1);
  assert.equal(store.getSettings().focus_duration, 25);
});

test('weeklyReview compares the last 7 days with the 7 before', () => {
  const { store, clock } = makeStore(new Date(2026, 9, 16, 9));   // 12 days ago: previous week
  store.logSession({ duration_seconds: 1800 });
  const t = store.addTask('Thesis');
  clock.t = new Date(2026, 9, 24, 9);                              // Saturday, this week
  store.logSession({ duration_seconds: 1500, task_id: t.id });
  store.logSession({ duration_seconds: 1500, task_id: t.id });
  clock.t = new Date(2026, 9, 28, 9);                              // today
  store.logSession({ duration_seconds: 1500 });

  const r = store.weeklyReview();
  assert.deepEqual(r.this_week, { minutes: 75, sessions: 3 });
  assert.deepEqual(r.last_week, { minutes: 30, sessions: 1 });
  assert.equal(r.change_percent, 150);
  assert.equal(r.best_day.date, '2026-10-24');
  assert.equal(r.best_day.minutes, 50);
  assert.deepEqual(r.top_task, { label: 'Thesis', minutes: 50 });
  assert.equal(r.longest_streak, 1);
});

test('weeklyReview with no history has nothing to compare', () => {
  const r = makeStore().store.weeklyReview();
  assert.equal(r.change_percent, null);
  assert.equal(r.best_day, null);
  assert.equal(r.top_task, null);
  assert.equal(r.longest_streak, 0);
});

test('longestStreak finds the longest consecutive run, across month ends', () => {
  assert.equal(S.longestStreak(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-03']), 3);
  assert.equal(S.longestStreak(['2026-01-05', '2026-01-05']), 1);
  assert.equal(S.longestStreak([]), 0);
});

test('restoreTask puts a deleted task back in its old place, once', () => {
  const { store } = makeStore();
  const a = store.addTask('A');
  const b = store.addTask('B', 3);
  store.addTask('C');
  const removed = store.listTasks()[1];
  store.deleteTask(b.id);
  assert.equal(store.restoreTask(removed, 1), true);
  assert.deepEqual(store.listTasks().map((t) => t.text), ['A', 'B', 'C']);
  assert.equal(store.listTasks()[1].estimate, 3);
  assert.equal(store.restoreTask(removed, 0), false, 'duplicate id is ignored');
  assert.equal(store.restoreTask({ id: a.id + 'x', text: '  ' }), false, 'invalid task is ignored');
  assert.equal(store.listTasks().length, 3);
});

test('dayDetail totals one local day and splits it by task', () => {
  const { store, clock } = makeStore(new Date(2026, 9, 27, 23, 30));
  const t = store.addTask('Thesis');
  store.logSession({ duration_seconds: 1500, task_id: t.id });     // 27th, late evening
  clock.t = new Date(2026, 9, 28, 0, 10);
  store.logSession({ duration_seconds: 1500, task_id: t.id });     // 28th, just after midnight
  store.logSession({ duration_seconds: 3000, task_id: t.id });
  store.logSession({ duration_seconds: 600 });
  store.logSession({ mode: 'shortBreak', duration_seconds: 300 });  // breaks don't count

  const d = store.dayDetail('2026-10-28');
  assert.equal(d.minutes, 85);
  assert.equal(d.sessions, 3);
  assert.deepEqual(d.tasks, [
    { label: 'Thesis', sessions: 2, minutes: 75 },
    { label: 'No task', sessions: 1, minutes: 10 },
  ]);
  assert.deepEqual(store.dayDetail('2026-10-01'), { date: '2026-10-01', minutes: 0, sessions: 0, tasks: [] });
});

test('tasks carry an Eisenhower quadrant (1-4) or null when unsorted', () => {
  const { store } = makeStore();
  const a = store.addTask('Pay rent', 0, 1);
  const b = store.addTask('Plan the week');
  store.addTask('Bad quadrant', 0, 7);
  assert.deepEqual(store.listTasks().map((t) => t.quadrant), [1, null, null]);

  assert.equal(store.updateTask(b.id, { quadrant: 2 }), true);
  assert.equal(store.listTasks()[1].quadrant, 2);
  store.updateTask(b.id, { quadrant: 9 });
  assert.equal(store.listTasks()[1].quadrant, null, 'invalid quadrant means unsorted');
  store.updateTask(a.id, { completed: true });
  assert.equal(store.listTasks()[0].quadrant, 1, 'other updates keep the quadrant');
  store.updateTask(a.id, { quadrant: null });
  assert.equal(store.listTasks()[0].quadrant, null);
});

test('quadrants survive backup and old tasks without one read as unsorted', () => {
  const { store, storage } = makeStore();
  storage.setItem(S.KEYS.tasks, JSON.stringify([{ id: 'old', text: 'Legacy', completed: false, estimate: 0, created_at: '2026-01-01T00:00:00Z' }]));
  assert.equal(store.listTasks()[0].quadrant, null);

  store.addTask('Exercise', 0, 2);
  const backup = store.exportBackup();
  const other = makeStore().store;
  other.importBackup(backup);
  assert.deepEqual(other.listTasks().map((t) => [t.text, t.quadrant]), [['Legacy', null], ['Exercise', 2]]);
});

test('tasks carry optional story points, clamped to 0-100', () => {
  const { store } = makeStore();
  const a = store.addTask('Ship login', 2, null, 5);
  store.addTask('No points');
  store.addTask('Too big', 0, null, 500);
  assert.deepEqual(store.listTasks().map((t) => t.points), [5, 0, 100]);
  store.updateTask(a.id, { points: 8 });
  assert.equal(store.listTasks()[0].points, 8);
  store.updateTask(a.id, { text: 'Ship login page' });
  assert.equal(store.listTasks()[0].points, 8, 'other updates keep the points');
});

test('completing a task stamps completed_at; reopening clears it', () => {
  const { store, clock } = makeStore();
  const a = store.addTask('Write tests', 0, null, 3);
  assert.equal(store.listTasks()[0].completed_at, null);
  store.updateTask(a.id, { completed: true });
  const stamp = store.listTasks()[0].completed_at;
  assert.equal(stamp, clock.t.toISOString());
  clock.t = new Date(2026, 9, 29, 9, 0, 0);
  store.updateTask(a.id, { completed: true });
  assert.equal(store.listTasks()[0].completed_at, stamp, 'completing again keeps the first time');
  store.updateTask(a.id, { completed: false });
  assert.equal(store.listTasks()[0].completed_at, null);
});

test('pointsSummary scores points on the day a task was completed', () => {
  const { store, clock, storage } = makeStore(new Date(2026, 9, 26, 10, 0, 0));
  store.saveSettings({ daily_points_goal: 5 });
  const done = (text, points) => store.updateTask(store.addTask(text, 0, null, points).id, { completed: true });
  done('Mon task', 5); // Oct 26: on target
  clock.t = new Date(2026, 9, 27, 10, 0, 0);
  done('Tue a', 3);
  done('Tue b', 2); // Oct 27: on target
  clock.t = new Date(2026, 9, 28, 9, 0, 0);
  done('Wed a', 2);
  clock.t = new Date(2026, 9, 28, 11, 0, 0);
  done('Wed b', 1);
  store.addTask('Open', 0, null, 8);
  store.addTask('Open, unscored');
  // a task completed before points were tracked has no completed_at
  const legacy = JSON.parse(storage.getItem(S.KEYS.tasks)).concat({ id: 'x', text: 'Legacy', completed: true, points: 13 });
  storage.setItem(S.KEYS.tasks, JSON.stringify(legacy));

  const p = store.pointsSummary();
  assert.equal(p.today, 3);
  assert.equal(p.goal, 5);
  assert.equal(p.week_total, 13);
  assert.equal(p.open_points, 8);
  assert.equal(p.streak, 2, 'today is not on target yet, so the streak runs to yesterday');
  assert.deepEqual(p.today_tasks.map((t) => [t.text, t.points]), [['Wed a', 2], ['Wed b', 1]]);
  assert.equal(p.daily_breakdown.length, 7);
  assert.deepEqual(p.daily_breakdown.slice(-3).map((d) => d.points), [5, 5, 3]);
});

test('points and completion time survive backup and undo', () => {
  const { store } = makeStore();
  const a = store.addTask('Review PR', 0, 1, 3);
  store.updateTask(a.id, { completed: true });
  const task = store.listTasks()[0];
  const other = makeStore().store;
  other.importBackup(store.exportBackup());
  assert.equal(other.listTasks()[0].points, 3);
  assert.equal(other.listTasks()[0].completed_at, task.completed_at);
  assert.equal(other.pointsSummary().today, 3);

  store.deleteTask(a.id);
  store.restoreTask(task, 0);
  assert.equal(store.pointsSummary().today, 3);
});

test('daily points target is a setting between 1 and 500', () => {
  const { store } = makeStore();
  assert.equal(store.getSettings().daily_points_goal, 10);
  assert.equal(store.saveSettings({ daily_points_goal: 21 }).daily_points_goal, 21);
  assert.equal(store.saveSettings({ daily_points_goal: 0 }).daily_points_goal, 21);
  assert.equal(store.saveSettings({ daily_points_goal: 501 }).daily_points_goal, 21);
});

test('each task has its own clock: starting one pauses the other and each resumes where it stopped', () => {
  const { store, clock } = makeStore();
  const a = store.addTask('Task A');
  const b = store.addTask('Task B');
  const at = (s) => { clock.t = new Date(clock.t.getTime() + s * 1000); };

  assert.equal(store.startTaskClock(a.id), true);
  at(30);
  assert.equal(store.taskElapsedMs(a.id), 30000);
  assert.equal(store.runningTaskId(), a.id);

  store.startTaskClock(b.id); // A pauses at 0:30
  assert.equal(store.runningTaskId(), b.id);
  at(30);
  assert.equal(store.taskElapsedMs(a.id), 30000, 'A stays paused');
  assert.equal(store.taskElapsedMs(b.id), 30000, 'B counted from zero');

  store.startTaskClock(a.id); // resumes from 0:30
  at(15);
  assert.equal(store.taskElapsedMs(a.id), 45000);
  assert.equal(store.taskElapsedMs(b.id), 30000);
  assert.deepEqual(store.listTasks().map((t) => [t.running, t.elapsed_ms]), [[true, 45000], [false, 30000]]);

  assert.equal(store.pauseTaskClock(), a.id);
  at(60);
  assert.equal(store.taskElapsedMs(a.id), 45000, 'paused clocks do not move');
  assert.equal(store.runningTaskId(), null);
  assert.equal(store.pauseTaskClock(), null);
});

test('completing a task stops its clock and keeps the total; completed tasks cannot restart', () => {
  const { store, clock } = makeStore();
  const a = store.addTask('Task A');
  store.startTaskClock(a.id);
  clock.t = new Date(clock.t.getTime() + 90 * 1000);
  store.updateTask(a.id, { completed: true });
  assert.equal(store.runningTaskId(), null);
  clock.t = new Date(clock.t.getTime() + 600 * 1000);
  assert.equal(store.listTasks()[0].elapsed_ms, 90000, 'total is final once completed');
  assert.equal(store.startTaskClock(a.id), false);
  store.updateTask(a.id, { completed: false });
  assert.equal(store.listTasks()[0].elapsed_ms, 90000, 'reopening keeps the time');
  assert.equal(store.startTaskClock(a.id), true);
  assert.equal(store.startTaskClock('missing'), false);
});

test('deleting the running task stops the clock; time survives undo and backup, the running state does not', () => {
  const { store, clock } = makeStore();
  const a = store.addTask('Task A');
  store.startTaskClock(a.id);
  clock.t = new Date(clock.t.getTime() + 20 * 1000);
  const removed = store.listTasks()[0];
  assert.equal(removed.elapsed_ms, 20000);
  store.deleteTask(a.id);
  assert.equal(store.runningTaskId(), null);
  store.restoreTask(removed, 0);
  assert.equal(store.taskElapsedMs(a.id), 20000);
  assert.equal(store.runningTaskId(), null);

  const other = makeStore().store;
  other.importBackup(store.exportBackup());
  assert.equal(other.listTasks()[0].elapsed_ms, 20000);
  assert.equal(other.runningTaskId(), null);
});

test('work and break stretches are logged as sessions when they end, and today totals add up live', () => {
  const { store, clock } = makeStore();
  const at = (s) => { clock.t = new Date(clock.t.getTime() + s * 1000); };
  assert.deepEqual(store.getWorkState(), { mode: 'idle', since: null, task_id: null });
  assert.deepEqual(store.todayTotals(), { mode: 'idle', task_id: null, stretch_ms: 0, work_ms: 0, break_ms: 0 });

  const a = store.addTask('Task A');
  store.setWorkMode('work', a.id);
  at(600);
  assert.equal(store.todayTotals().work_ms, 600000, 'the running stretch counts');
  assert.equal(store.todayTotals().stretch_ms, 600000);

  const work = store.setWorkMode('break'); // take a break: the work stretch is logged
  assert.deepEqual([work.mode, work.duration_seconds, work.task_id], ['focus', 600, a.id]);
  at(120);
  assert.deepEqual([store.todayTotals().work_ms, store.todayTotals().break_ms], [600000, 120000]);

  const rest = store.setWorkMode('work'); // back to work: the break is logged, work total keeps growing
  assert.deepEqual([rest.mode, rest.duration_seconds, rest.task_id], ['shortBreak', 120, null]);
  at(300);
  assert.equal(store.todayTotals().work_ms, 900000);
  assert.equal(store.todayTotals().break_ms, 120000);

  store.setWorkMode('idle');
  assert.equal(store.getWorkState().mode, 'idle');
  assert.equal(store.todayTotals().work_ms, 900000);
  assert.equal(store.summary().today_minutes, 15, 'stats see the work time');
  assert.equal(store.setWorkMode('nap'), null);
});

test('switching task while working splits the stretch per task; sub-second stretches are dropped', () => {
  const { store, clock } = makeStore();
  const at = (s) => { clock.t = new Date(clock.t.getTime() + s * 1000); };
  const a = store.addTask('Task A');
  const b = store.addTask('Task B');
  store.setWorkMode('work', a.id);
  at(90);
  store.setWorkMode('work', b.id);
  at(30);
  store.setWorkMode('work', null);
  store.setWorkMode('idle'); // under a second: not logged
  assert.deepEqual(store.taskStats().map((r) => [r.label, r.minutes]), [['Task A', 1.5], ['Task B', 0.5]]);
  assert.equal(store.todayTotals().work_ms, 120000);
});

test('a task counts one pomodoro for every 25 minutes of work logged on it', () => {
  const { store } = makeStore();
  const a = store.addTask('Deep work', 3);
  store.logSession({ task_id: a.id, duration_seconds: 24 * 60 });
  assert.equal(store.listTasks()[0].actual, 0);
  store.logSession({ task_id: a.id, duration_seconds: 27 * 60 });
  assert.equal(store.listTasks()[0].actual, 2);
});

test('cat sounds are a setting that defaults to on', () => {
  const { store } = makeStore();
  assert.equal(store.getSettings().cat_sound, 1);
  assert.equal(store.saveSettings({ cat_sound: 0 }).cat_sound, 0);
  assert.equal(store.saveSettings({ cat_sound: 5 }).cat_sound, 0, 'invalid values are ignored');
});

test('character is a setting: cat by default, dog / cow / pig accepted, anything else ignored', () => {
  const { store } = makeStore();
  assert.equal(store.getSettings().character, 'cat');
  ['dog', 'cow', 'pig', 'cat'].forEach((c) => assert.equal(store.saveSettings({ character: c }).character, c));
  assert.equal(store.saveSettings({ character: 'dragon' }).character, 'cat', 'invalid values are ignored');
});
