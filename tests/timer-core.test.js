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
