// Focus Log - State, work/break clock, tasks, localStorage persistence, & Web Audio Integration
// Pure timer helpers live in timer-core.js and the data layer in store.js (both unit-tested).

const store = window.FocusLogStore.createStore(window.localStorage); // also carries any old pomodoro-* data over, once
const UI_KEYS = window.FocusLogStore.UI_KEYS;
const { heatLevel, heatmapCells, taskTextParts, taskDisplayText, firstTaskLink, formatElapsed, goalProgress, shortcutAction, timeBySource, sizingCheck, sizingVerdictText, wipTasks, lockAxis, swipePull, swipeArmed, swipeCommit } = window.TimerCore;

let config = {
  daily_goal: 4, // hours of work per day
  daily_points_goal: 10,
  cat_sound: 1,
  character: 'cat',
  theme: 'light'
};
const CHARACTERS = ['cat', 'dog', 'cow', 'pig'];

let workMode = 'idle'; // 'work' | 'break' | 'idle', mirrors store.getWorkState()
let activeTaskId = null;
let todayWorkMs = 0;
let goalReachedDay = null;
let goalPrimed = false; // the first clock update after load must not celebrate a goal reached earlier

// DOM Elements
const bodyEl = document.body;
const timeDisplayEl = document.getElementById('time-display');
const modeStatusEl = document.getElementById('mode-status');
const stretchLineEl = document.getElementById('stretch-line');
const activeTaskPillEl = document.getElementById('active-task-pill');
const startBtnEl = document.getElementById('start-btn');
const startTextEl = document.getElementById('start-text');
const startIconEl = document.getElementById('start-icon');
const stopBtnEl = document.getElementById('stop-btn');
const tabButtons = document.querySelectorAll('.tab-btn');
const catStageEl = document.getElementById('cat-stage');
const navTimerLabelEl = document.getElementById('nav-timer-label');

const ACTIVE_TASK_KEY = UI_KEYS.activeTask;
const PLAY_ICON = '<path d="M8 5v14l11-7z"/>';
const COFFEE_ICON = '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h2a2.5 2.5 0 0 1 0 5h-2" fill="none" stroke="currentColor" stroke-width="2"/>';
const MODE_STATUS = { idle: 'Ready when you are', work: 'Working…', break: 'Break time ☕' };

/**
 * The clock: Work counts up today's total work time, Break counts up today's break time. Both keep running
 * on the wall clock (store.js), so a reload or a throttled background tab loses nothing.
 */
function updateClock() {
  const t = store.todayTotals();
  if (t.mode !== workMode) { // first run after a reload, or changed in another tab
    workMode = t.mode;
    applyWorkUi();
  }
  todayWorkMs = t.work_ms;
  const onBreak = t.mode === 'break';
  const shown = formatElapsed(onBreak ? t.break_ms : t.work_ms);

  timeDisplayEl.textContent = shown;
  document.title = t.mode === 'idle' ? 'Focus Log' : `${shown} · ${onBreak ? 'Break' : 'Work'}`;
  modeStatusEl.textContent = MODE_STATUS[t.mode];
  stretchLineEl.hidden = t.mode === 'idle';
  stretchLineEl.textContent = `${onBreak ? 'This break' : 'This stretch'} ${formatElapsed(t.stretch_ms)}`;
  navTimerLabelEl.textContent = t.mode === 'idle' ? 'Overview' : formatElapsed(t.stretch_ms);

  todayFocusMinsEl.textContent = Math.floor(t.work_ms / 60000);
  todayBreakMinsEl.textContent = Math.floor(t.break_ms / 60000);
  renderGoal();
  checkGoalReached(t.work_ms);
  updateTaskClocks();
}

/** Cheer for a finished task or a reached target (muted with the cat sounds setting). */
function cheer() {
  if (config.cat_sound) window.catSound.cheer();
}

function checkGoalReached(workMs) {
  if (workMs < config.daily_goal * 3600000) return;
  const day = window.FocusLogStore.localDayKey(new Date());
  if (goalReachedDay === day) return;
  goalReachedDay = day;
  if (!goalPrimed) return;
  celebrate('big');
  cheer();
  buzz([30, 60, 30]);
  showToast(`🎉 Daily work goal reached — ${hoursText(workMs / 60000)} today!`);
}

/** Show the chosen character (cat, dog, cow or pig) on the stage. */
function applyCharacter() {
  catStageEl.setAttribute('data-char', config.character);
  catStageEl.setAttribute('aria-label', `Change character, now ${config.character}`);
  if (config.cat_sound) window.catSound.preload(config.character);
}

/** Tapping the stage switches to the next character: cat → dog → cow → pig → cat. */
function nextCharacter() {
  const next = CHARACTERS[(CHARACTERS.indexOf(config.character) + 1) % CHARACTERS.length];
  config = { ...config, ...store.saveSettings({ character: next }) };
  applyCharacter();
  settingCharacterInput.value = config.character;
  if (config.cat_sound) window.catSound.meow(workMode === 'break' ? 'break' : 'work', config.character);
}

catStageEl.addEventListener('click', nextCharacter);
catStageEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  nextCharacter();
});

/** Character, tabs, button and theme follow the mode. */
function applyWorkUi() {
  bodyEl.setAttribute('data-mode', workMode);
  catStageEl.setAttribute('data-mode', workMode);
  tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === (workMode === 'break' ? 'break' : 'work')));
  stopBtnEl.hidden = workMode === 'idle';
  startBtnEl.classList.toggle('on-break', workMode === 'work');
  if (workMode === 'work') {
    startTextEl.textContent = 'Take a break';
    startIconEl.innerHTML = COFFEE_ICON;
  } else {
    startTextEl.textContent = workMode === 'break' ? 'Back to work' : 'Start work';
    startIconEl.innerHTML = PLAY_ICON;
  }
}

function saveActiveTask() {
  try {
    if (activeTaskId) localStorage.setItem(ACTIVE_TASK_KEY, activeTaskId);
    else localStorage.removeItem(ACTIVE_TASK_KEY);
  } catch (e) { /* storage unavailable */ }
}

/** Refresh everything that depends on the mode or on a stretch having just been logged. */
function afterModeChange() {
  const before = workMode;
  workMode = store.getWorkState().mode;
  // The cat announces a switch to work or to a break (not a stop, and not a task change within work)
  if (workMode !== before && workMode !== 'idle' && config.cat_sound) window.catSound.meow(workMode, config.character);
  applyWorkUi();
  saveActiveTask();
  fetchTasks();
  loadStats();
  updateClock();
}

function startWork() {
  if (workMode === 'work') return;
  buzz(10);
  store.setWorkMode('work', activeTaskId);
  if (activeTaskId) store.startTaskClock(activeTaskId);
  afterModeChange();
}

/** Work is logged and the break clock starts; the focused task's own timer pauses until you are back. */
function takeBreak() {
  if (workMode === 'break') return;
  buzz(10);
  store.pauseTaskClock();
  store.setWorkMode('break');
  afterModeChange();
}

function stopClock() {
  if (workMode === 'idle') return;
  store.pauseTaskClock();
  store.setWorkMode('idle');
  afterModeChange();
}

const toggleClock = () => (workMode === 'work' ? takeBreak() : startWork());

/** While working, a stretch belongs to one task, so it is split whenever the task being worked on changes. */
function retargetWork(taskId) {
  if (store.getWorkState().mode === 'work') store.setWorkMode('work', taskId);
}

// ---- Reset today's counters (confirm modal: Esc / backdrop / Keep it cancel, focus trap, focus restore) ----
const resetModal = document.getElementById('reset-modal');
const resetCancelBtn = document.getElementById('reset-cancel-btn');
const resetConfirmBtn = document.getElementById('reset-confirm-btn');
let lastFocusedBeforeReset = null;

/** Show the confirm modal with what is about to be cleared; focus starts on the safe choice. */
function openResetModal() {
  const t = store.todayTotals();
  document.getElementById('reset-work').textContent = formatElapsed(t.work_ms);
  document.getElementById('reset-break').textContent = formatElapsed(t.break_ms);
  lastFocusedBeforeReset = document.activeElement;
  resetModal.classList.add('open');
  resetModal.setAttribute('aria-hidden', 'false');
  resetCancelBtn.focus();
}

/** Hide the confirm modal and give focus back to where it was. */
function closeResetModal() {
  resetModal.classList.remove('open');
  resetModal.setAttribute('aria-hidden', 'true');
  if (lastFocusedBeforeReset && lastFocusedBeforeReset.focus) lastFocusedBeforeReset.focus();
}

/** Zero today's work and break counters (earlier days are kept); a running stretch restarts from now. */
function resetToday() {
  store.resetToday();
  goalReachedDay = null;
  closeResetModal();
  fetchTasks();
  loadStats();
  updateClock();
  showToast("Today's counters reset");
}

document.getElementById('reset-btn').addEventListener('click', openResetModal);
resetCancelBtn.addEventListener('click', closeResetModal);
resetConfirmBtn.addEventListener('click', resetToday);
resetModal.addEventListener('click', (e) => {
  if (e.target === resetModal) closeResetModal();
});
resetModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeResetModal();
    return;
  }
  if (e.key !== 'Tab') return;
  const first = resetCancelBtn;
  const last = resetConfirmBtn;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

startBtnEl.addEventListener('click', toggleClock);
stopBtnEl.addEventListener('click', stopClock);

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => (btn.dataset.mode === 'break' ? takeBreak() : startWork()));
});

// Keyboard shortcuts: Space switches work/break, 1 work, 2 break
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('.modal-backdrop.open')) return; // a dialog is open: keys belong to it
  const action = shortcutAction(e.key, e.target);
  if (!action) return;
  e.preventDefault();
  if (action === 'toggle') toggleClock();
  else if (action === 'work') startWork();
  else takeBreak();
});

// Recompute immediately when the tab becomes visible again
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateClock();
});

setInterval(updateClock, 1000);

// ====================================================
// Task Tracker (localStorage)
// ====================================================
const taskFormEl = document.getElementById('task-form');
const taskInputEl = document.getElementById('task-input');
const taskPointsEl = document.getElementById('task-points');
const taskListEl = document.getElementById('task-list');
const taskCounterEl = document.getElementById('task-counter');
const taskEmptyStateEl = document.getElementById('task-empty-state');
const navTasksBadgeEl = document.getElementById('nav-tasks-badge');

let tasks = [];

// Covey's time-management matrix (Habit 3: Put First Things First)
const QUADRANTS = {
  1: { name: 'Do now', short: 'Do' },
  2: { name: 'Schedule', short: 'Schedule' },
  3: { name: 'Delegate', short: 'Delegate' },
  4: { name: 'Drop', short: 'Drop' },
};
const TASK_VIEW_KEY = UI_KEYS.taskView;
const taskMatrixEl = document.getElementById('task-matrix');
const taskViewBtns = document.querySelectorAll('.task-view-btn');
let taskView = 'list';

function setTaskView(view) {
  taskView = view === 'matrix' ? 'matrix' : 'list';
  taskViewBtns.forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.taskView === taskView)));
  taskListEl.hidden = taskView !== 'list';
  taskMatrixEl.hidden = taskView !== 'matrix';
  try { localStorage.setItem(TASK_VIEW_KEY, taskView); } catch (e) { /* ignore */ }
}

taskViewBtns.forEach(btn => btn.addEventListener('click', () => setTaskView(btn.dataset.taskView)));

function fetchTasks() {
  tasks = store.listTasks();
  syncActiveTaskPill();
  renderTasks();
  loadScore();
}

const pointsLabel = (points) => `${points} SP`;

/** Fill `el` with the task text, links clickable (opened in a new tab, never as the task tap). */
function renderTaskText(el, text) {
  el.textContent = '';
  taskTextParts(text).forEach((part) => {
    if (part.type === 'text') {
      el.append(part.value);
      return;
    }
    const a = document.createElement('a');
    a.className = 'task-link';
    a.href = part.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = part.label;
    a.title = part.href;
    a.addEventListener('click', (e) => e.stopPropagation());
    el.appendChild(a);
  });
}

function updateTaskCounter() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  taskCounterEl.textContent = `${completed}/${total}`;
  const open = total - completed;
  navTasksBadgeEl.hidden = open === 0;
  navTasksBadgeEl.textContent = open;
  taskEmptyStateEl.classList.toggle('visible', open === 0);
  taskEmptyStateEl.textContent = total === 0
    ? 'No tasks yet. Add one to set your intention.'
    : 'Everything is done 🎉 Add another task, or restore one from Done.';
}

// ---- Done bucket: finished tasks move here, and Restore puts one back on the board ----
const doneListEl = document.getElementById('done-list');
const doneCounterEl = document.getElementById('done-counter');
const doneEmptyEl = document.getElementById('done-empty');

function renderDone() {
  const done = tasks
    .filter(t => t.completed)
    .sort((a, b) => (b.completed_at ? Date.parse(b.completed_at) : 0) - (a.completed_at ? Date.parse(a.completed_at) : 0));
  doneListEl.innerHTML = '';
  done.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'done-item';
    li.dataset.id = task.id;

    const main = document.createElement('div');
    main.className = 'done-main';
    const text = document.createElement('span');
    text.className = 'done-text';
    renderTaskText(text, task.text);
    main.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    if (task.elapsed_ms) {
      const time = document.createElement('span');
      time.className = 'task-time-badge';
      time.textContent = `⏱ ${formatElapsed(task.elapsed_ms)}`;
      time.title = 'Total time spent';
      meta.appendChild(time);
    }
    if (task.points) {
      const sp = document.createElement('span');
      sp.className = 'task-points-badge';
      sp.textContent = pointsLabel(task.points);
      meta.appendChild(sp);
    }
    if (meta.children.length) main.appendChild(meta);

    const shown = taskDisplayText(task.text);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'task-restore-btn';
    restore.textContent = '↩ Restore';
    restore.setAttribute('aria-label', `Restore "${shown}" to your tasks`);
    restore.addEventListener('click', () => toggleTask(task.id, false));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'task-delete-btn done-delete-btn';
    remove.setAttribute('aria-label', `Delete "${shown}"`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    remove.addEventListener('click', () => deleteTask(task.id));

    li.append(main, restore, remove);
    doneListEl.appendChild(li);
  });
  doneCounterEl.textContent = done.length;
  doneEmptyEl.classList.toggle('visible', done.length === 0);
}

function renderTasks() {
  taskListEl.innerHTML = '';

  tasks.filter(t => !t.completed).forEach((task) => {
    const li = document.createElement('li');
    li.className = `task-item ${task.completed ? 'completed' : ''} ${task.id === activeTaskId ? 'selected-task' : ''}`;
    li.dataset.id = task.id;

    // Drag handle: pointer drag (mouse + touch) or ArrowUp/ArrowDown to reorder
    const handle = document.createElement('button');
    handle.className = 'task-drag-handle';
    handle.type = 'button';
    handle.setAttribute('aria-label', `Reorder "${taskDisplayText(task.text)}" (drag, or use arrow keys)`);
    handle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>
        <circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>
        <circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>
      </svg>
    `;
    handle.addEventListener('pointerdown', (e) => startTaskDrag(e, li));
    handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      moveTaskBy(task.id, e.key === 'ArrowUp' ? -1 : 1);
    });

    // Checkbox button
    const checkBtn = document.createElement('button');
    checkBtn.className = 'task-checkbox-btn';
    checkBtn.type = 'button';
    checkBtn.setAttribute('aria-label', task.completed ? 'Mark incomplete' : 'Mark complete');
    checkBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
    checkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!task.completed) {
        const r = checkBtn.getBoundingClientRect();
        celebrate('tiny', r.left + r.width / 2, r.top + r.height / 2);
        buzz(15);
      }
      toggleTask(task.id, !task.completed);
    });

    // Task text
    const textSpan = document.createElement('span');
    textSpan.className = 'task-text';
    renderTaskText(textSpan, task.text);
    textSpan.addEventListener('click', () => selectActiveTask(task));

    // More button: edit, move, story points and delete live in one bottom sheet (a left swipe opens it too)
    const moreBtn = document.createElement('button');
    moreBtn.className = 'task-more-btn';
    moreBtn.type = 'button';
    moreBtn.setAttribute('aria-label', `More actions for "${taskDisplayText(task.text)}"`);
    moreBtn.setAttribute('aria-haspopup', 'dialog');
    moreBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskSheet(task);
    });

    // Title with its points and time underneath, so the title keeps its width on phones
    const main = document.createElement('div');
    main.className = 'task-main';
    main.appendChild(textSpan);

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    if (task.points) {
      const sp = document.createElement('span');
      sp.className = 'task-points-badge';
      sp.textContent = pointsLabel(task.points);
      sp.title = `${task.points} story points`;
      meta.appendChild(sp);
    }
    if (task.elapsed_ms || task.running) {
      const time = document.createElement('span');
      time.className = 'task-time-badge' + (task.running ? ' running' : '');
      time.dataset.timeFor = task.id;
      time.textContent = `⏱ ${formatElapsed(task.elapsed_ms)}`;
      time.title = task.completed ? 'Total time spent' : 'Time spent so far';
      meta.appendChild(time);
    }
    if (task.quadrant) {
      const tag = document.createElement('span');
      tag.className = `task-quadrant-tag q${task.quadrant}`;
      tag.textContent = `Q${task.quadrant} · ${QUADRANTS[task.quadrant].short}`;
      meta.appendChild(tag);
    }
    if (meta.children.length) main.appendChild(meta);

    li.appendChild(handle);
    li.appendChild(checkBtn);
    li.appendChild(main);
    if (!task.completed) {
      const clockBtn = document.createElement('button');
      clockBtn.className = 'task-clock-btn' + (task.running ? ' running' : '');
      clockBtn.type = 'button';
      const shown = taskDisplayText(task.text);
      clockBtn.setAttribute('aria-label', task.running ? `Pause timer for "${shown}"` : `Start timer for "${shown}"`);
      clockBtn.title = task.running ? 'Pause this task\'s timer' : 'Start this task\'s timer';
      clockBtn.innerHTML = task.running
        ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
      clockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectActiveTask(task);
      });
      li.appendChild(clockBtn);
    }
    li.appendChild(moreBtn);
    attachSwipe(li, task);
    taskListEl.appendChild(li);
  });

  renderMatrix();
  renderDone();
  updateTaskCounter();
}

/** Fill the unsorted tray and the four quadrants; tasks keep their list order inside each. */
function renderMatrix() {
  const lists = {};
  taskMatrixEl.querySelectorAll('.quadrant-list').forEach((ul) => {
    ul.innerHTML = '';
    lists[ul.dataset.list] = ul;
  });
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  tasks.filter(t => !t.completed).forEach((task) => {
    const q = task.quadrant || 0;
    counts[q]++;
    lists[q].appendChild(buildMatrixChip(task));
  });
  taskMatrixEl.querySelectorAll('.quadrant-count').forEach((el) => {
    el.textContent = counts[el.dataset.count];
  });
  // Hide the tray once everything is sorted
  taskMatrixEl.querySelector('.q0').classList.toggle('is-empty', !lists[0].children.length);
}

function buildMatrixChip(task) {
  const li = document.createElement('li');
  li.className = `matrix-chip${task.completed ? ' completed' : ''}${task.id === activeTaskId ? ' selected-task' : ''}`;
  li.dataset.id = task.id;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'matrix-check';
  const shown = taskDisplayText(task.text);
  check.setAttribute('aria-label', task.completed ? `Mark "${shown}" incomplete` : `Mark "${shown}" complete`);
  check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!task.completed) {
      const r = check.getBoundingClientRect();
      celebrate('tiny', r.left + r.width / 2, r.top + r.height / 2);
      buzz(15);
    }
    toggleTask(task.id, !task.completed);
  });

  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'matrix-chip-body';
  const where = task.quadrant ? `in Q${task.quadrant} ${QUADRANTS[task.quadrant].name}` : 'unsorted';
  body.setAttribute('aria-label', `${shown}, ${where}. Tap to focus on it, drag to move, or press 1 to 4 to move, 0 to unsort.`);
  const title = document.createElement('span');
  title.className = 'matrix-chip-text';
  title.textContent = shown; // the chip is a button, so its link opens from the icon beside it
  body.appendChild(title);
  if (task.points) {
    const sp = document.createElement('span');
    sp.className = 'matrix-chip-est matrix-chip-points';
    sp.textContent = pointsLabel(task.points);
    body.appendChild(sp);
  }
  if (task.elapsed_ms || task.running) {
    const time = document.createElement('span');
    time.className = 'matrix-chip-est matrix-chip-time' + (task.running ? ' running' : '');
    time.dataset.timeFor = task.id;
    time.textContent = `⏱ ${formatElapsed(task.elapsed_ms)}`;
    body.appendChild(time);
  }
  body.addEventListener('pointerdown', (e) => startQuadrantDrag(e, li, task));
  body.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press drags, no menu
  body.addEventListener('click', () => {
    if (li.dataset.dragged) return; // the click that ends a drag is not a tap
    selectActiveTask(task);
  });
  body.addEventListener('keydown', (e) => {
    if (!/^[0-4]$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation(); // don't also switch timer modes with 1/2/3
    moveToQuadrant(task.id, Number(e.key) || null, true);
  });

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'matrix-chip-more';
  moreBtn.setAttribute('aria-label', `More actions for "${shown}"`);
  moreBtn.setAttribute('aria-haspopup', 'dialog');
  moreBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';
  moreBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTaskSheet(task);
  });

  li.append(check, body, moreBtn);
  const href = firstTaskLink(task.text);
  if (href) {
    const link = document.createElement('a');
    link.className = 'matrix-chip-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = href;
    link.setAttribute('aria-label', `Open link for "${shown}"`);
    link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7"></path><path d="M10 14 21 3"></path><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path></svg>';
    link.addEventListener('pointerdown', (e) => e.stopPropagation());
    li.appendChild(link);
  }
  attachSwipe(li, task);
  return li;
}

function moveToQuadrant(id, quadrant, refocus = false) {
  const task = tasks.find(t => t.id === id);
  if (!task || (task.quadrant || null) === quadrant) return;
  store.updateTask(id, { quadrant });
  fetchTasks();
  buzz(10);
  if (refocus) {
    const body = taskMatrixEl.querySelector(`[data-id="${CSS.escape(id)}"] .matrix-chip-body`);
    if (body) body.focus();
  }
}

/**
 * Drag a chip to another quadrant. A mouse drag starts after a few pixels of movement; on touch
 * it starts after a short press so the page can still scroll when you swipe over the matrix.
 */
function startQuadrantDrag(e, li, task) {
  if (e.button !== 0) return;
  const pointerId = e.pointerId;
  const startX = e.clientX;
  const startY = e.clientY;
  const isTouch = e.pointerType !== 'mouse';
  let ghost = null;
  let target = null;
  let pressTimer = null;
  delete li.dataset.dragged;

  const zoneAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('.task-matrix .quadrant') : null;
  };
  const begin = (x, y) => {
    gestureBusy = true;
    li.dataset.dragged = '1';
    const r = li.getBoundingClientRect();
    ghost = li.cloneNode(true);
    ghost.classList.add('matrix-ghost');
    ghost.style.width = `${r.width}px`;
    ghost.dataset.offsetX = x - r.left;
    ghost.dataset.offsetY = y - r.top;
    document.body.appendChild(ghost);
    li.classList.add('drag-source');
    taskMatrixEl.classList.add('is-dragging');
    buzz(12);
    follow(x, y);
  };
  const follow = (x, y) => {
    ghost.style.transform = `translate(${x - ghost.dataset.offsetX}px, ${y - ghost.dataset.offsetY}px) rotate(-2deg)`;
    const zone = zoneAt(x, y);
    if (zone !== target) {
      if (target) target.classList.remove('drop-target');
      target = zone;
      if (target) target.classList.add('drop-target');
    }
  };
  const onMove = (ev) => {
    if (ev.pointerId !== pointerId) return;
    const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY);
    if (!ghost) {
      if (isTouch) {
        if (moved > 10) cleanup(); // a swipe: let the page scroll
        return;
      }
      if (moved < 6) return;
      begin(ev.clientX, ev.clientY);
    }
    follow(ev.clientX, ev.clientY);
  };
  // While dragging on touch, stop the browser from scrolling instead of moving the chip
  const blockScroll = (ev) => { if (ghost) ev.preventDefault(); };
  const onEnd = (ev) => {
    if (ev.pointerId !== pointerId) return;
    const dropZone = ghost && ev.type === 'pointerup' ? target : null;
    cleanup();
    if (dropZone) moveToQuadrant(task.id, Number(dropZone.dataset.quadrant) || null);
  };
  function cleanup() {
    clearTimeout(pressTimer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);
    document.removeEventListener('touchmove', blockScroll);
    if (target) target.classList.remove('drop-target');
    if (ghost) ghost.remove();
    li.classList.remove('drag-source');
    taskMatrixEl.classList.remove('is-dragging');
    gestureBusy = false;
    // Let the click that follows pointerup see the flag, then clear it
    setTimeout(() => { delete li.dataset.dragged; }, 0);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onEnd);
  document.addEventListener('pointercancel', onEnd);
  document.addEventListener('touchmove', blockScroll, { passive: false });
  if (isTouch) pressTimer = setTimeout(() => begin(startX, startY), 280);
}

function syncActiveTaskPill() {
  const task = tasks.find(t => t.id === activeTaskId);
  if (!task) {
    activeTaskId = null;
    activeTaskPillEl.style.display = 'none';
    return;
  }
  const state = store.runningTaskId() === task.id ? '⏱' : '⏸';
  activeTaskPillEl.textContent = `🎯 ${taskDisplayText(task.text)} · ${state} ${formatElapsed(store.taskElapsedMs(task.id))}`;
  activeTaskPillEl.title = 'Click to stop focusing on this task';
  activeTaskPillEl.style.display = 'block';
}

/**
 * Focus on a task and start its own timer (any other task's timer pauses and keeps its time).
 * Selecting the task whose timer is running pauses it; selecting it again resumes.
 */
function selectActiveTask(task) {
  if (task.completed) return;
  if (store.runningTaskId() === task.id) {
    store.pauseTaskClock(); // the work clock keeps going, just not on a task
    retargetWork(null);
  } else {
    activeTaskId = task.id;
    // On a break the task is only lined up; otherwise this starts work (from idle) or splits the stretch
    if (store.getWorkState().mode !== 'break') {
      store.setWorkMode('work', task.id);
      store.startTaskClock(task.id);
    }
  }
  afterModeChange();
}

/** Stop focusing on any task: its timer pauses and keeps the time. */
function clearActiveTask() {
  if (!activeTaskId) return;
  store.pauseTaskClock();
  retargetWork(null);
  activeTaskId = null;
  afterModeChange();
}

activeTaskPillEl.setAttribute('role', 'button');
activeTaskPillEl.tabIndex = 0;
activeTaskPillEl.addEventListener('click', clearActiveTask);
activeTaskPillEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  clearActiveTask();
});

/** Tick the live time on the running task's badges and on the current-task label. */
function updateTaskClocks() {
  const id = store.runningTaskId();
  if (id) {
    const text = `⏱ ${formatElapsed(store.taskElapsedMs(id))}`;
    document.querySelectorAll(`[data-time-for="${CSS.escape(id)}"]`).forEach(el => { el.textContent = text; });
  }
  if (activeTaskId) syncActiveTaskPill();
}

function addTask(text, points = 0) {
  if (store.addTask(text, null, points)) fetchTasks();
}

function toggleTask(id, completed) {
  const task = tasks.find(t => t.id === id);
  const before = store.pointsSummary().today;
  store.updateTask(id, { completed });
  if (completed) {
    // finished: the work stretch moves on from this task (its own timer already stopped)
    if (store.getWorkState().task_id === id) retargetWork(null);
    if (activeTaskId === id) {
      activeTaskId = null;
      saveActiveTask();
    }
  }
  fetchTasks();
  loadStats();
  updateClock();
  if (!completed) return;
  document.querySelectorAll(`#task-list [data-id="${CSS.escape(id)}"], #task-matrix [data-id="${CSS.escape(id)}"]`)
    .forEach(el => el.classList.add('just-completed'));
  const spent = (tasks.find(t => t.id === id) || {}).elapsed_ms || 0;
  cheer();
  if (!task || (!task.points && !spent)) return;

  // Show the time spent and/or the new points total, celebrate crossing the daily target, offer an undo
  const parts = [];
  if (task.points) {
    const { today, goal } = store.pointsSummary();
    const targetJustHit = before < goal && today >= goal;
    if (targetJustHit) {
      celebrate('big');
      buzz([30, 60, 30]);
    }
    parts.push(targetJustHit ? `🎯 Target hit — ${today} SP today!` : `+${task.points} SP · ${today}/${goal} today`);
  }
  if (spent) parts.unshift(`✅ Done in ${formatElapsed(spent)}`);
  showToast(parts.join(' · '), {
    label: 'Undo',
    onClick: () => toggleTask(id, false),
  });
}

/** Delete straight away, with an Undo in the toast that puts the task back where it was. */
function deleteTask(id) {
  const index = tasks.findIndex(t => t.id === id);
  if (index < 0) return;
  const removed = { ...tasks[index], elapsed_ms: store.taskElapsedMs(id) };
  const wasActive = activeTaskId === id;
  if (wasActive) {
    activeTaskId = null;
    activeTaskPillEl.style.display = 'none';
    saveActiveTask();
  }
  if (store.getWorkState().task_id === id) retargetWork(null);
  store.deleteTask(id);
  fetchTasks();
  loadStats();
  showToast(`Deleted “${taskDisplayText(removed.text)}”`, {
    label: 'Undo',
    onClick: () => {
      if (!store.restoreTask(removed, index)) return;
      if (wasActive) activeTaskId = id;
      fetchTasks();
      saveActiveTask();
    },
  });
}

// ---- Bottom sheet: one place for a task's edit, move, story points and delete ----
const sheetEl = document.getElementById('task-sheet');
const sheetTitleEl = document.getElementById('task-sheet-title');
const sheetQuadrantsEl = document.getElementById('sheet-quadrants');
const sheetPointsEl = document.getElementById('sheet-points');
let sheetTaskId = null;

function sheetChip(label, pressed, onClick) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'sheet-chip';
  chip.textContent = label;
  chip.setAttribute('aria-pressed', String(pressed));
  chip.addEventListener('click', onClick);
  return chip;
}

/** Fill the sheet from the task as it is now, so a change (points) shows at once while it stays open. */
function renderSheet() {
  const task = tasks.find(t => t.id === sheetTaskId);
  if (!task) { closeTaskSheet(); return; }
  sheetTitleEl.textContent = taskDisplayText(task.text);
  sheetQuadrantsEl.textContent = '';
  [[null, 'Unsorted'], ...[1, 2, 3, 4].map(q => [q, `Q${q} · ${QUADRANTS[q].name}`])].forEach(([q, label]) => {
    sheetQuadrantsEl.appendChild(sheetChip(label, (task.quadrant || null) === q, () => {
      moveToQuadrant(task.id, q);
      closeTaskSheet();
    }));
  });
  sheetPointsEl.textContent = '';
  const values = [...taskPointsEl.options].map(o => parseInt(o.value, 10));
  if (task.points && !values.includes(task.points)) values.push(task.points);
  values.sort((a, b) => a - b).forEach((points) => {
    sheetPointsEl.appendChild(sheetChip(points ? String(points) : 'None', (task.points || 0) === points, () => {
      store.updateTask(task.id, { points });
      fetchTasks();
      renderSheet();
    }));
  });
}

function openTaskSheet(task) {
  sheetTaskId = task.id;
  renderSheet();
  if (!sheetEl.open) sheetEl.showModal();
}

function closeTaskSheet() {
  if (sheetEl.open) sheetEl.close();
}

sheetEl.addEventListener('close', () => { sheetTaskId = null; });
sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) closeTaskSheet(); }); // the backdrop
document.getElementById('task-sheet-close').addEventListener('click', closeTaskSheet);
document.getElementById('sheet-edit').addEventListener('click', () => {
  const task = tasks.find(t => t.id === sheetTaskId);
  closeTaskSheet(); // focus returns to the opener synchronously, so the editor can take it right after
  if (!task) return;
  const list = taskView === 'matrix' ? taskMatrixEl : taskListEl;
  const row = list.querySelector(`[data-id="${CSS.escape(task.id)}"]`);
  if (row) startTaskEdit(row, task);
});
document.getElementById('sheet-delete').addEventListener('click', () => {
  const id = sheetTaskId;
  closeTaskSheet();
  if (id) deleteTask(id);
});

// ---- Swipe a task row (touch and pen only): right finishes it, left opens the sheet ----
let gestureBusy = false; // a long-press drag is on: a swipe must not start under it
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const DOTS_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';

/**
 * The row follows the finger by transform; a coloured reveal grows in the gap it leaves behind. Vertical movement
 * is never touched (the row sets touch-action: pan-y), so scrolling stays the browser's. The checkbox and the
 * more button stay for everyone else: a swipe is a shortcut, never the only way.
 */
function attachSwipe(li, task) {
  const doneLayer = document.createElement('div');
  doneLayer.className = 'swipe-layer swipe-done';
  doneLayer.setAttribute('aria-hidden', 'true');
  doneLayer.innerHTML = 'Done' + CHECK_SVG;
  const moreLayer = document.createElement('div');
  moreLayer.className = 'swipe-layer swipe-more';
  moreLayer.setAttribute('aria-hidden', 'true');
  moreLayer.innerHTML = DOTS_SVG + 'More';
  li.append(doneLayer, moreLayer);

  const allow = { left: true, right: true };
  let id = -1;
  let x0 = 0;
  let y0 = 0;
  let axis = null;
  let width = 1;
  let armed = false;
  let last = { t: 0, x: 0 };
  let prev = last;
  let lastSwipe = 0;
  let resetTimer = null;

  const place = (x) => {
    li.style.transform = `translate3d(${x}px, 0, 0)`;
    doneLayer.style.display = x > 0 ? 'flex' : 'none';
    doneLayer.style.width = x > 0 ? `${x}px` : '0';
    moreLayer.style.display = x < 0 ? 'flex' : 'none';
    moreLayer.style.width = x < 0 ? `${-x}px` : '0';
  };
  const settle = () => {
    li.style.transition = 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)';
    li.style.transform = 'translate3d(0, 0, 0)';
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      li.style.transition = '';
      li.style.transform = '';
      doneLayer.style.display = 'none';
      moreLayer.style.display = 'none';
    }, 230);
  };
  const mark = (on) => {
    doneLayer.classList.toggle('armed', on);
    moreLayer.classList.toggle('armed', on);
  };

  li.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.button !== 0 || id !== -1 || gestureBusy) return;
    if (e.target.closest('.task-drag-handle, .task-edit-row, input, select, textarea') || li.querySelector('.task-edit-row')) return;
    clearTimeout(resetTimer);
    id = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    axis = null;
    armed = false;
    width = li.offsetWidth || 1;
    last = prev = { t: e.timeStamp, x: e.clientX };
  });
  li.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    if (gestureBusy) { id = -1; return; }
    const dx = e.clientX - x0;
    if (axis === null) {
      axis = lockAxis(dx, e.clientY - y0);
      if (axis === null) return;
      if (axis === 'y') { id = -1; return; }
      li.setPointerCapture(id);
      li.style.transition = 'none';
    }
    prev = last;
    last = { t: e.timeStamp, x: e.clientX };
    place(swipePull(dx, width, allow));
    const now = swipeArmed(dx, width, allow);
    if (now !== armed) {
      armed = now;
      mark(now);
      if (now) buzz(10);
    }
  });
  const end = (e, commit) => {
    if (e.pointerId !== id) return;
    const was = axis;
    const dx = e.clientX - x0;
    id = -1;
    axis = null;
    mark(false);
    if (was !== 'x') return;
    lastSwipe = Date.now();
    const verdict = commit ? swipeCommit(dx, width, (last.x - prev.x) / Math.max(1, last.t - prev.t), allow) : null;
    const r = li.getBoundingClientRect();
    settle();
    if (verdict === 'right') {
      celebrate('tiny', r.left + 24, r.top + r.height / 2);
      buzz(15);
      toggleTask(task.id, true);
    } else if (verdict === 'left') {
      openTaskSheet(task);
    }
  };
  li.addEventListener('pointerup', (e) => end(e, true));
  li.addEventListener('pointercancel', (e) => end(e, false));
  // The tap a browser may still send after a swipe must not select the row
  li.addEventListener('click', (e) => {
    if (Date.now() - lastSwipe < 350) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

/** Swap a task's title for an input; Enter or leaving the field saves, Esc cancels. */
function startTaskEdit(li, task) {
  const textSpan = li.querySelector('.task-text, .matrix-chip-body'); // list row or matrix chip
  if (!textSpan) return;
  const input = document.createElement('input');
  input.className = 'task-edit-input';
  input.value = task.text;
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Edit task');
  // Story points can be changed while editing, next to the title
  const points = taskPointsEl.cloneNode(true);
  points.removeAttribute('id');
  points.className = 'task-points task-edit-points';
  if (task.points && !points.querySelector(`option[value="${task.points}"]`)) {
    points.add(new Option(String(task.points), String(task.points)));
  }
  points.value = String(task.points || 0);

  const row = document.createElement('div');
  row.className = 'task-edit-row';
  row.append(input, points);
  textSpan.replaceWith(row);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    if (save) {
      const fields = { points: parseInt(points.value, 10) || 0 };
      if (input.value.trim() && input.value.trim() !== task.text) fields.text = input.value;
      store.updateTask(task.id, fields);
    }
    fetchTasks();
  };
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  // Moving between the title and the points picker keeps editing; leaving both saves
  row.addEventListener('focusout', (e) => {
    if (!row.contains(e.relatedTarget)) finish(true);
  });
}

function focusTaskHandle(id) {
  const handle = taskListEl.querySelector(`[data-id="${CSS.escape(id)}"] .task-drag-handle`);
  if (handle) handle.focus();
}

/** Keyboard reorder: move a task one place up (-1) or down (+1). */
function moveTaskBy(id, delta) {
  const ids = tasks.map(t => t.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  store.reorderTasks(ids);
  fetchTasks();
  focusTaskHandle(id);
}

/**
 * Pointer reorder: the row follows the pointer between siblings; order is saved on release.
 * Listens on the document because moving the row in the DOM drops pointer capture.
 */
function startTaskDrag(e, li) {
  if (e.button !== 0) return;
  e.preventDefault();
  const pointerId = e.pointerId;
  li.classList.add('dragging');

  const onMove = (ev) => {
    if (ev.pointerId !== pointerId) return;
    const others = [...taskListEl.children].filter(el => el !== li);
    const before = others.find((el) => {
      const r = el.getBoundingClientRect();
      return ev.clientY < r.top + r.height / 2;
    });
    if ((before || null) !== li.nextElementSibling) taskListEl.insertBefore(li, before || null);
  };
  const onEnd = (ev) => {
    if (ev.pointerId !== pointerId) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onEnd);
    document.removeEventListener('pointercancel', onEnd);
    li.classList.remove('dragging');
    store.reorderTasks([...taskListEl.children].map(el => el.dataset.id));
    fetchTasks();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onEnd);
  document.addEventListener('pointercancel', onEnd);
}

// ---- New activity flow (phones): one question per screen; the quick add above stays for fast capture ----
function addFromFlow({ text, points, quadrant }) {
  const task = store.addTask(text, quadrant, points);
  if (!task) return;
  fetchTasks();
  showToast(`Added to ${quadrant ? `Q${quadrant} · ${QUADRANTS[quadrant].name}` : 'Unsorted'}`);
}
window.TaskFlow.init({ onAdd: addFromFlow, quadrants: QUADRANTS });
document.getElementById('new-activity-btn').addEventListener('click', () => window.TaskFlow.open());

taskFormEl.addEventListener('submit', (e) => {
  e.preventDefault();
  addTask(taskInputEl.value, parseInt(taskPointsEl.value, 10) || 0);
  taskInputEl.value = '';
  taskPointsEl.value = '0';
});

// ====================================================
// Focus Analytics
// ====================================================
const todayFocusMinsEl = document.getElementById('today-focus-mins');
const todayBreakMinsEl = document.getElementById('today-break-mins');
const streakCountEl = document.getElementById('streak-count');
const weeklyTotalEl = document.getElementById('weekly-total');
const weeklyChartEl = document.getElementById('weekly-chart');

const goalTextEl = document.getElementById('goal-text');
const goalBarEl = document.getElementById('goal-bar-fill');
const goalTrackEl = document.getElementById('goal-bar');

function renderGoal() {
  const g = goalProgress(todayWorkMs / 60000, config.daily_goal * 60);
  const progress = `${hoursText(todayWorkMs / 60000)} / ${config.daily_goal}h`;
  goalTextEl.textContent = g.reached ? `🎉 Goal reached! ${progress}` : progress;
  goalBarEl.style.width = `${g.percent}%`;
  goalTrackEl.setAttribute('aria-valuenow', String(g.percent));
}

function loadStats() {
  const stats = store.summary();

  streakCountEl.textContent = stats.streak;

  const weeklyMins = stats.daily_breakdown.reduce((acc, d) => acc + d.minutes, 0);
  const weeklyHours = (weeklyMins / 60).toFixed(1);
  weeklyTotalEl.textContent = `${weeklyHours}h total`;

  // Render bar chart
  renderChart(stats.daily_breakdown);
  renderReview(store.weeklyReview());
  loadInsights();
}

// ---- Story points score ----
const scoreRingEl = document.getElementById('score-ring');
const scoreRingFillEl = document.getElementById('score-ring-fill');
const scoreTodayEl = document.getElementById('score-today');
const scoreOfEl = document.getElementById('score-of');
const scoreMessageEl = document.getElementById('score-message');
const scoreStreakEl = document.getElementById('score-streak');
const scoreTargetEl = document.getElementById('score-target');
const scoreTargetBtn = document.getElementById('score-target-btn');
const scoreTargetForm = document.getElementById('score-target-form');
const scoreTargetInput = document.getElementById('score-target-input');
const scoreWeekEl = document.getElementById('score-week');
const scoreOpenEl = document.getElementById('score-open');
const scoreWeekCompareEl = document.getElementById('score-week-compare');
const scoreChartEl = document.getElementById('score-chart');
const scoreDoneListEl = document.getElementById('score-done-list');
const scoreDoneEmptyEl = document.getElementById('score-done-empty');
const RING_LENGTH = 2 * Math.PI * 52;

function loadScore() {
  const p = store.pointsSummary();
  const g = goalProgress(p.today, p.goal);

  scoreTodayEl.textContent = p.today;
  scoreOfEl.textContent = `of ${p.goal} SP`;
  scoreTargetEl.textContent = p.goal;
  scoreStreakEl.textContent = p.streak;
  scoreRingFillEl.style.strokeDasharray = String(RING_LENGTH);
  scoreRingFillEl.style.strokeDashoffset = String(RING_LENGTH * (1 - g.percent / 100));
  scoreRingEl.setAttribute('aria-valuenow', String(g.percent));
  scoreRingEl.setAttribute('aria-valuetext', `${p.today} of ${p.goal} story points`);
  scoreRingEl.classList.toggle('reached', g.reached);
  if (g.reached) {
    scoreMessageEl.textContent = p.today > p.goal ? `🎉 Target hit, ${p.today - p.goal} SP over!` : '🎉 Target hit — nice work!';
  } else if (p.today === 0) {
    scoreMessageEl.textContent = p.open_points ? `${p.open_points} SP waiting in your tasks. Finish one to score.` : 'Give a task story points, then finish it to score.';
  } else {
    scoreMessageEl.textContent = `${p.goal - p.today} SP to go`;
  }

  scoreWeekEl.textContent = pointsLabel(p.week_total);
  scoreOpenEl.textContent = pointsLabel(p.open_points);
  const diff = p.week_total - p.last_week_total;
  scoreWeekCompareEl.textContent = `${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} vs ${p.last_week_total} SP the week before`;

  renderScoreChart(p.daily_breakdown, p.goal);

  scoreDoneListEl.innerHTML = '';
  p.today_tasks.forEach((t) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'score-done-text';
    text.textContent = taskDisplayText(t.text);
    const pts = document.createElement('span');
    pts.className = 'score-done-points';
    pts.textContent = `+${t.points}`;
    li.append(text, pts);
    scoreDoneListEl.appendChild(li);
  });
  scoreDoneEmptyEl.classList.toggle('visible', p.today_tasks.length === 0);
}

/** 7 bars of points per day with a dashed line at the daily target. */
function renderScoreChart(days, goal) {
  scoreChartEl.innerHTML = '';
  const max = Math.max(goal, ...days.map(d => d.points), 1);
  scoreChartEl.style.setProperty('--target', `${Math.round((goal / max) * 100)}%`);
  scoreChartEl.setAttribute('aria-label', `Story points for the last 7 days, target ${goal}: ` +
    days.map(d => `${d.label} ${d.points}`).join(', '));
  days.forEach((day) => {
    const col = document.createElement('div');
    col.className = 'chart-bar-col';
    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-fill-wrap';
    const bar = document.createElement('div');
    bar.className = `chart-bar-fill${day.points >= goal ? ' hit' : ''}`;
    bar.style.height = day.points ? `${Math.max(4, Math.round((day.points / max) * 100))}%` : '0';
    bar.title = `${day.label}: ${day.points} SP`;
    wrap.appendChild(bar);
    const label = document.createElement('span');
    label.className = 'chart-bar-label';
    label.textContent = day.label;
    col.append(wrap, label);
    scoreChartEl.appendChild(col);
  });
}

function closeScoreTarget() {
  scoreTargetForm.hidden = true;
  scoreTargetBtn.hidden = false;
}

scoreTargetBtn.addEventListener('click', () => {
  scoreTargetInput.value = config.daily_points_goal;
  scoreTargetBtn.hidden = true;
  scoreTargetForm.hidden = false;
  scoreTargetInput.focus();
  scoreTargetInput.select();
});

scoreTargetForm.addEventListener('submit', (e) => {
  e.preventDefault();
  config = { ...config, ...store.saveSettings({ daily_points_goal: parseInt(scoreTargetInput.value, 10) }) };
  fillSettingsForm();
  closeScoreTarget();
  loadScore();
  scoreTargetBtn.focus();
});

scoreTargetInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  closeScoreTarget();
  scoreTargetBtn.focus();
});

// ---- Weekly review ----
const reviewChangeEl = document.getElementById('review-change');
const reviewHoursEl = document.getElementById('review-hours');
const reviewCompareEl = document.getElementById('review-compare');
const reviewSessionsEl = document.getElementById('review-sessions');
const reviewBestDayEl = document.getElementById('review-best-day');
const reviewTopTaskEl = document.getElementById('review-top-task');
const reviewLongestStreakEl = document.getElementById('review-longest-streak');

const hoursText = (minutes) => `${(minutes / 60).toFixed(1)}h`;

function renderReview(r) {
  reviewHoursEl.textContent = hoursText(r.this_week.minutes);
  reviewCompareEl.textContent = `last 7 days · ${hoursText(r.last_week.minutes)} the week before`;

  const change = r.change_percent;
  reviewChangeEl.classList.remove('up', 'down');
  reviewChangeEl.classList.toggle('muted', change === null || change === 0);
  if (change === null) {
    reviewChangeEl.textContent = r.this_week.minutes > 0 ? 'New' : '—';
    reviewChangeEl.title = 'Nothing to compare with yet';
  } else {
    reviewChangeEl.textContent = change > 0 ? `▲ ${change}%` : change < 0 ? `▼ ${Math.abs(change)}%` : '= 0%';
    if (change !== 0) reviewChangeEl.classList.add(change > 0 ? 'up' : 'down');
    reviewChangeEl.title = 'Compared with the previous 7 days';
  }

  reviewSessionsEl.textContent = r.this_week.sessions;
  reviewBestDayEl.textContent = r.best_day ? `${r.best_day.label} · ${Math.round(r.best_day.minutes)}m` : '—';
  reviewTopTaskEl.textContent = r.top_task ? `${taskDisplayText(r.top_task.label)} · ${Math.round(r.top_task.minutes)}m` : '—';
  reviewLongestStreakEl.textContent = `${r.longest_streak} ${r.longest_streak === 1 ? 'day' : 'days'}`;
}

// ---- Insights: heatmap + focus by task ----
const heatmapEl = document.getElementById('heatmap');
const heatmapTotalEl = document.getElementById('heatmap-total');
const taskStatsEl = document.getElementById('task-stats');
const taskStatsEmptyEl = document.getElementById('task-stats-empty');
const heatmapDetailEl = document.getElementById('heatmap-detail');
const weekDetailEl = document.getElementById('week-detail');

let selectedHeatDay = null;
let selectedWeekDay = null;

/** 'Tue, Oct 28' for a 'YYYY-MM-DD' key. */
function dayLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Fill a day-detail panel with that day's totals and focus per task, or hide it when no day is picked. */
function renderDayDetail(el, dateKey, onClose) {
  el.innerHTML = '';
  el.hidden = !dateKey;
  if (!dateKey) return;
  const d = store.dayDetail(dateKey);

  const head = document.createElement('div');
  head.className = 'day-detail-head';
  const title = document.createElement('strong');
  title.textContent = dayLabel(dateKey);
  const total = document.createElement('span');
  total.className = 'day-detail-total';
  total.textContent = d.sessions ? `${Math.round(d.minutes)} min · ${d.sessions} ${d.sessions === 1 ? 'session' : 'sessions'}` : 'No focus';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'day-detail-close';
  close.setAttribute('aria-label', 'Close day details');
  close.textContent = '×';
  close.addEventListener('click', onClose);
  head.append(title, total, close);
  el.appendChild(head);

  if (!d.tasks.length) {
    const empty = document.createElement('p');
    empty.className = 'day-detail-empty';
    empty.textContent = 'No focus sessions this day.';
    el.appendChild(empty);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'day-detail-list';
  d.tasks.forEach((t) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = taskDisplayText(t.label);
    const meta = document.createElement('span');
    meta.className = 'day-detail-meta';
    meta.textContent = `${t.sessions} ${t.sessions === 1 ? 'session' : 'sessions'} · ${Math.round(t.minutes)}m`;
    li.append(name, meta);
    list.appendChild(li);
  });
  el.appendChild(list);
}

function renderHeatmap(days) {
  heatmapEl.innerHTML = '';
  const max = Math.max(...days.map(d => d.minutes), 0);
  if (selectedHeatDay && !days.some(d => d.date === selectedHeatDay)) selectedHeatDay = null;
  const focusDate = selectedHeatDay || (days.length ? days[days.length - 1].date : null);
  heatmapCells(days).forEach(day => {
    if (!day) {
      const blank = document.createElement('span');
      blank.className = 'heat-cell empty';
      heatmapEl.appendChild(blank);
      return;
    }
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `heat-cell level-${heatLevel(day.minutes, max)}${day.date === selectedHeatDay ? ' selected' : ''}`;
    cell.dataset.date = day.date;
    cell.tabIndex = day.date === focusDate ? 0 : -1;
    const text = `${dayLabel(day.date)}: ${Math.round(day.minutes)} min, ${day.sessions} ${day.sessions === 1 ? 'session' : 'sessions'}`;
    cell.title = text;
    cell.setAttribute('aria-label', text);
    cell.setAttribute('aria-pressed', String(day.date === selectedHeatDay));
    cell.addEventListener('click', () => {
      selectedHeatDay = selectedHeatDay === day.date ? null : day.date;
      loadInsights();
      focusHeatCell(day.date);
    });
    heatmapEl.appendChild(cell);
  });
  renderDayDetail(heatmapDetailEl, selectedHeatDay, () => {
    selectedHeatDay = null;
    loadInsights();
  });
  const hours = days.reduce((acc, d) => acc + d.minutes, 0) / 60;
  heatmapTotalEl.textContent = `${hours.toFixed(1)}h`;
}

function focusHeatCell(date) {
  const cell = heatmapEl.querySelector(`[data-date="${date}"]`);
  if (cell) cell.focus();
}

// Columns are weeks and rows are weekdays, so Up/Down move a day and Left/Right a week.
heatmapEl.addEventListener('keydown', (e) => {
  const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
  if (!step || !e.target.dataset.date) return;
  e.preventDefault();
  const cells = [...heatmapEl.querySelectorAll('button.heat-cell')];
  const next = cells[Math.min(cells.length - 1, Math.max(0, cells.indexOf(e.target) + step))];
  e.target.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
});

function renderTaskStats(rows) {
  taskStatsEl.innerHTML = '';
  taskStatsEmptyEl.classList.toggle('visible', rows.length === 0);
  const max = Math.max(...rows.map(r => r.minutes), 1);
  rows.forEach(row => {
    const li = document.createElement('li');
    li.className = 'task-stat-row';
    const name = document.createElement('span');
    name.className = 'task-stat-name';
    name.textContent = taskDisplayText(row.label);
    const meta = document.createElement('span');
    meta.className = 'task-stat-meta';
    meta.textContent = `${row.sessions} ${row.sessions === 1 ? 'session' : 'sessions'} · ${Math.round(row.minutes)}m`;
    const bar = document.createElement('span');
    bar.className = 'task-stat-bar';
    bar.style.width = `${Math.max(4, Math.round((row.minutes / max) * 100))}%`;
    li.append(name, meta, bar);
    taskStatsEl.appendChild(li);
  });
}

// ---- Developer view: time by ticket or repo, sizing check, work in progress ----
const wipNoteEl = document.getElementById('wip-note');
const streamListEl = document.getElementById('stream-list');
const streamEmptyEl = document.getElementById('stream-empty');
const sizingListEl = document.getElementById('sizing-list');
const sizingEmptyEl = document.getElementById('sizing-empty');
const sizingVerdictEl = document.getElementById('sizing-verdict');

/** "45m" or "2h 05m". */
function durationText(minutes) {
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

function statRow(nameEl, metaText, fraction, muted, extraClass = '') {
  const li = document.createElement('li');
  li.className = 'task-stat-row' + (muted ? ' muted' : '') + (extraClass ? ` ${extraClass}` : '');
  const name = document.createElement('span');
  name.className = 'task-stat-name';
  name.appendChild(nameEl);
  const meta = document.createElement('span');
  meta.className = 'task-stat-meta';
  meta.textContent = metaText;
  li.append(name, meta);
  if (fraction !== null) {
    const bar = document.createElement('span');
    bar.className = 'task-stat-bar';
    bar.style.width = `${Math.max(4, Math.round(fraction * 100))}%`;
    li.appendChild(bar);
  }
  return li;
}

function renderDevMetrics() {
  const tasks = store.listTasks();
  const now = new Date();

  // Work in progress: a pile of started tasks means little is finishing
  const wip = wipTasks(tasks).length;
  wipNoteEl.hidden = wip < 3;
  if (wip >= 3) wipNoteEl.textContent = `${wip} tasks are started but not finished. Finish one before starting another: fewer open tasks finish sooner.`;

  // Time by ticket or repo (last 7 days)
  const { totalSeconds, linkedSeconds, streams } = timeBySource(tasks, store.listFocusSessions(), now);
  streamListEl.innerHTML = '';
  streamEmptyEl.classList.toggle('visible', streams.length === 0);
  const maxSeconds = Math.max(...streams.map((s) => s.seconds), 1);
  streams.slice(0, 6).forEach((s) => {
    const link = document.createElement('a');
    link.className = 'task-link';
    link.href = s.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = s.href;
    link.textContent = s.label;
    const parts = [`${s.tasks} ${s.tasks === 1 ? 'task' : 'tasks'}`];
    if (s.done > 0) parts.push(`${s.done} done${s.points ? ` · ${s.points} SP` : ''}`);
    parts.push(durationText(s.seconds / 60));
    streamListEl.appendChild(statRow(link, parts.join(' · '), s.seconds / maxSeconds, false, 'stream-row'));
  });
  if (streams.length > 0 && totalSeconds > linkedSeconds) {
    const none = document.createElement('span');
    none.textContent = 'No link';
    streamListEl.appendChild(statRow(none, durationText((totalSeconds - linkedSeconds) / 60), null, true));
  }

  // Sizing check: does a bigger story point value really take longer? (last 4 weeks)
  const sizing = sizingCheck(tasks, now);
  sizingListEl.innerHTML = '';
  sizingEmptyEl.classList.toggle('visible', sizing.rows.length === 0);
  const maxMs = Math.max(...sizing.rows.map((r) => r.avgMs), 1);
  sizing.rows.forEach((r) => {
    const label = document.createElement('span');
    label.textContent = `${r.points} SP`;
    sizingListEl.appendChild(statRow(label, `${durationText(r.avgMs / 60000)} · ${r.tasks}×`, r.avgMs / maxMs, false));
  });
  const verdict = sizingVerdictText(sizing);
  sizingVerdictEl.hidden = verdict === '';
  sizingVerdictEl.textContent = verdict;
}

function loadInsights() {
  renderHeatmap(store.heatmap(84));
  renderTaskStats(store.taskStats());
  renderDevMetrics();
}

/** Build a file in the browser and hand it to the user as a download. */
function downloadFile(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

document.getElementById('export-csv-link').addEventListener('click', (e) => {
  e.preventDefault();
  downloadFile('focus-log-sessions.csv', store.sessionsCsv(), 'text/csv;charset=utf-8');
});

function renderChart(dailyData) {
  weeklyChartEl.innerHTML = '';
  const maxMins = Math.max(...dailyData.map(d => d.minutes), 60); // minimum scale 60m
  if (selectedWeekDay && !dailyData.some(d => d.date === selectedWeekDay)) selectedWeekDay = null;

  dailyData.forEach(day => {
    const col = document.createElement('button');
    col.type = 'button';
    col.className = `chart-bar-col${day.date === selectedWeekDay ? ' selected' : ''}`;
    col.setAttribute('aria-label', `${dayLabel(day.date)}: ${Math.round(day.minutes)} min`);
    col.setAttribute('aria-pressed', String(day.date === selectedWeekDay));
    col.addEventListener('click', () => {
      selectedWeekDay = selectedWeekDay === day.date ? null : day.date;
      renderChart(dailyData);
      const again = weeklyChartEl.children[dailyData.indexOf(day)];
      if (again) again.focus();
    });

    const wrap = document.createElement('div');
    wrap.className = 'chart-bar-fill-wrap';

    const bar = document.createElement('div');
    bar.className = 'chart-bar-fill';
    const percentHeight = Math.max(4, Math.round((day.minutes / maxMins) * 100));
    bar.style.height = `${percentHeight}%`;
    bar.title = `${day.label}: ${day.minutes} mins`;

    wrap.appendChild(bar);

    const label = document.createElement('span');
    label.className = 'chart-bar-label';
    label.textContent = day.label;

    col.appendChild(wrap);
    col.appendChild(label);
    weeklyChartEl.appendChild(col);
  });
  renderDayDetail(weekDetailEl, selectedWeekDay, () => {
    selectedWeekDay = null;
    renderChart(dailyData);
  });
}

// ====================================================
// Theme (light / dark)
// ====================================================
const themeToggleBtn = document.getElementById('theme-toggle-btn');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.setAttribute('aria-pressed', String(theme === 'dark'));
  try { localStorage.setItem(UI_KEYS.theme, theme); } catch (e) { /* ignore */ }
}

themeToggleBtn.addEventListener('click', () => {
  const next = config.theme === 'dark' ? 'light' : 'dark';
  config.theme = next;
  applyTheme(next);
  store.saveSettings({ theme: next });
});

// ====================================================
// Timer Preferences Modal (Esc to close, focus trap, focus restore)
// ====================================================
const settingsModal = document.getElementById('settings-modal');
const openSettingsBtn = document.getElementById('open-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingsForm = document.getElementById('settings-form');

const settingGoalInput = document.getElementById('setting-goal');
const settingPointsGoalInput = document.getElementById('setting-points-goal');
const settingSoundInput = document.getElementById('setting-sound');
const settingCharacterInput = document.getElementById('setting-character');

let lastFocusedBeforeModal = null;

function openSettings() {
  lastFocusedBeforeModal = document.activeElement;
  settingsModal.classList.add('open');
  settingsModal.setAttribute('aria-hidden', 'false');
  settingGoalInput.focus();
}

function closeSettings() {
  settingsModal.classList.remove('open');
  settingsModal.setAttribute('aria-hidden', 'true');
  if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) lastFocusedBeforeModal.focus();
}

openSettingsBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

settingsModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSettings();
    return;
  }
  if (e.key !== 'Tab') return;
  const focusable = settingsModal.querySelectorAll('button, input, select, [href], [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

function fillSettingsForm() {
  settingGoalInput.value = config.daily_goal;
  settingPointsGoalInput.value = config.daily_points_goal;
  settingSoundInput.checked = Boolean(config.cat_sound);
  settingCharacterInput.value = config.character;
}

function loadSettings() {
  config = { ...config, ...store.getSettings() };
  fillSettingsForm();
  applyCharacter();
  applyTheme(config.theme);
  renderGoal();
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const updated = {
    daily_goal: parseInt(settingGoalInput.value, 10),
    daily_points_goal: parseInt(settingPointsGoalInput.value, 10),
    cat_sound: settingSoundInput.checked ? 1 : 0,
    character: settingCharacterInput.value
  };

  config = { ...config, ...store.saveSettings(updated) };
  closeSettings();
  applyCharacter();
  renderGoal();
  loadScore();
  updateClock();
});

// ====================================================
// PWA: service worker registration and install prompt
// ====================================================
const installBtnEl = document.getElementById('install-btn');
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // show our own button instead of the mini-infobar
  deferredInstallPrompt = e;
  installBtnEl.hidden = false;
});

installBtnEl.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  try {
    await deferredInstallPrompt.userChoice;
  } catch (e) { /* prompt was dismissed */ }
  deferredInstallPrompt = null;
  installBtnEl.hidden = true;
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  installBtnEl.hidden = true;
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch((err) => {
    console.error('Service worker registration failed', err);
  });
}

// ====================================================
// Backup: export / import everything as JSON
// ====================================================
const importBackupInputEl = document.getElementById('import-backup-input');
const dataStatusEl = document.getElementById('data-status');

function setDataStatus(text, isError = false) {
  dataStatusEl.textContent = text;
  dataStatusEl.classList.toggle('error', isError);
}

document.getElementById('export-backup-btn').addEventListener('click', () => {
  const day = window.FocusLogStore.localDayKey(new Date());
  downloadFile(`focus-log-backup-${day}.json`, JSON.stringify(store.exportBackup(), null, 2), 'application/json');
  setDataStatus('Backup downloaded.');
});

document.getElementById('import-backup-btn').addEventListener('click', () => importBackupInputEl.click());

importBackupInputEl.addEventListener('change', async () => {
  const file = importBackupInputEl.files[0];
  importBackupInputEl.value = ''; // allow picking the same file again
  if (!file) return;
  try {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      throw new Error('This file is not a Focus Log backup.');
    }
    const added = store.importBackup(data);
    loadSettings();
    fetchTasks();
    loadStats();
    updateClock();
    setDataStatus(`Imported ${added.tasks} new ${added.tasks === 1 ? 'task' : 'tasks'} and ${added.sessions} new ${added.sessions === 1 ? 'session' : 'sessions'}.`);
  } catch (err) {
    setDataStatus(err.message, true);
  }
});

// ====================================================
// Feedback: toast with an optional action, confetti, haptics
// ====================================================
const toastEl = document.getElementById('toast');
const toastTextEl = document.getElementById('toast-text');
const toastActionEl = document.getElementById('toast-action');
const confettiCanvas = document.getElementById('confetti');
const TOAST_MS = 6000;
let toastTimer = null;
let toastOnAction = null;

/** Show a short message at the bottom; `action` = {label, onClick} adds a button (e.g. Undo). */
function showToast(text, action = null) {
  clearTimeout(toastTimer);
  toastTextEl.textContent = text;
  toastOnAction = action ? action.onClick : null;
  toastActionEl.hidden = !action;
  toastActionEl.textContent = action ? action.label : '';
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add('show'));
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastOnAction = null;
  toastEl.classList.remove('show');
  setTimeout(() => { if (!toastEl.classList.contains('show')) toastEl.hidden = true; }, 250);
}

toastActionEl.addEventListener('click', () => {
  const run = toastOnAction;
  hideToast();
  if (run) run();
});
document.getElementById('toast-close').addEventListener('click', hideToast);
// Keep the toast up while the pointer or keyboard is on it
toastEl.addEventListener('pointerenter', () => clearTimeout(toastTimer));
toastEl.addEventListener('pointerleave', () => { if (!toastEl.hidden) toastTimer = setTimeout(hideToast, TOAST_MS / 2); });
toastEl.addEventListener('focusin', () => clearTimeout(toastTimer));

function buzz(pattern) {
  // Browsers block vibration until the user has interacted with the page (e.g. a timer restored on load)
  const activated = !navigator.userActivation || navigator.userActivation.hasBeenActive;
  if (navigator.vibrate && activated) {
    try { navigator.vibrate(pattern); } catch (e) { /* not allowed without a gesture */ }
  }
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let confettiPieces = [];
let confettiFrame = null;

/**
 * Burst of confetti: 'tiny' from a point (task done), 'small' from the timer (session done),
 * 'big' across the screen (daily goal). Skipped when the user asks for less motion.
 */
function celebrate(size = 'small', x, y) {
  if (prefersReducedMotion.matches) return;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (confettiCanvas.width !== w * dpr || confettiCanvas.height !== h * dpr) {
    confettiCanvas.width = w * dpr;
    confettiCanvas.height = h * dpr;
  }
  const styles = getComputedStyle(document.documentElement);
  const colors = ['--accent-focus', '--accent-short', '--accent-long', '--theme-ring']
    .map(v => styles.getPropertyValue(v).trim()).concat('#ffd166');
  if (x === undefined) {
    const ring = document.querySelector('.timer-circle').getBoundingClientRect();
    x = ring.left + ring.width / 2;
    y = ring.top + ring.height / 2;
  }
  const count = size === 'big' ? 160 : size === 'small' ? 70 : 18;
  const speed = size === 'tiny' ? 5 : 11;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const v = speed * (0.4 + Math.random() * 0.8);
    confettiPieces.push({
      x: size === 'big' ? Math.random() * w : x,
      y: size === 'big' ? -10 - Math.random() * h * 0.3 : y,
      vx: Math.cos(angle) * v,
      vy: size === 'big' ? Math.random() * 3 : Math.sin(angle) * v - 3,
      size: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length],
      life: size === 'big' ? 200 : size === 'small' ? 110 : 45,
    });
  }
  if (!confettiFrame) confettiFrame = requestAnimationFrame(drawConfetti);
}

function drawConfetti() {
  const dpr = window.devicePixelRatio || 1;
  const ctx = confettiCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiPieces = confettiPieces.filter(p => p.life > 0 && p.y < window.innerHeight + 20);
  confettiPieces.forEach((p) => {
    p.vx *= 0.98;
    p.vy = p.vy * 0.98 + 0.25;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.spin;
    p.life--;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life / 30);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    ctx.restore();
  });
  confettiFrame = confettiPieces.length ? requestAnimationFrame(drawConfetti) : null;
  if (!confettiFrame) ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

// ====================================================
// Phone bottom tabs: Timer / Tasks / Stats (CSS ignores data-view from 720px up)
// ====================================================
const VIEW_KEY = UI_KEYS.view;
const VIEWS = ['timer', 'tasks', 'stats'];
const bottomNavBtns = document.querySelectorAll('.bottom-nav-btn');

function setView(view) {
  if (!VIEWS.includes(view)) view = 'timer';
  const changed = bodyEl.dataset.view !== view;
  bodyEl.dataset.view = view;
  bottomNavBtns.forEach((btn) => {
    if (btn.dataset.view === view) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  if (changed) window.scrollTo(0, 0);
  try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* ignore */ }
}

bottomNavBtns.forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));

// Initialization: settings first (durations depend on them), then restore the timer
(function init() {
  try { setView(localStorage.getItem(VIEW_KEY)); } catch (e) { setView('timer'); }
  try { setTaskView(localStorage.getItem(TASK_VIEW_KEY)); } catch (e) { setTaskView('list'); }
  try {
    activeTaskId = localStorage.getItem(ACTIVE_TASK_KEY);
  } catch (e) { /* storage unavailable */ }
  // The task whose timer kept running while the page was closed is the focused one
  activeTaskId = store.runningTaskId() || activeTaskId;
  loadSettings();
  fetchTasks();
  loadStats();
  updateClock();
  goalPrimed = true;
  registerServiceWorker();
})();
