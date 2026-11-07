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

test('reset today uses an accessible confirm modal, not window.confirm', () => {
  const html = read('index.html');
  ['reset-btn', 'reset-modal', 'reset-cancel-btn', 'reset-confirm-btn', 'reset-work', 'reset-break'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
  assert.match(html, /id="reset-modal"[^>]*aria-hidden="true"/);
  assert.match(html, /role="alertdialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-desc"/);
  assert.match(html, /id="reset-btn"[^>]*aria-label=/, 'icon+text button is labelled');
  const js = read('app.js');
  assert.doesNotMatch(js, /window\.confirm|[^.\w]confirm\(/);
  assert.match(js, /resetModal\.addEventListener\('keydown'[\s\S]*Escape/, 'Esc closes it');
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

test('the desktop timer tab leaves review, insights and the developer view to Stats', () => {
  const css = read('style.css');
  assert.match(css, /body\[data-view="timer"\] \.review-card,\s*body\[data-view="timer"\] \.insights-card,\s*body\[data-view="timer"\] \.dev-card \{\s*display: none;/);
});

test('the developer view is built with textContent and safe links, never innerHTML for user text', () => {
  const app = read('app.js');
  const body = app.slice(app.indexOf('function renderDevMetrics'), app.indexOf('function loadInsights'));
  assert.match(body, /link\.rel = 'noopener noreferrer'/);
  assert.match(body, /link\.target = '_blank'/);
  assert.doesNotMatch(body.replace(/\.innerHTML = ''/g, ''), /innerHTML/);
  const html = read('index.html');
  assert.match(html, /id="stream-list"/);
  assert.match(html, /id="sizing-list"/);
  assert.match(html, /id="wip-note"/);
});

test('ambient sound is gone; the cat meows when switching between work and break, unless muted in settings', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /ambient|sound-chip|sound-presets/);
  assert.match(html, /<input id="setting-sound" class="setting-toggle" type="checkbox">/);
  const app = read('app.js');
  assert.match(app, /config\.cat_sound\) window\.catSound\.meow\(workMode, config\.character\)/);
  assert.doesNotMatch(app, /ambientSound/);
  const audio = read('audio.js');
  assert.match(audio, /window\.catSound = new CatSound\(\)/);
  assert.match(audio, /cat: 'sounds\/meow\.mp3'/);
  assert.ok(fs.statSync(path.join(root, 'sounds/meow.mp3')).size > 1000, 'the meow file ships with the app');
  assert.ok(shellPaths().includes('./sounds/meow.mp3'), 'and is cached for offline use');
  // the cheer plays when a task is done or a daily target is hit, under the same mute setting
  assert.match(audio, /cheer: 'sounds\/yay\.mp3'/);
  assert.match(app, /if \(config\.cat_sound\) window\.catSound\.cheer\(\)/);
  assert.ok(fs.statSync(path.join(root, 'sounds/yay.mp3')).size > 1000, 'the cheer file ships with the app');
  assert.ok(shellPaths().includes('./sounds/yay.mp3'), 'and is cached for offline use');
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

test('every character plays a recorded clip that the service worker precaches, with the synthesised voice as fallback', () => {
  const audio = read('audio.js');
  assert.ok(audio.includes("cat: 'sounds/meow.mp3'"), 'cat clip wired');
  assert.ok(shellPaths().includes('./sounds/meow.mp3'), 'meow.mp3 precached');
  ['dog', 'cow', 'pig'].forEach((c) => {
    assert.ok(audio.includes(`${c}: 'sounds/${c}.mp3'`), `${c} clip wired`);
    assert.ok(fs.existsSync(path.join(root, 'sounds', `${c}.mp3`)), `${c}.mp3 exists`);
    assert.ok(shellPaths().includes(`./sounds/${c}.mp3`), `${c}.mp3 precached`);
  });
});

test('list rows and matrix chips open one bottom sheet that reuses the list editor', () => {
  const app = read('app.js');
  assert.match(app, /moreBtn\.className = 'task-more-btn'/);
  assert.match(app, /moreBtn\.className = 'matrix-chip-more'/);
  assert.match(app, /querySelector\('\.task-text, \.matrix-chip-body'\)/, 'the inline editor still serves list rows and chips');
  assert.match(app, /getElementById\('sheet-edit'\)[\s\S]*startTaskEdit\(row, task\)/, 'Edit text in the sheet reuses it');
  assert.doesNotMatch(app, /'task-edit-btn'|'matrix-chip-edit'/, 'the old edit buttons are gone');
  const css = read('style.css');
  assert.match(css, /\.matrix-chip-more\s*\{/);
  assert.match(css, /\.task-more-btn\s*\{/);
  assert.match(read('index.html'), /<dialog id="task-sheet"/);
});

test('swipe leaves vertical scroll and pinch to the browser, and never starts from a mouse', () => {
  const css = read('style.css');
  assert.match(css, /\.task-item,\s*\.matrix-chip\s*\{[^}]*touch-action: pan-y pinch-zoom/);
  const swipe = read('app.js').slice(read('app.js').indexOf('function attachSwipe'));
  assert.match(swipe, /e\.pointerType === 'mouse'/);
  assert.match(swipe, /gestureBusy/);
  assert.match(swipe, /\.task-drag-handle/, 'a drag from the reorder handle is not a swipe');
});

test('the Done list keeps its own delete button style', () => {
  assert.match(read('app.js'), /'task-delete-btn done-delete-btn'/);
  assert.match(read('style.css'), /\.task-delete-btn\s*\{/);
});

test('the new activity flow is a cached script that loads between timer-core and app, in a native dialog', () => {
  assert.ok(shellPaths().includes('./flow.js'), 'flow.js is cached for offline use');
  const html = read('index.html');
  const order = ['timer-core.js', 'flow.js', 'app.js'].map((f) => html.indexOf(`<script src="${f}">`));
  assert.ok(order.every((i) => i > -1) && order[0] < order[1] && order[1] < order[2], 'timer-core.js, then flow.js, then app.js');
  assert.match(html, /<dialog id="flow-dialog"/);
  ['flow-back', 'flow-close', 'flow-count', 'flow-progress', 'flow-question', 'flow-hint', 'flow-field', 'flow-error', 'flow-skip', 'flow-next', 'new-activity-btn'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `${id} exists`);
  });
  assert.match(html, /id="flow-progress"[^>]*role="progressbar"/);
  assert.match(html, /id="flow-error"[^>]*role="alert"/);
});

test('the flow shows what the person types with textContent only, and wires the rules from timer-core', () => {
  const flow = read('flow.js');
  const code = flow.replace(/\/\/.*$/gm, ''); // the comments may mention what the code avoids
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|document\.write/);
  ['flowStepError', 'flowResult', 'normalizeLink', 'FLOW_STEPS'].forEach((fn) => assert.match(flow, new RegExp(fn), `${fn} is used`));
  const app = read('app.js');
  assert.match(app, /window\.TaskFlow\.init\(\{ onAdd: addFromFlow/);
  assert.match(app, /store\.addTask\(text, quadrant, points\)/);
});

test('the New activity button is for phones only; the flow is full screen there and a card on wide screens', () => {
  const css = read('style.css');
  assert.match(css, /\.new-activity-btn \{\s*display: none;/);
  assert.match(css, /@media \(max-width: 600px\) \{\s*\.new-activity-btn \{\s*display: flex;/);
  assert.match(css, /\.flow\[open\] \{\s*display: flex;/, 'a closed dialog must stay hidden: only [open] sets display');
  assert.match(css, /@media \(min-width: 601px\) \{\s*\.flow \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.flow-body\.from-right/);
});

test('validate.sh checks flow.js too', () => {
  const script = read('scripts/validate.sh');
  assert.match(script, /for f in [^;]*flow\.js/);
  assert.match(script, /-- store\.js timer-core\.js app\.js flow\.js/);
});

// ---- Jira site setting ----

test('Settings has a Jira site field with a hint and an inline error, wired to the store and the link rules', () => {
  const html = read('index.html');
  ['setting-jira', 'setting-jira-hint', 'setting-jira-error'].forEach((id) => assert.match(html, new RegExp(`id="${id}"`), `${id} exists`));
  assert.match(html, /id="setting-jira-error"[^>]*role="alert"/);
  assert.match(html, /id="setting-jira"[^>]*aria-describedby="setting-jira-hint setting-jira-error"/);
  const app = read('app.js');
  // the site is set before anything is drawn, and checked before it is saved
  assert.ok(app.indexOf('window.TimerCore.setJiraBase(store.getJiraBase())') > -1 && app.indexOf('window.TimerCore.setJiraBase(store.getJiraBase())') < app.indexOf('function renderTasks'), 'set before the first render');
  assert.match(app, /window\.TimerCore\.normalizeJiraBase\(settingJiraInput\.value\)/);
  assert.match(app, /if \(jira === null\) \{[\s\S]*settingJiraError\.hidden = false;[\s\S]*return;/, 'a bad address keeps the dialog open');
  assert.match(app, /store\.saveJiraBase\(jira\)/);
  assert.match(app, /store\.importBackup\(data\);\s*window\.TimerCore\.setJiraBase\(store\.getJiraBase\(\)\)/, 'restoring a backup applies its Jira site');
});

test('text colours of the Jira site setting keep 4.5:1 in light and dark, including opacity', () => {
  // Self-contained on purpose: the helpers are scoped to this test so nothing here depends on, or collides with, other files' helpers.
  const css = read('style.css');
  const dark = [...css.matchAll(/:root\[data-theme="dark"\] \{([^}]*)\}/g)].map((m) => m[1]).join('\n');
  const grab = (text) => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
  const light = grab(css.replace(/:root\[data-theme="dark"\] \{[^}]*\}/g, ''));
  const themes = { light, dark: { ...light, ...grab(dark) } };
  const channel = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => channel(hex, i) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const over = (fg, alpha, bg) => '#' + [1, 3, 5].map((i) => Math.round(channel(fg, i) * alpha + channel(bg, i) * (1 - alpha)).toString(16).padStart(2, '0')).join('');

  assert.ok(Math.abs(ratio('#000000', '#ffffff') - 21) < 0.01, 'the helper is right');
  const hintOpacity = Number(css.match(/\.setting-hint \{[^}]*opacity: ([\d.]+)/)[1]);
  const placeholderOpacity = Number(css.match(/\.setting-stack input::placeholder \{[^}]*opacity: ([\d.]+)/)[1]);
  Object.entries(themes).forEach(([name, t]) => {
    const hint = ratio(over(t['--text-main'], hintOpacity, t['--surface']), t['--surface']);
    assert.ok(hint >= 4.5, `${name}: the hint is ${hint.toFixed(2)}:1`);
    const placeholder = ratio(over(t['--text-main'], placeholderOpacity, t['--surface-muted']), t['--surface-muted']);
    assert.ok(placeholder >= 4.5, `${name}: the placeholder is ${placeholder.toFixed(2)}:1`);
  });
  assert.ok(ratio('#c53030', themes.light['--surface']) >= 4.5, 'the error red on the light card');
  assert.ok(ratio('#ff9b9b', themes.dark['--surface']) >= 4.5, 'the lighter error red on the dark card');
});

// ---- colour contrast of the new activity flow, sheet and primary buttons (WCAG AA: 4.5:1 for text) ----

/** Hex colour tokens from style.css: light = everything outside the dark blocks; dark = the dark blocks laid over light. */
function colourTokens() {
  const css = read('style.css');
  const darkBlocks = [...css.matchAll(/:root\[data-theme="dark"\] \{([^}]*)\}/g)].map((m) => m[1]).join('\n');
  const lightCss = css.replace(/:root\[data-theme="dark"\] \{[^}]*\}/g, '');
  const grab = (text) => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
  const light = grab(lightCss);
  return { light, dark: { ...light, ...grab(darkBlocks) } };
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the on-accent text colour reads on both accents, in light and dark', () => {
  const { light, dark } = colourTokens();
  [['light', light], ['dark', dark]].forEach(([name, t]) => {
    ['--accent-focus', '--accent-short'].forEach((accent) => {
      const ratio = contrast(t['--on-accent'], t[accent]);
      assert.ok(ratio >= 4.5, `${name}: --on-accent on ${accent} is ${ratio.toFixed(2)}:1`);
    });
  });
});

test('the flow muted text colour reads on every surface the flow and sheet put it on', () => {
  const { light, dark } = colourTokens();
  [['light', light], ['dark', dark]].forEach(([name, t]) => {
    ['--surface', '--surface-muted', '--accent-focus-light', '--accent-short-light'].forEach((surface) => {
      const ratio = contrast(t['--flow-muted'], t[surface]);
      assert.ok(ratio >= 4.5, `${name}: --flow-muted on ${surface} is ${ratio.toFixed(2)}:1`);
    });
  });
});

test('error and delete text reads on the dialog surfaces in light and dark', () => {
  const { light, dark } = colourTokens();
  [['light', light], ['dark', dark]].forEach(([name, t]) => {
    ['--surface', '--surface-muted'].forEach((surface) => {
      const ratio = contrast(t['--danger-text'], t[surface]);
      assert.ok(ratio >= 4.5, `${name}: --danger-text on ${surface} is ${ratio.toFixed(2)}:1`);
    });
  });
});

test('primary buttons use the on-accent colour, never white on the pastel accent', () => {
  const css = read('style.css');
  [/\.task-add-btn \{[^}]*color: var\(--on-accent\)/, /\.flow-next \{[^}]*color: var\(--on-accent\)/, /\.sheet-chip\[aria-pressed="true"\] \{[^}]*color: var\(--on-accent\)/].forEach((re) => {
    assert.match(css, re);
  });
  // the new components take their muted text from the token that passes, not the app-wide grey
  ['\\.flow-hint', '\\.flow-count', '\\.flow-card-hint', '\\.sheet-label', '\\.new-activity-sub'].forEach((sel) => {
    assert.match(css, new RegExp(`${sel} \\{[^}]*color: var\\(--flow-muted\\)`), `${sel} uses --flow-muted`);
  });
});

test('the contrast helper itself is right (known ratios)', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.48) < 0.02);
  assert.equal(contrast('#336699', '#336699'), 1);
});

test('app.js lists every TimerCore helper it calls (a missing name is a ReferenceError at startup and the page does nothing)', () => {
  const exported = Object.keys(require('../timer-core.js'));
  const app = read('app.js');
  const listed = (app.match(/const \{([^}]+)\} = window\.TimerCore;/) || [])[1];
  assert.ok(listed, 'app.js destructures window.TimerCore');
  const names = listed.split(',').map((s) => s.trim());
  names.forEach((n) => assert.ok(exported.includes(n), `${n} is exported by timer-core.js`));
  // code only: comments and strings are not calls
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  exported.forEach((name) => {
    const bareCall = new RegExp(`(?<![.\\w$])${name}\\(`).test(code);
    const declared = new RegExp(`(?:function|const|let|var)\\s+${name}\\b`).test(code);
    if (bareCall && !declared) assert.ok(names.includes(name), `app.js calls ${name}() but does not take it from window.TimerCore`);
  });
});

test('one add per screen size: under 600px the guided button shows and the quick add row hides; wider keeps the quick add', () => {
  const css = read('style.css');
  const phone = css.match(/@media \(max-width: 600px\) \{\s*\.new-activity-btn \{\s*display: flex;\s*\}\s*\.task-form \{\s*display: none;\s*\}/);
  assert.ok(phone, 'the phone rule shows .new-activity-btn and hides .task-form together');
  assert.match(css, /\.new-activity-btn \{\s*display: none;/, 'hidden by default, so a wide screen shows only the quick add');
});
