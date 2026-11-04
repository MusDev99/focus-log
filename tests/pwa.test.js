// Static checks for the PWA files — run with `node --test tests/*.test.js`.
// The app is hosted under a subpath on GitHub Pages, so every path must be relative.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/** The SHELL array from sw.js, without executing the worker. */
function shellPaths() {
  const m = read('sw.js').match(/const SHELL = \[([\s\S]*?)\];/);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('manifest is valid JSON with relative scope and existing PNG icons', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  manifest.icons.forEach((icon) => {
    assert.ok(!icon.src.startsWith('/'), `${icon.src} must be relative`);
    const png = fs.readFileSync(path.join(root, icon.src));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', `${icon.src} is a PNG`);
  });
});

test('service worker caches every app file, using relative paths that exist', () => {
  const shell = shellPaths();
  ['./index.html', './app.js', './store.js', './timer-core.js', './style.css'].forEach((f) => {
    assert.ok(shell.includes(f), `${f} is cached`);
  });
  shell.forEach((p) => {
    assert.ok(p.startsWith('./'), `${p} must be relative`);
    assert.ok(fs.existsSync(path.join(root, p)), `${p} exists`);
  });
});

test('index.html loads scripts with relative paths and app.js registers sw.js relatively', () => {
  const html = read('index.html');
  [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:|#)/.test(u))
    .forEach((u) => assert.ok(!u.startsWith('/'), `${u} must be relative`));
  assert.match(read('app.js'), /serviceWorker\.register\('sw\.js'\)/);
  assert.doesNotMatch(read('app.js'), /fetch\(['`]\/api/);
});

test('settings include backup export and import controls', () => {
  const html = read('index.html');
  ['export-backup-btn', 'import-backup-btn', 'import-backup-input'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
});

test('page has the toast, confetti layer and day-detail panels the app drives', () => {
  const html = read('index.html');
  ['toast', 'toast-text', 'toast-action', 'toast-close', 'confetti', 'week-detail', 'heatmap-detail'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
  assert.match(html, /id="toast"[^>]*role="status"/);
  assert.match(html, /<canvas id="confetti"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /id="heatmap"[^>]*role="img"/, 'heatmap days are buttons now, not an image');
});

test('section tabs for timer, tasks and stats: bottom bar on phones, header tabs on desktop', () => {
  const html = read('index.html');
  ['timer', 'tasks', 'stats'].forEach((view) => {
    assert.match(html, new RegExp(`class="bottom-nav-btn" data-view="${view}"`));
  });
  assert.match(html, /<body[^>]*data-view="timer"/);
  const css = read('style.css');
  assert.match(css, /body\[data-view="stats"\] \.center-stage/);
  assert.match(html, /<header class="dashboard-topbar">[\s\S]*<nav class="bottom-nav"[\s\S]*<\/header>/, 'tabs live in the header');
  assert.match(css, /body\[data-view="tasks"\] \.right-panel,\s*body\[data-view="stats"\] \.left-panel \{\s*display: none;/);
});

test('tasks can be shown as a Covey matrix with an unsorted tray and four quadrants', () => {
  const html = read('index.html');
  assert.match(html, /data-task-view="list"/);
  assert.match(html, /data-task-view="matrix"/);
  [0, 1, 2, 3, 4].forEach((q) => {
    assert.match(html, new RegExp(`data-quadrant="${q}"`));
    assert.match(html, new RegExp(`data-list="${q}"`));
  });
  assert.match(read('app.js'), /store\.updateTask\(id, \{ quadrant \}\)/);
});

test('service worker revalidates with the server so a new deploy shows up right away', () => {
  assert.match(read('sw.js'), /fetch\(req, \{ cache: 'no-cache' \}\)/);
});

test('story points: picker on the task form, score card and a daily target setting', () => {
  const html = read('index.html');
  assert.match(html, /<select id="task-points"[^>]*aria-label="Story points \(optional\)"/);
  ['score-ring', 'score-today', 'score-target-btn', 'score-target-form', 'score-chart', 'score-done-list'].forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `#${id} exists`);
  });
  assert.match(html, /<input id="setting-points-goal" type="number" min="1" max="500"/);
  const app = read('app.js');
  assert.match(app, /store\.pointsSummary\(\)/);
  assert.match(app, /daily_points_goal: parseInt\(settingPointsGoalInput\.value, 10\)/);
});

test('the desktop timer tab leaves review and insights to Stats', () => {
  const css = read('style.css');
  assert.match(css, /body\[data-view="timer"\] \.review-card,\s*body\[data-view="timer"\] \.insights-card \{\s*display: none;/);
});

test('ambient sound is gone; the cat meows when switching between work and break, unless muted in settings', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /ambient|sound-chip|sound-presets/);
  assert.match(html, /<input id="setting-sound" class="setting-toggle" type="checkbox">/);
  const app = read('app.js');
  assert.match(app, /config\.cat_sound\) window\.catSound\.meow\(workMode, config\.character\)/);
  assert.doesNotMatch(app, /ambientSound/);
  assert.match(read('audio.js'), /window\.catSound = new CatSound\(\)/);
});

test('timer card has only Work and Break, a cat scene per mode, and the Overview tab', () => {
  const html = read('index.html');
  assert.deepEqual([...html.matchAll(/class="tab-btn[^"]*" data-mode="(\w+)"/g)].map((m) => m[1]), ['work', 'break']);
  assert.match(html, /<div id="cat-stage" class="cat-stage" data-mode="idle" data-char="cat"/);
  ['prop-work', 'prop-break', 'prop-idle'].forEach((c) => assert.ok(html.includes(`class="${c}"`), `${c} scene`));
  assert.match(html, /<span id="nav-timer-label">Overview<\/span>/);
  assert.doesNotMatch(html, /Short Break|Long Break|setting-focus|setting-autostart/);
  const css = read('style.css');
  ['work', 'break'].forEach((mode) => assert.ok(css.includes(`.cat-stage[data-mode="${mode}"]`), `${mode} animation rules`));
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.cat-stage \* \{ animation: none/);
});

test('finished tasks get a Done bucket with Restore', () => {
  const html = read('index.html');
  assert.match(html, /class="panel-card done-card"/);
  assert.match(html, /id="done-list"/);
  assert.match(read('app.js'), /restore\.addEventListener\('click', \(\) => toggleTask\(task\.id, false\)\)/);
});

test('the character (cat, dog, cow, pig) is drawn, voiced, saved as a setting and cycles on tap', () => {
  const html = read('index.html');
  const css = read('style.css');
  ['cat', 'dog', 'cow', 'pig'].forEach((c) => {
    assert.ok(html.includes(`ch ch-${c}`), `${c} drawing`);
    assert.ok(css.includes(`.cat-stage[data-char="${c}"]`), `${c} colours`);
    assert.ok(html.includes(`<option value="${c}">`), `${c} in settings`);
  });
  const audio = read('audio.js');
  ['cat', 'dog', 'cow', 'pig'].forEach((c) => assert.ok(new RegExp(`\\b${c}:`).test(audio), `${c} voice`));
  const app = read('app.js');
  assert.match(app, /CHARACTERS\[\(CHARACTERS\.indexOf\(config\.character\) \+ 1\) % CHARACTERS\.length\]/);
  assert.match(app, /catStageEl\.addEventListener\('click', nextCharacter\)/);
});
