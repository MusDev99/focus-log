# Focus Log repo checks

Extra checks for this repo, on top of `SKILL.md`. Gate: `scripts/validate.sh`.

Stack: static vanilla JS (`app.js`, `timer-core.js`, `store.js`, `audio.js`); all data in `localStorage`, no backend. Pure logic belongs in `timer-core.js` (timer) and `store.js` (data + stats), because those are unit-tested.

- [ ] Edge cases: corrupt/missing `localStorage` data, timer at 0, reload mid-session, tab in background, duplicate or missing ids.
- [ ] `completed_at` is a UTC ISO string; day buckets go through `localDayKey(new Date(...))`, never a string-slice date compare.
- [ ] Timer is wall-clock based (`endsAt - Date.now()`), never a decrementing counter.
- [ ] `store.js` validates and clamps every write; reads tolerate corrupt JSON; every `localStorage` access is wrapped (private mode / quota).
- [ ] CSV export goes through `csvSafe`; user text uses `textContent`, never `innerHTML`.
- [ ] Tests in `tests/store.test.js` / `tests/timer-core.test.js`, including failure paths.
- [ ] Every new function has a short JSDoc; no new dependencies without discussion.
- [ ] Works at ≤ 600px (no horizontal scroll, touch targets ≥ 44px); buttons have `aria-label`, modals trap focus and close on Esc.
- [ ] `localStorage` is read once per operation, not inside loops.
