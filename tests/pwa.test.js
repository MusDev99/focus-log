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

test('notifications go through the service worker and tapping one reopens the app', () => {
  assert.match(read('app.js'), /reg\.showNotification\(/);
  const sw = read('sw.js');
  assert.match(sw, /addEventListener\('notificationclick'/);
  assert.match(sw, /clients\.openWindow\(self\.registration\.scope\)/);
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

test('phones get a bottom tab bar for timer, tasks and stats', () => {
  const html = read('index.html');
  ['timer', 'tasks', 'stats'].forEach((view) => {
    assert.match(html, new RegExp(`class="bottom-nav-btn" data-view="${view}"`));
  });
  assert.match(html, /<body[^>]*data-view="timer"/);
  const css = read('style.css');
  assert.match(css, /body\[data-view="stats"\] \.center-stage/);
  assert.match(css, /@media \(min-width: 720px\) \{\s*\.bottom-nav \{\s*display: none;/);
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
