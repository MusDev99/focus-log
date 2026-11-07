# ⏱ Focus Log

A work and break clock with tasks on a priority matrix, story points and focus analytics. Zero-dependency static app: vanilla JS + `localStorage`. No backend, no account: all data stays in the browser.

> Formerly *Pomodoro Focus Dashboard*. It no longer counts 25-minute pomodoros; the clock counts up and every task has its own stopwatch. Data saved under the old name is carried over automatically (see **Storage**).

```bash
npm start                # any static server works; this one is http://localhost:8000
npm test                 # node unit tests
scripts/validate.sh      # full validation gate (syntax, tests, tests-for-changes check)
```

You can also just open `index.html` directly in a browser.

| Feature | Notes |
|---|---|
| ⏱ Timer | wall-clock based (no drift), survives reload, auto-advance, optional auto-start |
| 🔔 Alerts | end-of-session chime + notification via the service worker (works on Android); tap it to return to the app |
| 🐱🐶🐮🐷 Character | desk buddy follows the clock (types, sips coffee, naps) and speaks in its own voice; pick cat, dog, cow or pig in Preferences, or tap it to cycle cat → dog → cow → pig |
| ⌨️ Shortcuts | `Space` start/pause · `R` reset · `1`/`2`/`3` modes |
| 🎯 Daily goal | progress bar, configurable in settings |
| 🌗 Dark mode | toggle in top bar, saved |
| 📊 Stats | local-time day buckets, streak, 7-day chart |
| ✏️ Tasks | reorder by dragging the handle or with ↑/↓ on it; edit, move, story points and delete are in one bottom sheet behind each task's ⋯ |
| ➕ New activity | on a phone, a **New activity** button opens a guided flow, one question per screen with a progress bar: what you are working on, a Jira or GitHub link (with a live check that it was recognised), a story-point size, and a spot on the priority matrix. Only the title is required; every other step has Skip, Back keeps your choices, and the quick add field above stays for fast capture |
| 🚀 Speed | only the task view on screen is drawn (the other when you switch to it); the stats are drawn just after the frame, once, however many changes arrive; finishing a task marks the row done on the spot and rebuilds on the next frame; icons are parsed once and cloned. With 100 open tasks and the CPU slowed 4x: completing a task answers in about 10 ms (273 ms before), a list rebuild takes 59 ms (130 ms). Measure with `scripts/perf.cjs` |
| 👆 Swipe | on a touch screen, swipe a task right to finish it or left to open its sheet (vertical scroll and pinch zoom are untouched; a long-press still drags a matrix chip, and a mouse drags as before). Every action keeps a button, so the swipe is only a shortcut |
| 🎯 Story points | optional points per task; the daily points goal and stats use them |
| 🧑‍💻 Developer view | Stats card: focus time by Jira ticket or GitHub repo (from the first link in each task, last 7 days), a sizing check (average time per story-point size over 4 weeks, and whether bigger sizes really take longer), and a warning when 3 or more tasks are started but not finished |
| 🗓 Heatmap | focus minutes per day for the last 12 weeks |
| 📈 Focus by task | top tasks by focus time |
| 📅 Weekly review | last 7 days vs the 7 before, best day, top task, longest streak |
| 💾 Backup | export/import everything as JSON in Settings; importing merges by id |
| ⬇ CSV export | generated in the browser (formula-injection safe) |
| 📱 Mobile | single-column layout, touch-sized controls, bottom-sheet settings |

## Storage

`store.js` keeps everything in `localStorage` under these keys:

| Key | Contents |
|---|---|
| `focuslog-tasks` | task list |
| `focuslog-sessions` | completed sessions (stats are computed from these) |
| `focuslog-settings` | clock preferences + goals |
| `focuslog-task-clock`, `focuslog-work-state` | the running task clock and work/break stretch (survive reload) |
| `focuslog-theme`, `focuslog-view`, `focuslog-task-view`, `focuslog-active-task` | small interface preferences |
| `focuslog-migrated` | set once the old data has been carried over |

**Coming from the old Pomodoro app?** On first load the `pomodoro-*` data is copied once to the keys above. The old keys are left untouched as a backup, new data always wins, and the copy never runs again, so deleting data later never brings the old copy back. Old tasks lose their pomodoro estimate (story points replaced it). Backup files exported before the rename still import.

Data is per browser and per device; clearing site data deletes it. Use **Settings → Export backup** to keep a copy or move it to another device (import merges, so you can combine devices).

Agent skills live in `.agents/skills/` (`code-review`, `feature-validation`). `code-review/SKILL.md` is the shared checklist used in every MusDev99 repo; `code-review/repo-checks.md` holds this app's extra checks.

## 🌿 Branches

Follows [BRANCHING.md](https://github.com/MusDev99/agentic-coding-style/blob/main/BRANCHING.md): `feat/`, `fix/`, `chore/` or `docs/` branches, Conventional Commit PR titles, squash merge.

| Workflow | What it does |
|---|---|
| `.github/workflows/branch-policy.yml` | Fails a PR whose branch name or title breaks the rules |
| `.github/workflows/branch-cleanup.yml` | Deletes the PR's branch once it is merged (skips forks, the default branch and branches another open PR is based on) |

Keep **Settings → General → Automatically delete head branches** on as well; the workflow is the backup.
