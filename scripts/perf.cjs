// Manual perf harness (not part of validate.sh). Needs Playwright (preinstalled in agent sessions) and any static server.
// Usage:  npm start &   then   NODE_PATH=$(npm root -g) node scripts/perf.cjs http://localhost:8000/index.html <label>
// Seeds 100 open tasks, 40 done and 300 sessions, throttles the CPU 4x, wraps the app's own render functions to time
// them, and prints tap-to-paint for completing a task, quick add and starting a timer, plus the idle cost of a tick.
// Measure before and after any render change; only keep what the numbers justify.
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://localhost:8000/index.html';
const label = process.argv[3] || 'run';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url);
  await page.evaluate(() => {
    localStorage.clear();
    const day = (d, h = 10) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - d, h).toISOString();
    const tasks = [];
    for (let i = 0; i < 100; i++) tasks.push({ id: 'o' + i, text: i % 7 === 0 ? `Task ${i} https://airasia.atlassian.net/browse/SKYIQ-${100 + i}` : `Open task number ${i} with a title`, completed: false, points: [0, 1, 2, 3, 5, 8][i % 6], quadrant: i % 5 === 0 ? null : (i % 4) + 1, elapsed_ms: (i % 9) * 120000, created_at: day(20), completed_at: null });
    for (let i = 0; i < 40; i++) tasks.push({ id: 'd' + i, text: `Finished task ${i}`, completed: true, points: [1, 2, 3, 5, 8][i % 5], quadrant: (i % 4) + 1, elapsed_ms: (i % 6 + 1) * 600000, created_at: day(30), completed_at: day(i % 25) });
    const sessions = [];
    for (let i = 0; i < 300; i++) sessions.push({ id: 's' + i, mode: 'focus', duration_seconds: 600 + (i % 7) * 300, completed_at: day(i % 80, 8 + (i % 9)), task_id: i % 3 === 0 ? 'o' + (i % 100) : 'd' + (i % 40) });
    localStorage.setItem('focuslog-tasks', JSON.stringify(tasks));
    localStorage.setItem('focuslog-sessions', JSON.stringify(sessions));
  });
  await page.reload(); await page.waitForTimeout(800);
  await page.locator('.bottom-nav-btn[data-view="tasks"]').click(); await page.waitForTimeout(300);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // time the app's own render functions
  await page.evaluate(() => {
    window.__t = {};
    for (const name of ['fetchTasks', 'renderTasks', 'renderMatrix', 'renderDone', 'loadScore', 'loadStats', 'loadInsights', 'renderHeatmap', 'renderDevMetrics', 'renderChart', 'renderReview', 'updateClock', 'syncActiveTaskPill']) {
      const fn = window[name]; if (typeof fn !== 'function') continue;
      window[name] = function (...a) { const t0 = performance.now(); try { return fn.apply(this, a); } finally { const d = performance.now() - t0; const r = (window.__t[name] ||= { calls: 0, ms: 0 }); r.calls++; r.ms += d; } };
    }
  });
  const timings = async () => (await page.evaluate(() => { const t = window.__t; window.__t = {}; return t; }));
  const out = { label, tasks: await page.locator('#task-list li').count() };
  const tap = (fn) => page.evaluate(async (src) => new Promise((resolve) => {
    const t0 = performance.now();
    const mo = new MutationObserver(() => { mo.disconnect(); requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))); });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    new Function(src)();
  }), fn);

  await timings();
  out.completeTask = { tapToPaintMs: [], fullyUpdatedMs: [], render: null };
  for (let i = 0; i < 3; i++) {
    const before = await page.locator('#task-list li').count();
    const both = await page.evaluate(async (n) => new Promise((resolve) => {
      const t0 = performance.now(); let first = null;
      const mo = new MutationObserver(() => { if (first === null) requestAnimationFrame(() => { first = Math.round(performance.now() - t0); }); if (document.querySelectorAll('#task-list li').length < n) { mo.disconnect(); requestAnimationFrame(() => resolve([first ?? Math.round(performance.now() - t0), Math.round(performance.now() - t0)])); } });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      document.querySelector('#task-list .task-checkbox-btn').click();
    }), before);
    out.completeTask.tapToPaintMs.push(both[0]); out.completeTask.fullyUpdatedMs.push(both[1]); await page.waitForTimeout(600);
  }
  out.completeTask.render = await timings();

  out.quickAdd = { tapToPaintMs: [] };
  for (let i = 0; i < 3; i++) {
    await page.fill('#task-input', 'Quick add ' + i);
    out.quickAdd.tapToPaintMs.push(await tap(`document.getElementById('task-form').requestSubmit()`)); await page.waitForTimeout(500);
  }
  out.quickAdd.render = await timings();

  out.startTimer = { tapToPaintMs: [] };
  for (let i = 0; i < 3; i++) { out.startTimer.tapToPaintMs.push(await tap(`document.querySelectorAll('#task-list .task-clock-btn')[${i + 1}].click()`)); await page.waitForTimeout(400); }
  out.startTimer.render = await timings();

  // statistics screen open (the heaviest single render)
  const s0 = Date.now(); await page.locator('.bottom-nav-btn[data-view="stats"]').click(); await page.waitForTimeout(500);
  out.openStats = await timings();

  // idle cost of a running timer: 5 s of ticks
  await page.locator('.bottom-nav-btn[data-view="tasks"]').click(); await page.waitForTimeout(200);
  await timings(); await cdp.send('Performance.enable');
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await page.waitForTimeout(5000);
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  out.tick5s = { taskMs: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000), scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000), styleMs: Math.round((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000), layoutMs: Math.round((m1.LayoutDuration - m0.LayoutDuration) * 1000), renders: await timings() };

  out.domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);
  out.errs = errs;
  const round = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));
  console.log(JSON.stringify(round(out), null, 1));
  await b.close();
})();
