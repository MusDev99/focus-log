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

test('task CRUD trims text and gives unique ids', () => {
  const { store } = makeStore();
  assert.equal(store.addTask('   '), null);
  const a = store.addTask('  Write report  ');
  const b = store.addTask('x'.repeat(300));
  assert.notEqual(a.id, b.id);
  assert.equal(a.text, 'Write report');
  assert.equal(b.text.length, 200);
  assert.equal('estimate' in a, false, 'the old pomodoro estimate no longer exists');

  assert.equal(store.updateTask(a.id, { completed: true }), true);
  assert.equal(store.updateTask('missing', { completed: true }), false);
  assert.equal(store.listTasks()[0].completed, true);

  assert.equal(store.deleteTask(b.id), true);
  assert.equal(store.deleteTask(b.id), false);
  assert.deepEqual(store.listTasks().map((t) => t.id), [a.id]);
});

test('logSession validates input and counts focus sessions', () => {
  const { store } = makeStore();
  const t = store.addTask('Deep work');
  assert.equal(store.logSession({ mode: 'nap' }), null);
  assert.equal(store.logSession({ duration_seconds: 0 }), null);
  store.logSession({ mode: 'focus', duration_seconds: 1500, task_id: t.id });
  store.logSession({ mode: 'focus', duration_seconds: 1500, task_id: t.id });
  store.logSession({ mode: 'shortBreak', duration_seconds: 300, task_id: t.id });
  assert.equal(store.summary().total_sessions, 2, 'two focus sessions; the break is not counted');
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
  const t = store.addTask('Ship it');
  store.logSession({ duration_seconds: 1500, task_id: t.id });
  store.saveSettings({ focus_duration: 45, theme: 'dark' });
  const backup = JSON.parse(JSON.stringify(store.exportBackup()));

  const other = makeStore().store;
  assert.deepEqual(other.importBackup(backup), { tasks: 1, sessions: 1 });
  assert.equal(other.listTasks()[0].text, 'Ship it');
  assert.equal(other.summary().total_sessions, 1);
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
  assert.throws(() => store.importBackup({ hello: 1 }), /not a Focus Log backup/);
  assert.throws(() => store.importBackup(null), /not a Focus Log backup/);
  const base = store.exportBackup();
  assert.throws(() => store.importBackup({ ...base, version: 99 }), /newer version/);

  const result = store.importBackup({
    ...base,
    tasks: [{ id: 'ok', text: '  Valid  ', estimate: 99 },  { id: 'bad', text: '' }, 'junk', { text: 'no id' }],
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
  assert.equal('estimate' in task, false, 'an estimate in an old backup is dropped');
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
  const b = store.addTask('B', null, 3);
  store.addTask('C');
  const removed = store.listTasks()[1];
  store.deleteTask(b.id);
  assert.equal(store.restoreTask(removed, 1), true);
  assert.deepEqual(store.listTasks().map((t) => t.text), ['A', 'B', 'C']);
  assert.equal(store.listTasks()[1].points, 3);
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
  const a = store.addTask('Pay rent', 1);
  const b = store.addTask('Plan the week');
  store.addTask('Bad quadrant', 7);
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

  store.addTask('Exercise', 2);
  const backup = store.exportBackup();
  const other = makeStore().store;
  other.importBackup(backup);
  assert.deepEqual(other.listTasks().map((t) => [t.text, t.quadrant]), [['Legacy', null], ['Exercise', 2]]);
});

test('tasks carry optional story points, clamped to 0-100', () => {
  const { store } = makeStore();
  const a = store.addTask('Ship login', null, 5);
  store.addTask('No points');
  store.addTask('Too big', null, 500);
  assert.deepEqual(store.listTasks().map((t) => t.points), [5, 0, 100]);
  store.updateTask(a.id, { points: 8 });
  assert.equal(store.listTasks()[0].points, 8);
  store.updateTask(a.id, { text: 'Ship login page' });
  assert.equal(store.listTasks()[0].points, 8, 'other updates keep the points');
});

test('completing a task stamps completed_at; reopening clears it', () => {
  const { store, clock } = makeStore();
  const a = store.addTask('Write tests', null, 3);
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
  const done = (text, points) => store.updateTask(store.addTask(text, null, points).id, { completed: true });
  done('Mon task', 5); // Oct 26: on target
  clock.t = new Date(2026, 9, 27, 10, 0, 0);
  done('Tue a', 3);
  done('Tue b', 2); // Oct 27: on target
  clock.t = new Date(2026, 9, 28, 9, 0, 0);
  done('Wed a', 2);
  clock.t = new Date(2026, 9, 28, 11, 0, 0);
  done('Wed b', 1);
  store.addTask('Open', null, 8);
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
  const a = store.addTask('Review PR', 1, 3);
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

test('a work stretch crossing midnight is split across both days', () => {
  const { store, clock } = makeStore(new Date(2026, 9, 28, 23, 30, 0));
  store.setWorkMode('work');
  clock.t = new Date(2026, 9, 29, 0, 20, 0); // 30 min before midnight + 20 min after
  const t = store.todayTotals();
  assert.equal(t.stretch_ms, 50 * 60000, 'the stretch itself is continuous');
  assert.equal(t.work_ms, 20 * 60000, 'only the part after midnight counts for the new day');
  store.setWorkMode('idle');
  const days = store.summary().daily_breakdown;
  assert.deepEqual(days.slice(-2).map((d) => [d.date, d.minutes]), [['2026-10-28', 30], ['2026-10-29', 20]]);
  assert.equal(store.todayTotals().work_ms, 20 * 60000);
});

test('a stretch spanning several midnights logs one session per day', () => {
  const { store, clock } = makeStore(new Date(2026, 9, 27, 23, 0, 0));
  store.setWorkMode('break');
  clock.t = new Date(2026, 9, 29, 1, 0, 0);
  store.setWorkMode('idle');
  assert.deepEqual(store.todayTotals(), { mode: 'idle', task_id: null, stretch_ms: 0, work_ms: 0, break_ms: 3600000 });
});

test('resetToday zeroes today but keeps earlier days, and restarts a running stretch', () => {
  const { store, clock } = makeStore();
  store.logSession({ duration_seconds: 1800, ended_at: new Date(2026, 9, 27, 12, 0, 0) });
  store.setWorkMode('work');
  clock.t = new Date(clock.t.getTime() + 600000);
  store.setWorkMode('break');
  clock.t = new Date(clock.t.getTime() + 120000);
  assert.deepEqual([store.todayTotals().work_ms, store.todayTotals().break_ms], [600000, 120000]);

  assert.equal(store.resetToday(), 1, 'the logged work session is removed');
  const t = store.todayTotals();
  assert.deepEqual([t.work_ms, t.break_ms, t.stretch_ms, t.mode], [0, 0, 0, 'break']);
  assert.equal(store.summary().total_minutes, 30, 'yesterday survives');
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

// ---- the rename: data saved by the old Pomodoro app is carried over, once, and never lost

const OLD = {
  tasks: JSON.stringify([{ id: 't1', text: 'Old task', completed: false, estimate: 3, points: 2, created_at: '2026-10-01T00:00:00.000Z' }]),
  sessions: JSON.stringify([{ id: 's1', mode: 'focus', duration_seconds: 1500, completed_at: '2026-10-02T10:00:00.000Z', task_id: 't1' }]),
  settings: JSON.stringify({ focus_duration: 45, theme: 'dark' }),
};

function oldStorage() {
  const storage = memoryStorage();
  storage.setItem('pomodoro-tasks', OLD.tasks);
  storage.setItem('pomodoro-sessions', OLD.sessions);
  storage.setItem('pomodoro-settings', OLD.settings);
  storage.setItem('pomodoro-theme', 'dark');
  storage.setItem('pomodoro-active-task', 't1');
  storage.setItem('pomodoro-view', 'tasks');
  return storage;
}

test('first run after the rename carries the old pomodoro-* data over to the new keys', () => {
  const storage = oldStorage();
  const store = S.createStore(storage);
  assert.deepEqual(store.listTasks().map((t) => t.text), ['Old task']);
  assert.equal(store.listTasks()[0].points, 2);
  assert.equal(store.summary().total_sessions, 1);
  assert.equal(store.getSettings().focus_duration, 45);
  assert.equal(store.getSettings().theme, 'dark');
  // the small UI preferences (raw strings, not JSON) come across too
  assert.equal(storage.getItem(S.UI_KEYS.theme), 'dark');
  assert.equal(storage.getItem(S.UI_KEYS.activeTask), 't1');
  assert.equal(storage.getItem(S.UI_KEYS.view), 'tasks');
});

test('the old keys are left untouched as a backup', () => {
  const storage = oldStorage();
  S.createStore(storage);
  assert.equal(storage.getItem('pomodoro-tasks'), OLD.tasks);
  assert.equal(storage.getItem('pomodoro-sessions'), OLD.sessions);
  assert.equal(storage.getItem('pomodoro-settings'), OLD.settings);
  assert.equal(storage.getItem('pomodoro-theme'), 'dark');
});

test('the migration runs once: deleting data afterwards does not bring the old copy back', () => {
  const storage = oldStorage();
  const first = S.createStore(storage);
  first.listTasks().forEach((t) => first.deleteTask(t.id));
  assert.deepEqual(S.createStore(storage).listTasks(), []);
  assert.equal(S.migrateLegacyKeys(storage), 0);
});

test('the migration never overwrites data already saved under the new names', () => {
  const storage = oldStorage();
  storage.setItem(S.KEYS.tasks, JSON.stringify([{ id: 'new', text: 'New task', completed: false, created_at: '2026-10-05T00:00:00.000Z' }]));
  const store = S.createStore(storage);
  assert.deepEqual(store.listTasks().map((t) => t.text), ['New task'], 'the new data wins');
  assert.equal(store.summary().total_sessions, 1, 'keys that were still empty are filled');
});

test('a fresh install has nothing to migrate and writes nothing extra', () => {
  const storage = memoryStorage();
  S.createStore(storage);
  assert.equal(storage.raw.size, 0);
});

test('a storage that throws never breaks the migration', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(S.migrateLegacyKeys(broken), 0);
  assert.doesNotThrow(() => S.createStore(broken));
});

test('the old pomodoro estimate is dropped on read, in lists and in exports', () => {
  const store = S.createStore(oldStorage());
  assert.equal('estimate' in store.listTasks()[0], false);
  assert.equal('estimate' in store.exportBackup().tasks[0], false);
  assert.equal(store.listTasks()[0].text, 'Old task', 'the rest of the task is intact');
});

test('backups carry the new app id, and backups made before the rename still import', () => {
  const { store } = makeStore();
  store.addTask('Mine');
  assert.equal(store.exportBackup().app, 'focus-log');

  const legacy = { app: 'pomodoro-focus-dashboard', version: 1, tasks: [{ id: 'x1', text: 'From the old app', estimate: 4 }], sessions: [], settings: {} };
  const other = makeStore().store;
  assert.deepEqual(other.importBackup(legacy), { tasks: 1, sessions: 0 });
  assert.equal(other.listTasks()[0].text, 'From the old app');
  assert.throws(() => other.importBackup({ ...legacy, app: 'something-else' }), /not a Focus Log backup/);
});

test('listFocusSessions gives plain focus sessions and skips corrupt entries', () => {
  const { store, storage } = makeStore();
  const t = store.addTask('Deep work');
  store.logSession({ mode: 'focus', duration_seconds: 600, task_id: t.id });
  store.logSession({ mode: 'shortBreak', duration_seconds: 300, task_id: t.id });
  const raw = JSON.parse(storage.getItem(S.KEYS.sessions));
  raw.push({ id: 'bad', mode: 'focus', duration_seconds: 'x', completed_at: 'nope' }, null);
  storage.setItem(S.KEYS.sessions, JSON.stringify(raw));
  const list = store.listFocusSessions();
  assert.equal(list.length, 1, 'the break and the corrupt entries are left out');
  assert.deepEqual(Object.keys(list[0]).sort(), ['completed_at', 'duration_seconds', 'mode', 'task_id']);
  assert.equal(list[0].task_id, t.id);
});

test('a stored task or session that is not an object is skipped, not a crash', () => {
  const { store, storage } = makeStore();
  const t = store.addTask('Real task');
  store.logSession({ mode: 'focus', duration_seconds: 600, task_id: t.id });
  storage.setItem(S.KEYS.tasks, JSON.stringify([...JSON.parse(storage.getItem(S.KEYS.tasks)), null, 'junk', 7]));
  storage.setItem(S.KEYS.sessions, JSON.stringify([...JSON.parse(storage.getItem(S.KEYS.sessions)), null, 'junk', 7]));
  assert.deepEqual(store.listTasks().map((x) => x.text), ['Real task']);
  assert.equal(store.summary().total_sessions, 1);
  assert.equal(store.taskStats().length, 1);
  assert.equal(store.exportBackup().tasks.length, 1);
  assert.equal(store.exportBackup().sessions.length, 1);
});

// ---- the Jira site (bare issue keys link to it) ----

test('the Jira site: none by default, saved as a plain https origin, anything else saves as none', () => {
  const { store } = makeStore();
  assert.equal(store.getJiraBase(), '');
  assert.equal(store.saveJiraBase('https://airasia.atlassian.net'), 'https://airasia.atlassian.net');
  assert.equal(store.getJiraBase(), 'https://airasia.atlassian.net');
  assert.equal(store.saveJiraBase('https://jira.example.com:8443'), 'https://jira.example.com:8443');
  for (const bad of ['http://airasia.atlassian.net', 'javascript:alert(1)', 'airasia.atlassian.net', 'https://airasia.atlassian.net/browse', 'https://user:pw@x.example.com', 'https://localhost', 42, null, 'https://' + 'a'.repeat(200) + '.com']) {
    store.saveJiraBase('https://airasia.atlassian.net');
    assert.equal(store.saveJiraBase(bad), '', String(bad));
    assert.equal(store.getJiraBase(), '', `${String(bad)} cleared it`);
  }
});

test('a hand-edited unsafe Jira value in storage reads as none, and corrupt JSON never crashes', () => {
  const { store, storage } = makeStore();
  storage.setItem(S.KEYS.jira, JSON.stringify('javascript:alert(1)'));
  assert.equal(store.getJiraBase(), '');
  storage.setItem(S.KEYS.jira, '{not json');
  assert.equal(store.getJiraBase(), '');
  storage.setItem(S.KEYS.jira, JSON.stringify({ evil: true }));
  assert.equal(store.getJiraBase(), '');
});

test('the Jira site travels in a backup; an older backup, or an unsafe value in a file, leaves it alone', () => {
  const { store } = makeStore();
  store.saveJiraBase('https://airasia.atlassian.net');
  const backup = JSON.parse(JSON.stringify(store.exportBackup()));
  assert.equal(backup.jira_base, 'https://airasia.atlassian.net');

  const other = makeStore().store;
  other.importBackup(backup);
  assert.equal(other.getJiraBase(), 'https://airasia.atlassian.net');

  const keeps = makeStore().store;
  keeps.saveJiraBase('https://mine.atlassian.net');
  const { jira_base, ...oldBackup } = backup; // a backup made before this existed
  keeps.importBackup(oldBackup);
  assert.equal(keeps.getJiraBase(), 'https://mine.atlassian.net', 'an old backup does not clear it');
  keeps.importBackup({ ...backup, jira_base: 'javascript:alert(1)' });
  assert.equal(keeps.getJiraBase(), 'https://mine.atlassian.net', 'an unsafe value in a file is ignored');
});
