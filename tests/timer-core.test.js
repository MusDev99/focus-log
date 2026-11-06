// Unit tests for timer-core.js — run with `node --test tests/*.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../timer-core.js');

test('goalProgress caps at 100% and flags reached', () => {
  assert.deepEqual(T.goalProgress(1, 4), { done: 1, goal: 4, percent: 25, reached: false });
  assert.equal(T.goalProgress(4, 4).reached, true);
  assert.equal(T.goalProgress(9, 4).percent, 100);
  assert.equal(T.goalProgress(0, 0).goal, 1); // guards divide-by-zero
});

test('shortcutAction maps keys and ignores form fields', () => {
  const body = { tagName: 'BODY' };
  assert.equal(T.shortcutAction(' ', body), 'toggle');
  assert.equal(T.shortcutAction('1', body), 'work');
  assert.equal(T.shortcutAction('2', body), 'break');
  assert.equal(T.shortcutAction('3', body), null);
  assert.equal(T.shortcutAction('r', body), null);
  assert.equal(T.shortcutAction(' ', { tagName: 'INPUT' }), null);
  assert.equal(T.shortcutAction('1', { tagName: 'TEXTAREA' }), null);
  assert.equal(T.shortcutAction(' ', { tagName: 'BUTTON' }), null); // native click handles space
  assert.equal(T.shortcutAction('1', { tagName: 'BUTTON' }), 'work');
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

// ---- row swipe rules ----

const BOTH = { left: true, right: true };
const LEFT_ONLY = { left: true, right: false };

test('lockAxis waits for 8 px, then splits scroll from swipe; a diagonal stays a scroll', () => {
  assert.equal(T.lockAxis(3, 4), null);
  assert.equal(T.lockAxis(12, 3), 'x');
  assert.equal(T.lockAxis(-12, 3), 'x');
  assert.equal(T.lockAxis(4, 12), 'y');
  assert.equal(T.lockAxis(10, 9), 'y');
});

test('swipeThreshold is 30% of the row within 72-160 px', () => {
  assert.equal(T.swipeThreshold(200), 72);
  assert.equal(T.swipeThreshold(375), 112.5);
  assert.equal(T.swipeThreshold(1000), 160);
});

test('swipePull follows the finger to the threshold, then at 35%, and never past 60% of the row', () => {
  const t = T.swipeThreshold(375);
  assert.equal(T.swipePull(50, 375, BOTH), 50);
  assert.equal(T.swipePull(-50, 375, BOTH), -50);
  assert.equal(T.swipePull(t + 100, 375, BOTH), t + 35);
  assert.equal(T.swipePull(0, 375, BOTH), 0);
  assert.equal(T.swipePull(5000, 100, BOTH), 60);
});

test('a direction with no action resists and stops at 24 px', () => {
  assert.equal(T.swipePull(100, 375, LEFT_ONLY), 15);
  assert.equal(T.swipePull(1000, 375, LEFT_ONLY), 24);
});

test('swipeArmed only past the threshold and only for an allowed direction', () => {
  assert.equal(T.swipeArmed(50, 375, BOTH), false);
  assert.equal(T.swipeArmed(120, 375, BOTH), true);
  assert.equal(T.swipeArmed(-120, 375, BOTH), true);
  assert.equal(T.swipeArmed(120, 375, LEFT_ONLY), false);
});

test('swipeCommit: past the threshold acts, a short swipe springs back, a quick flick acts early', () => {
  assert.equal(T.swipeCommit(130, 375, 0, BOTH), 'right');
  assert.equal(T.swipeCommit(-130, 375, 0, BOTH), 'left');
  assert.equal(T.swipeCommit(60, 375, 0.1, BOTH), null);
  assert.equal(T.swipeCommit(60, 375, 0.9, BOTH), 'right');
  assert.equal(T.swipeCommit(-60, 375, -0.9, BOTH), 'left');
  assert.equal(T.swipeCommit(20, 375, 0.9, BOTH), null, 'a tiny move is never a flick');
  assert.equal(T.swipeCommit(60, 375, -0.9, BOTH), null, 'a flick against the direction does not count');
  assert.equal(T.swipeCommit(300, 375, 2, LEFT_ONLY), null, 'a dead direction never acts');
  assert.equal(T.swipeCommit(0, 375, 2, BOTH), null);
});

// ---- developer views ----

const JIRA = 'https://airasia.atlassian.net/browse/SKYIQ-10143';
const NOW = new Date(2026, 10, 6, 15, 0, 0); // local Fri 6 Nov 2026, 15:00
const MIN = 60 * 1000;
const at = (day, hour = 10) => new Date(2026, 10, day, hour).toISOString();

test('sourceOfText: a Jira ticket, a GitHub repo (PRs and issues group), a site, or nothing', () => {
  assert.deepEqual(T.sourceOfText(`fix ${JIRA} today`), { kind: 'jira', key: 'jira:SKYIQ-10143', label: 'SKYIQ-10143', href: JIRA });
  assert.equal(T.sourceOfText('see https://github.com/MusDev99/devlog/pull/7').label, 'MusDev99/devlog');
  assert.equal(T.sourceOfText('https://github.com/MusDev99/devlog/pull/7').key, T.sourceOfText('https://github.com/musdev99/devlog/issues/9').key);
  assert.equal(T.sourceOfText('read https://www.example.com/a/b').label, 'example.com');
  assert.equal(T.sourceOfText('no link here'), null);
  assert.equal(T.sourceOfText(''), null);
});

test('sourceOfText uses only the first link of a task', () => {
  assert.equal(T.sourceOfText(`${JIRA} and https://github.com/a/b`).kind, 'jira');
});

function sample() {
  const tasks = [
    { id: 'a', text: `Seat map ${JIRA}`, completed: true, points: 3 },
    { id: 'b', text: `Seat map follow-up ${JIRA}`, completed: false, points: 2 },
    { id: 'c', text: 'Fare PR https://github.com/airasia/fare-engine/pull/88', completed: false, points: 0 },
    { id: 'd', text: 'No link at all', completed: false, points: 1 },
  ];
  const s = (task_id, minutes, completed_at) => ({ task_id, completed_at, duration_seconds: minutes * 60, mode: 'focus' });
  const sessions = [
    s('a', 60, at(5)), s('b', 30, at(6)), s('c', 45, at(4)), s('d', 15, at(6)),
    s(null, 10, at(6)), // a session with no task
    s('gone', 20, at(6)), // its task was deleted
    s('a', 999, new Date(2026, 9, 25, 10).toISOString()), // 12 days ago: outside the 7-day window
  ];
  return { tasks, sessions };
}

test('timeBySource: time per ticket or repo, largest first, with tasks, done and points', () => {
  const { tasks, sessions } = sample();
  const r = T.timeBySource(tasks, sessions, NOW);
  assert.equal(r.totalSeconds, (60 + 30 + 45 + 15 + 10 + 20) * 60);
  assert.equal(r.linkedSeconds, (60 + 30 + 45) * 60);
  assert.deepEqual(r.streams.map((x) => [x.label, x.seconds / 60, x.tasks, x.done, x.points]), [
    ['SKYIQ-10143', 90, 2, 1, 3],
    ['airasia/fare-engine', 45, 1, 0, 0],
  ]);
  assert.ok(Math.abs(r.streams[0].share - 90 / 180) < 1e-9);
});

test('timeBySource: nothing to report is empty, and bad data never throws', () => {
  assert.deepEqual(T.timeBySource([], [], NOW), { totalSeconds: 0, linkedSeconds: 0, streams: [] });
  const { tasks } = sample();
  const r = T.timeBySource(tasks, [
    { task_id: 'a', completed_at: 'not a date', duration_seconds: 600 },
    { task_id: 'a', completed_at: at(6), duration_seconds: -5 },
    { task_id: 'a', completed_at: at(6), duration_seconds: 'lots' },
  ], NOW);
  assert.equal(r.totalSeconds, 0);
});

test('timeBySource: the window is calendar days in local time, today included', () => {
  const { tasks } = sample();
  const edge = (day, hour) => ({ task_id: 'a', completed_at: at(day, hour), duration_seconds: 60 });
  // 7-day window ending Fri 6 Nov starts Sat 31 Oct 00:00 local
  assert.equal(T.timeBySource(tasks, [edge(31, 0)], NOW).totalSeconds, 60, 'first minute of the first day counts');
  assert.equal(T.timeBySource(tasks, [{ task_id: 'a', completed_at: new Date(2026, 9, 30, 23, 59).toISOString(), duration_seconds: 60 }], NOW).totalSeconds, 0, 'the evening before does not');
});

function done(points, minutes, day = 3) {
  return { id: `t${points}-${minutes}-${day}`, text: 'x', completed: true, points, completed_at: at(day), elapsed_ms: minutes * MIN };
}

test('sizingCheck: time that grows with points tracks', () => {
  const r = T.sizingCheck([done(1, 10), done(1, 20), done(3, 40), done(5, 90)], NOW);
  assert.equal(r.verdict, 'tracks');
  assert.deepEqual(r.rows.map((x) => [x.points, x.tasks, x.avgMs / MIN]), [[1, 2, 15], [3, 1, 40], [5, 1, 90]]);
});

test('sizingCheck: a bigger size that took less time drifts, and names the pair', () => {
  const r = T.sizingCheck([done(1, 10), done(3, 60), done(5, 20)], NOW);
  assert.equal(r.verdict, 'drifts');
  assert.deepEqual(r.example, [3, 5]);
});

test('sizingCheck stays silent with too little to compare, and ignores noise', () => {
  assert.equal(T.sizingCheck([done(1, 10), done(3, 40)], NOW).verdict, null);
  assert.equal(T.sizingCheck([done(1, 2), done(3, 4), done(5, 3)], NOW).rows.length, 0, 'under 5 minutes is noise');
  assert.equal(T.sizingCheck([done(1, 10, 3), { ...done(3, 40), completed_at: new Date(2026, 5, 1).toISOString() }], NOW).rows.length, 1, 'old work is outside the window');
  const open = { ...done(5, 60), completed: false };
  const unscored = { ...done(0, 60) };
  const noDate = { ...done(8, 60), completed_at: null };
  assert.equal(T.sizingCheck([open, unscored, noDate], NOW).rows.length, 0, 'open, unscored or undated tasks are skipped');
  assert.deepEqual(T.sizingCheck([], NOW), { rows: [], verdict: null, example: null });
});

test('wipTasks: open tasks that were started, or are running, and nothing else', () => {
  const tasks = [
    { id: '1', completed: false, elapsed_ms: 5 * MIN },
    { id: '2', completed: false, elapsed_ms: 0, running: true },
    { id: '3', completed: false, elapsed_ms: 0 },
    { id: '4', completed: true, elapsed_ms: 99 * MIN },
  ];
  assert.deepEqual(T.wipTasks(tasks).map((t) => t.id), ['1', '2']);
  assert.deepEqual(T.wipTasks([]), []);
});

test('sizingVerdictText: nothing, tracks, or drifts with the right article', () => {
  assert.equal(T.sizingVerdictText({ rows: [], verdict: null, example: null }), '');
  assert.match(T.sizingVerdictText({ rows: [], verdict: 'tracks', example: null }), /story points track effort/);
  assert.match(T.sizingVerdictText({ verdict: 'drifts', example: [3, 5] }), /^A 5 SP task took less time than a 3 SP one\./);
  assert.match(T.sizingVerdictText({ verdict: 'drifts', example: [5, 8] }), /^An 8 SP task took less time than a 5 SP one\./);
  assert.match(T.sizingVerdictText({ verdict: 'drifts', example: [13, 21] }), /^A 21 SP task/);
  assert.equal(T.sizingVerdictText({ verdict: 'drifts', example: null }), '', 'a drift without a pair says nothing');
});
