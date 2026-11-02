// Pomodoro Focus Dashboard - State, Timer, localStorage persistence, & Web Audio Integration
// Pure timer helpers live in timer-core.js and the data layer in store.js (both unit-tested).

const store = window.PomodoroStore.createStore(window.localStorage);
const { heatLevel, heatmapCells, estimateLabel, modeDuration, remainingSeconds, nextMode, snapshot, restore, formatTime, goalProgress, shortcutAction, STORAGE_KEY } = window.TimerCore;

let config = {
  focus_duration: 25,
  short_break: 5,
  long_break: 15,
  long_break_interval: 4,
  auto_start: 0,
  daily_goal: 4,
  theme: 'light'
};

let currentMode = 'focus';
let totalDuration = modeDuration('focus', config);
let timeLeft = totalDuration;
let endsAt = null;
let timerId = null;
let isRunning = false;
let completedFocusCycles = 0;
let activeTaskId = null;
let todaySessions = 0;

// DOM Elements
const bodyEl = document.body;
const timeDisplayEl = document.getElementById('time-display');
const modeStatusEl = document.getElementById('mode-status');
const activeTaskPillEl = document.getElementById('active-task-pill');
const startBtnEl = document.getElementById('start-btn');
const startTextEl = document.getElementById('start-text');
const startIconEl = document.getElementById('start-icon');
const resetBtnEl = document.getElementById('reset-btn');
const tabButtons = document.querySelectorAll('.tab-btn');
const progressCircle = document.querySelector('.progress-ring-circle');
const navTimerLabelEl = document.getElementById('nav-timer-label');

// Progress ring setup
const radius = progressCircle.r.baseVal.value;
const circumference = 2 * Math.PI * radius;
progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
progressCircle.style.strokeDashoffset = '0';

function setProgress(percent) {
  const offset = circumference - (percent / 100) * circumference;
  progressCircle.style.strokeDashoffset = offset;
}

function modeTitle(mode) {
  return mode === 'focus' ? 'Focus' : mode === 'shortBreak' ? 'Short Break' : 'Long Break';
}

function updateDisplay() {
  const formatted = formatTime(timeLeft);
  timeDisplayEl.textContent = formatted;
  document.title = `${formatted} - ${modeTitle(currentMode)}`;

  const percent = ((totalDuration - timeLeft) / totalDuration) * 100;
  setProgress(percent);
  updateNavTimer();
}

/** On phones the Timer tab shows the countdown while it runs, so it stays visible from other tabs. */
function updateNavTimer() {
  navTimerLabelEl.textContent = isRunning ? formatTime(timeLeft) : 'Timer';
}

function setButtonState(running) {
  updateNavTimer();
  if (running) {
    startTextEl.textContent = 'Pause';
    startIconEl.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    startBtnEl.classList.remove('paused');
  } else {
    startTextEl.textContent = 'Start';
    startIconEl.innerHTML = '<path d="M8 5v14l11-7z"/>';
    if (timeLeft < totalDuration && timeLeft > 0) {
      startBtnEl.classList.add('paused');
    } else {
      startBtnEl.classList.remove('paused');
    }
  }
}

// ---- Persistence: survive page refresh ----
function saveTimerState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot({
      mode: currentMode, running: isRunning, timeLeft, completedCycles: completedFocusCycles, activeTaskId
    }, Date.now())));
  } catch (e) { /* storage unavailable */ }
}

function tick() {
  timeLeft = remainingSeconds(endsAt, Date.now());
  updateDisplay();
  if (timeLeft <= 0) {
    handleSessionComplete();
  }
}

function startTimer() {
  if (isRunning) return;
  window.ambientSound.init(); // unlock audio on a user gesture so the end chime can play
  requestNotificationPermission();
  isRunning = true;
  buzz(10);
  endsAt = Date.now() + timeLeft * 1000;
  setButtonState(true);
  // Wall-clock based: ticking faster than 1s keeps the display accurate when throttled.
  timerId = setInterval(tick, 250);
  saveTimerState();
}

function pauseTimer(silent = false) {
  if (!isRunning) return;
  if (!silent) buzz(10);
  clearInterval(timerId);
  timerId = null;
  timeLeft = remainingSeconds(endsAt, Date.now());
  endsAt = null;
  isRunning = false;
  setButtonState(false);
  saveTimerState();
}

function resetTimer() {
  pauseTimer();
  timeLeft = totalDuration;
  modeStatusEl.textContent = currentMode === 'focus' ? 'Stay Focused' : 'Rest & Recharge';
  updateDisplay();
  setButtonState(false);
  saveTimerState();
}

// ---- End-of-session alerts ----
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function notifySessionEnd(finishedMode, upcomingMode) {
  window.ambientSound.chime();
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const title = `${modeTitle(finishedMode)} complete`;
  const options = {
    body: `Up next: ${modeTitle(upcomingMode)}`,
    tag: 'pomodoro-session-end',
    renotify: true,
    icon: 'icons/icon-192.png',
    vibrate: [200, 100, 200]
  };
  const viaPage = () => {
    try { new Notification(title, options); } catch (e) { /* page notifications unsupported */ }
  };
  // Android Chrome only allows notifications from a service worker, so prefer it when present.
  if (!('serviceWorker' in navigator)) return viaPage();
  navigator.serviceWorker.getRegistration()
    .then((reg) => (reg ? reg.showNotification(title, options) : viaPage()))
    .catch(viaPage);
}

function handleSessionComplete() {
  pauseTimer(true);
  const finishedMode = currentMode;
  const finishedDuration = totalDuration;
  const finishedTaskId = activeTaskId;

  if (finishedMode === 'focus') completedFocusCycles++;
  const upcoming = nextMode(finishedMode, completedFocusCycles, config.long_break_interval);

  notifySessionEnd(finishedMode, upcoming);
  switchMode(upcoming);
  modeStatusEl.textContent = 'Session Complete!';
  if (config.auto_start) startTimer();
  saveTimerState();

  let message = `${modeTitle(finishedMode)} complete`;
  if (finishedMode === 'focus') {
    const sessionsBefore = todaySessions;
    store.logSession({ mode: 'focus', duration_seconds: finishedDuration, task_id: finishedTaskId });
    loadStats();
    fetchTasks();
    const goalJustReached = sessionsBefore < config.daily_goal && todaySessions >= config.daily_goal;
    if (goalJustReached) message = `🎉 Daily goal reached — ${todaySessions} sessions today!`;
    else message = `🍅 ${Math.round(finishedDuration / 60)} min of focus logged`;
    celebrate(goalJustReached ? 'big' : 'small');
  }
  buzz([200, 100, 200]);
  showToast(message, config.auto_start ? null : {
    label: upcoming === 'focus' ? 'Start focus' : 'Start break',
    onClick: startTimer,
  });
}

function switchMode(newMode) {
  pauseTimer();
  currentMode = newMode;
  totalDuration = modeDuration(newMode, config);
  modeStatusEl.textContent = newMode === 'focus' ? 'Stay Focused'
    : newMode === 'shortBreak' ? 'Rest & Recharge' : 'Long Refresh';

  timeLeft = totalDuration;
  bodyEl.setAttribute('data-mode', newMode);

  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === newMode);
  });

  updateDisplay();
  setButtonState(false);
  saveTimerState();
}

function toggleTimer() {
  if (isRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
}

// Timer Controls Listeners
startBtnEl.addEventListener('click', toggleTimer);
resetBtnEl.addEventListener('click', resetTimer);

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const selectedMode = btn.dataset.mode;
    if (selectedMode !== currentMode) {
      switchMode(selectedMode);
    }
  });
});

// Keyboard shortcuts: Space start/pause, R reset, 1/2/3 switch mode
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (settingsModal.classList.contains('open')) return;
  const action = shortcutAction(e.key, e.target);
  if (!action) return;
  e.preventDefault();
  if (action === 'toggle') toggleTimer();
  else if (action === 'reset') resetTimer();
  else if (action !== currentMode) switchMode(action);
});

// Recompute immediately when the tab becomes visible again
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isRunning) tick();
});

/** Restore a persisted timer after settings are loaded (durations depend on config). */
function restoreTimerState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  const saved = restore(raw, Date.now(), config);
  if (!saved) {
    switchMode(currentMode); // apply configured durations
    return;
  }

  completedFocusCycles = saved.completedCycles;
  activeTaskId = saved.activeTaskId;
  switchMode(saved.mode);
  if (saved.expired) {
    timeLeft = 0;
    handleSessionComplete();
    return;
  }
  timeLeft = saved.timeLeft;
  updateDisplay();
  if (saved.running) startTimer(); else setButtonState(false);
}

// ====================================================
// Task Tracker (localStorage)
// ====================================================
const taskFormEl = document.getElementById('task-form');
const taskInputEl = document.getElementById('task-input');
const taskEstimateEl = document.getElementById('task-estimate');
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
const TASK_VIEW_KEY = 'pomodoro-task-view';
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
}

function updateTaskCounter() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  taskCounterEl.textContent = `${completed}/${total}`;
  const open = total - completed;
  navTasksBadgeEl.hidden = open === 0;
  navTasksBadgeEl.textContent = open;
  if (total === 0) {
    taskEmptyStateEl.classList.add('visible');
  } else {
    taskEmptyStateEl.classList.remove('visible');
  }
}

function renderTasks() {
  taskListEl.innerHTML = '';

  tasks.forEach((task) => {
    const li = document.createElement('li');
    li.className = `task-item ${task.completed ? 'completed' : ''} ${task.id === activeTaskId ? 'selected-task' : ''}`;
    li.dataset.id = task.id;

    // Drag handle: pointer drag (mouse + touch) or ArrowUp/ArrowDown to reorder
    const handle = document.createElement('button');
    handle.className = 'task-drag-handle';
    handle.type = 'button';
    handle.setAttribute('aria-label', `Reorder "${task.text}" (drag, or use arrow keys)`);
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
    textSpan.textContent = task.text;
    textSpan.addEventListener('click', () => selectActiveTask(task));

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'task-edit-btn';
    editBtn.type = 'button';
    editBtn.setAttribute('aria-label', 'Edit task');
    editBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>
      </svg>
    `;
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startTaskEdit(li, task);
    });

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'task-delete-btn';
    deleteBtn.type = 'button';
    deleteBtn.setAttribute('aria-label', 'Delete task');
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    // Title with the estimate badge underneath, so the title keeps its width on phones
    const main = document.createElement('div');
    main.className = 'task-main';
    main.appendChild(textSpan);

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    const label = estimateLabel(task.actual, task.estimate);
    if (label) {
      const est = document.createElement('span');
      est.className = 'task-estimate-badge' + (task.estimate && task.actual > task.estimate ? ' over' : '');
      est.textContent = label;
      est.title = task.estimate ? `${task.actual} done of ${task.estimate} estimated` : `${task.actual} done`;
      meta.appendChild(est);
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
    li.appendChild(editBtn);
    li.appendChild(deleteBtn);
    taskListEl.appendChild(li);
  });

  renderMatrix();
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
  tasks.forEach((task) => {
    const q = task.quadrant || 0;
    if (!task.completed) counts[q]++;
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
  check.setAttribute('aria-label', task.completed ? `Mark "${task.text}" incomplete` : `Mark "${task.text}" complete`);
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
  body.setAttribute('aria-label', `${task.text}, ${where}. Tap to focus on it, drag to move, or press 1 to 4 to move, 0 to unsort.`);
  const title = document.createElement('span');
  title.className = 'matrix-chip-text';
  title.textContent = task.text;
  body.appendChild(title);
  const label = estimateLabel(task.actual, task.estimate);
  if (label) {
    const est = document.createElement('span');
    est.className = 'matrix-chip-est';
    est.textContent = label;
    body.appendChild(est);
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

  li.append(check, body);
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
  activeTaskPillEl.textContent = `🎯 ${task.text}`;
  activeTaskPillEl.style.display = 'block';
}

function selectActiveTask(task) {
  activeTaskId = activeTaskId === task.id ? null : task.id;
  syncActiveTaskPill();
  renderTasks();
  saveTimerState();
}

function addTask(text, estimate = 0) {
  if (store.addTask(text, estimate)) fetchTasks();
}

function toggleTask(id, completed) {
  store.updateTask(id, { completed });
  fetchTasks();
  if (completed) {
    document.querySelectorAll(`#task-list [data-id="${CSS.escape(id)}"], #task-matrix [data-id="${CSS.escape(id)}"]`)
      .forEach(el => el.classList.add('just-completed'));
  }
}

/** Delete straight away, with an Undo in the toast that puts the task back where it was. */
function deleteTask(id) {
  const index = tasks.findIndex(t => t.id === id);
  if (index < 0) return;
  const removed = tasks[index];
  const wasActive = activeTaskId === id;
  if (wasActive) {
    activeTaskId = null;
    activeTaskPillEl.style.display = 'none';
    saveTimerState();
  }
  store.deleteTask(id);
  fetchTasks();
  showToast(`Deleted “${removed.text}”`, {
    label: 'Undo',
    onClick: () => {
      if (!store.restoreTask(removed, index)) return;
      if (wasActive) activeTaskId = id;
      fetchTasks();
      saveTimerState();
    },
  });
}

/** Swap a task's title for an input; Enter or leaving the field saves, Esc cancels. */
function startTaskEdit(li, task) {
  const textSpan = li.querySelector('.task-text');
  if (!textSpan) return;
  const input = document.createElement('input');
  input.className = 'task-edit-input';
  input.value = task.text;
  input.maxLength = 80;
  input.setAttribute('aria-label', 'Edit task');
  textSpan.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    if (save && input.value.trim() && input.value.trim() !== task.text) {
      store.updateTask(task.id, { text: input.value });
    }
    fetchTasks();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
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

taskFormEl.addEventListener('submit', (e) => {
  e.preventDefault();
  const estimate = Math.min(20, Math.max(0, parseInt(taskEstimateEl.value, 10) || 0));
  addTask(taskInputEl.value, estimate);
  taskInputEl.value = '';
  taskEstimateEl.value = '';
});

// ====================================================
// Ambient Sound Controls
// ====================================================
const soundChips = document.querySelectorAll('.sound-chip');
const soundStatusPill = document.getElementById('sound-status-pill');
const ambientVolumeSlider = document.getElementById('ambient-volume');

soundChips.forEach(chip => {
  chip.addEventListener('click', () => {
    const soundType = chip.dataset.sound;
    const isNowPlaying = window.ambientSound.play(soundType);

    soundChips.forEach(c => c.classList.remove('active'));
    if (isNowPlaying) {
      chip.classList.add('active');
      soundStatusPill.textContent = 'Playing';
      soundStatusPill.classList.remove('muted');
    } else {
      soundStatusPill.textContent = 'Muted';
      soundStatusPill.classList.add('muted');
    }
  });
});

ambientVolumeSlider.addEventListener('input', (e) => {
  window.ambientSound.setVolume(parseFloat(e.target.value));
});

// ====================================================
// Focus Analytics
// ====================================================
const todayFocusMinsEl = document.getElementById('today-focus-mins');
const todaySessionsCountEl = document.getElementById('today-sessions-count');
const streakCountEl = document.getElementById('streak-count');
const weeklyTotalEl = document.getElementById('weekly-total');
const weeklyChartEl = document.getElementById('weekly-chart');

const goalTextEl = document.getElementById('goal-text');
const goalBarEl = document.getElementById('goal-bar-fill');
const goalTrackEl = document.getElementById('goal-bar');

function renderGoal() {
  const g = goalProgress(todaySessions, config.daily_goal);
  goalTextEl.textContent = g.reached ? `🎉 Goal reached! ${g.done}/${g.goal}` : `${g.done}/${g.goal} sessions`;
  goalBarEl.style.width = `${g.percent}%`;
  goalTrackEl.setAttribute('aria-valuenow', String(g.percent));
}

function loadStats() {
  const stats = store.summary();

  todayFocusMinsEl.textContent = Math.round(stats.today_minutes);
  todaySessionsCountEl.textContent = stats.today_sessions;
  streakCountEl.textContent = stats.streak;
  todaySessions = stats.today_sessions;
  renderGoal();

  const weeklyMins = stats.daily_breakdown.reduce((acc, d) => acc + d.minutes, 0);
  const weeklyHours = (weeklyMins / 60).toFixed(1);
  weeklyTotalEl.textContent = `${weeklyHours}h total`;

  // Render bar chart
  renderChart(stats.daily_breakdown);
  renderReview(store.weeklyReview());
  loadInsights();
}

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
  reviewTopTaskEl.textContent = r.top_task ? `${r.top_task.label} · ${Math.round(r.top_task.minutes)}m` : '—';
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
  total.textContent = d.sessions ? `${Math.round(d.minutes)} min · ${d.sessions} 🍅` : 'No focus';
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
    name.textContent = t.label;
    const meta = document.createElement('span');
    meta.className = 'day-detail-meta';
    meta.textContent = `${t.sessions} 🍅 · ${Math.round(t.minutes)}m`;
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
    name.textContent = row.label;
    const meta = document.createElement('span');
    meta.className = 'task-stat-meta';
    meta.textContent = `${row.sessions} 🍅 · ${Math.round(row.minutes)}m`;
    const bar = document.createElement('span');
    bar.className = 'task-stat-bar';
    bar.style.width = `${Math.max(4, Math.round((row.minutes / max) * 100))}%`;
    li.append(name, meta, bar);
    taskStatsEl.appendChild(li);
  });
}

function loadInsights() {
  renderHeatmap(store.heatmap(84));
  renderTaskStats(store.taskStats());
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
  downloadFile('pomodoro-sessions.csv', store.sessionsCsv(), 'text/csv;charset=utf-8');
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
  try { localStorage.setItem('pomodoro-theme', theme); } catch (e) { /* ignore */ }
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

const settingFocusInput = document.getElementById('setting-focus');
const settingShortInput = document.getElementById('setting-short');
const settingLongInput = document.getElementById('setting-long');
const settingIntervalInput = document.getElementById('setting-interval');
const settingGoalInput = document.getElementById('setting-goal');
const settingAutoStartInput = document.getElementById('setting-autostart');

let lastFocusedBeforeModal = null;

function openSettings() {
  lastFocusedBeforeModal = document.activeElement;
  settingsModal.classList.add('open');
  settingsModal.setAttribute('aria-hidden', 'false');
  settingFocusInput.focus();
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
  settingFocusInput.value = config.focus_duration;
  settingShortInput.value = config.short_break;
  settingLongInput.value = config.long_break;
  settingIntervalInput.value = config.long_break_interval;
  settingGoalInput.value = config.daily_goal;
  settingAutoStartInput.checked = Boolean(config.auto_start);
}

function loadSettings() {
  config = { ...config, ...store.getSettings() };
  fillSettingsForm();
  applyTheme(config.theme);
  renderGoal();
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const updated = {
    focus_duration: parseInt(settingFocusInput.value, 10),
    short_break: parseInt(settingShortInput.value, 10),
    long_break: parseInt(settingLongInput.value, 10),
    long_break_interval: parseInt(settingIntervalInput.value, 10),
    daily_goal: parseInt(settingGoalInput.value, 10),
    auto_start: settingAutoStartInput.checked ? 1 : 0
  };

  config = { ...config, ...store.saveSettings(updated) };
  closeSettings();
  renderGoal();
  if (!isRunning) {
    switchMode(currentMode);
  }
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
  const day = window.PomodoroStore.localDayKey(new Date());
  downloadFile(`pomodoro-backup-${day}.json`, JSON.stringify(store.exportBackup(), null, 2), 'application/json');
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
      throw new Error('This file is not a Pomodoro backup.');
    }
    const added = store.importBackup(data);
    loadSettings();
    fetchTasks();
    loadStats();
    if (!isRunning) switchMode(currentMode);
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
const VIEW_KEY = 'pomodoro-view';
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
  updateDisplay();
  try { setView(localStorage.getItem(VIEW_KEY)); } catch (e) { setView('timer'); }
  try { setTaskView(localStorage.getItem(TASK_VIEW_KEY)); } catch (e) { setTaskView('list'); }
  loadSettings();
  fetchTasks();
  loadStats();
  restoreTimerState();
  registerServiceWorker();
})();
