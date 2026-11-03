// Unit tests for timer-core.js — run with `node --test tests/*.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timer-core.js');

const config = { focus_duration: 25, short_break: 5, long_break: 15, long_break_interval: 4 };

test('modeDuration converts minutes to seconds per mode', () => {
  assert.equal(T.modeDuration('focus', config), 1500);
  assert.equal(T.modeDuration('shortBreak', config), 300);
  assert.equal(T.modeDuration('longBreak', config), 900);
});

test('remainingSeconds is wall-clock based and never negative', () => {
  assert.equal(T.remainingSeconds(10_000, 0), 10);
  assert.equal(T.remainingSeconds(10_000, 9_001), 1);   // rounds up partial seconds
  assert.equal(T.remainingSeconds(10_000, 10_000), 0);
  assert.equal(T.remainingSeconds(10_000, 99_999), 0);
});

test('a throttled timer catches up after a long gap (no drift)', () => {
  const start = 1_000_000;
  const endsAt = start + 1500 * 1000;
  // browser froze timers for 10 minutes, one tick fires
  assert.equal(T.remainingSeconds(endsAt, start + 600_000), 900);
});

test('nextMode: short breaks, long break every N focus cycles, break -> focus', () => {
  assert.equal(T.nextMode('focus', 1, 4), 'shortBreak');
  assert.equal(T.nextMode('focus', 3, 4), 'shortBreak');
  assert.equal(T.nextMode('focus', 4, 4), 'longBreak');
  assert.equal(T.nextMode('focus', 8, 4), 'longBreak');
  assert.equal(T.nextMode('focus', 1, 1), 'longBreak');
  assert.equal(T.nextMode('shortBreak', 1, 4), 'focus');
  assert.equal(T.nextMode('longBreak', 4, 4), 'focus');
});

test('snapshot/restore roundtrip for a paused timer', () => {
  const snap = T.snapshot({ mode: 'focus', running: false, timeLeft: 700, completedCycles: 2, activeTaskId: 't1' }, 5000);
  assert.equal(snap.endsAt, null);
  const r = T.restore(JSON.stringify(snap), 999_999, config);
  assert.deepEqual(r, { mode: 'focus', completedCycles: 2, activeTaskId: 't1', running: false, timeLeft: 700, expired: false });
});

test('restore keeps a running timer running with the right remaining time', () => {
  const snap = T.snapshot({ mode: 'shortBreak', running: true, timeLeft: 300, completedCycles: 1 }, 10_000);
  const r = T.restore(snap, 70_000, config); // 60s later
  assert.equal(r.running, true);
  assert.equal(r.timeLeft, 240);
  assert.equal(r.expired, false);
});

test('restore flags a timer that finished while the page was closed', () => {
  const snap = T.snapshot({ mode: 'focus', running: true, timeLeft: 60, completedCycles: 0 }, 0);
  const r = T.restore(snap, 120_000, config);
  assert.equal(r.expired, true);
  assert.equal(r.running, false);
});

test('restore rejects garbage and clamps out-of-range values', () => {
  assert.equal(T.restore(null, 0, config), null);
  assert.equal(T.restore('not json', 0, config), null);
  assert.equal(T.restore({ mode: 'nap' }, 0, config), null);
  const r = T.restore({ mode: 'focus', running: false, timeLeft: 99999, completedCycles: -3 }, 0, config);
  assert.equal(r.timeLeft, 1500);        // clamped to mode length (e.g. settings shrank)
  assert.equal(r.completedCycles, 0);
  assert.equal(T.restore({ mode: 'focus', running: false, timeLeft: 0 }, 0, config).timeLeft, 1500);
});

test('formatTime pads mm:ss', () => {
  assert.equal(T.formatTime(0), '00:00');
  assert.equal(T.formatTime(65), '01:05');
  assert.equal(T.formatTime(1500), '25:00');
  assert.equal(T.formatTime(5400), '90:00');
});

test('goalProgress caps at 100% and flags reached', () => {
  assert.deepEqual(T.goalProgress(1, 4), { done: 1, goal: 4, percent: 25, reached: false });
  assert.equal(T.goalProgress(4, 4).reached, true);
  assert.equal(T.goalProgress(9, 4).percent, 100);
  assert.equal(T.goalProgress(0, 0).goal, 1); // guards divide-by-zero
});

test('shortcutAction maps keys and ignores form fields', () => {
  const body = { tagName: 'BODY' };
  assert.equal(T.shortcutAction(' ', body), 'toggle');
  assert.equal(T.shortcutAction('r', body), 'reset');
  assert.equal(T.shortcutAction('R', body), 'reset');
  assert.equal(T.shortcutAction('1', body), 'focus');
  assert.equal(T.shortcutAction('2', body), 'shortBreak');
  assert.equal(T.shortcutAction('3', body), 'longBreak');
  assert.equal(T.shortcutAction('x', body), null);
  assert.equal(T.shortcutAction(' ', { tagName: 'INPUT' }), null);
  assert.equal(T.shortcutAction('r', { tagName: 'INPUT' }), null);
  assert.equal(T.shortcutAction('1', { tagName: 'TEXTAREA' }), null);
  assert.equal(T.shortcutAction(' ', { tagName: 'BUTTON' }), null); // native click handles space
  assert.equal(T.shortcutAction('r', { tagName: 'BUTTON' }), 'reset');
});

test('heatLevel scales 1-4 relative to the busiest day, 0 for none', () => {
  assert.equal(T.heatLevel(0, 100), 0);
  assert.equal(T.heatLevel(10, 0), 0);
  assert.equal(T.heatLevel(1, 100), 1);
  assert.equal(T.heatLevel(26, 100), 2);
  assert.equal(T.heatLevel(51, 100), 3);
  assert.equal(T.heatLevel(76, 100), 4);
  assert.equal(T.heatLevel(100, 100), 4);
  assert.equal(T.heatLevel(500, 100), 4); // never exceeds 4
});

test('heatmapCells pads so the first date lands on its weekday row', () => {
  // 2026-10-24 is a Saturday (row 6), 2026-10-25 a Sunday (row 0)
  assert.equal(T.heatmapCells([{ date: '2026-10-24' }]).filter(c => c === null).length, 6);
  assert.equal(T.heatmapCells([{ date: '2026-10-25' }]).filter(c => c === null).length, 0);
  assert.deepEqual(T.heatmapCells([]), []);
});

test('estimateLabel shows actual/estimate, plain count, or nothing', () => {
  assert.equal(T.estimateLabel(2, 4), '2/4 🍅');
  assert.equal(T.estimateLabel(0, 3), '0/3 🍅');
  assert.equal(T.estimateLabel(5, 0), '5 🍅');
  assert.equal(T.estimateLabel(0, 0), '');
  assert.equal(T.estimateLabel(5, 4), '5/4 🍅'); // over-estimate still reported
});

test('taskTextParts splits text and http(s) links, dropping trailing punctuation', () => {
  assert.deepEqual(T.taskTextParts('Review https://dev-log-minute-meeting.vercel.app/ today.'), [
    { type: 'text', value: 'Review ' },
    { type: 'link', href: 'https://dev-log-minute-meeting.vercel.app/', label: 'dev-log-minute-meeting.vercel.app' },
    { type: 'text', value: ' today.' },
  ]);
  assert.deepEqual(T.taskTextParts('(see www.example.com/docs).'), [
    { type: 'text', value: '(see ' },
    { type: 'link', href: 'https://www.example.com/docs', label: 'example.com/docs' },
    { type: 'text', value: ').' },
  ]);
  assert.deepEqual(T.taskTextParts('No links here'), [{ type: 'text', value: 'No links here' }]);
  assert.deepEqual(T.taskTextParts('javascript:alert(1) ftp://x.y'), [{ type: 'text', value: 'javascript:alert(1) ftp://x.y' }]);
});

test('shortUrl keeps host and path and cuts long ones', () => {
  assert.equal(T.shortUrl('https://www.github.com/MusDev99/pomodoro-app'), 'github.com/MusDev99/pomodoro-app');
  assert.equal(T.shortUrl('https://example.com/' + 'a'.repeat(60)).length, 40);
  assert.ok(T.shortUrl('https://example.com/' + 'a'.repeat(60)).endsWith('…'));
});

test('taskDisplayText and firstTaskLink', () => {
  const text = 'Notes https://dev-log-minute-meeting.vercel.app/meetings/42 and https://example.com';
  assert.equal(T.taskDisplayText(text), 'Notes dev-log-minute-meeting.vercel.app/meeti… and example.com');
  assert.equal(T.firstTaskLink(text), 'https://dev-log-minute-meeting.vercel.app/meetings/42');
  assert.equal(T.firstTaskLink('plain'), null);
});

test('formatElapsed shows m:ss, and h:mm:ss from one hour', () => {
  assert.equal(T.formatElapsed(0), '0:00');
  assert.equal(T.formatElapsed(30000), '0:30');
  assert.equal(T.formatElapsed(754000), '12:34');
  assert.equal(T.formatElapsed(3600000), '1:00:00');
  assert.equal(T.formatElapsed(3725999), '1:02:05');
  assert.equal(T.formatElapsed(-5), '0:00');
});
