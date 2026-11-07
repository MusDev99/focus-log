// New activity flow: one question per screen, like a booking flow (title, link, size, priority).
// The rules (validation, building the task text) live in timer-core.js and are unit-tested; this file is only the screens.
// Everything the person types is shown with textContent, never innerHTML.
(function () {
  const T = window.TimerCore;
  const STEPS = T.FLOW_STEPS;

  const QUADRANT_HINTS = {
    1: 'Urgent and important',
    2: 'Important, not urgent',
    3: 'Urgent, not important',
    4: 'Neither urgent nor important',
  };
  const SOURCE_NAMES = { jira: 'Jira ticket', github: 'GitHub repo', other: 'Site' };

  let el = null;
  let quadrants = {};
  let onAdd = () => {};
  let step = 0;
  let draft = { title: '', link: '', points: 0, quadrant: null };

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---- fields: one per step ----

  function titleField() {
    const input = make('input', 'flow-input');
    input.id = 'flow-title';
    input.type = 'text';
    input.maxLength = T.MAX_TASK_TEXT;
    input.placeholder = 'e.g. Fix the seat map crash';
    input.autocomplete = 'off';
    input.enterKeyHint = 'next';
    input.setAttribute('aria-label', STEPS[0].question);
    input.value = draft.title;
    input.addEventListener('input', () => {
      draft.title = input.value;
      clearError();
      updateNext();
    });
    return input;
  }

  function linkField() {
    const wrap = make('div', 'flow-link');
    const input = make('input', 'flow-input');
    input.id = 'flow-link';
    input.type = 'text';
    input.inputMode = 'url';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.enterKeyHint = 'next';
    input.placeholder = 'https://…';
    input.setAttribute('aria-label', STEPS[1].question);
    input.value = draft.link;
    const preview = make('p', 'flow-preview');
    preview.setAttribute('aria-live', 'polite');
    const refresh = () => {
      preview.textContent = '';
      preview.className = 'flow-preview';
      if (!draft.link.trim()) return;
      const link = T.normalizeLink(draft.link);
      if (!link.ok) {
        preview.textContent = 'Not a link yet';
        return;
      }
      const source = T.sourceOfText(link.href);
      preview.classList.add('ok');
      preview.textContent = source ? `✓ ${SOURCE_NAMES[source.kind]}: ${source.label}` : '✓ Link';
    };
    input.addEventListener('input', () => {
      draft.link = input.value;
      clearError();
      refresh();
    });
    wrap.append(input, preview);
    refresh();
    return wrap;
  }

  function chipGroup(label) {
    const group = make('div', 'flow-choices');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    return group;
  }

  function sizeField() {
    const group = chipGroup(STEPS[2].question);
    group.classList.add('flow-sizes');
    T.FLOW_POINTS.forEach((points) => {
      const chip = make('button', 'flow-chip', String(points));
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(draft.points === points));
      chip.setAttribute('aria-label', `${points} story points`);
      chip.addEventListener('click', () => {
        // Tapping the chosen size again clears it
        draft.points = draft.points === points ? 0 : points;
        group.querySelectorAll('.flow-chip').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.textContent) === draft.points)));
      });
      group.appendChild(chip);
    });
    return group;
  }

  function priorityField() {
    const group = chipGroup(STEPS[3].question);
    group.classList.add('flow-cards');
    [1, 2, 3, 4].forEach((q) => {
      const card = make('button', `flow-card q${q}`);
      card.type = 'button';
      card.dataset.q = String(q);
      card.setAttribute('aria-pressed', String(draft.quadrant === q));
      card.append(make('span', 'flow-card-name', `Q${q} · ${(quadrants[q] || {}).name || ''}`), make('span', 'flow-card-hint', QUADRANT_HINTS[q]));
      card.addEventListener('click', () => {
        draft.quadrant = draft.quadrant === q ? null : q;
        group.querySelectorAll('.flow-card').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.q) === draft.quadrant)));
      });
      group.appendChild(card);
    });
    return group;
  }

  const FIELDS = { title: titleField, link: linkField, size: sizeField, priority: priorityField };

  // ---- the screen ----

  function showError(message) {
    el.error.textContent = message;
    el.error.hidden = false;
  }

  function clearError() {
    el.error.textContent = '';
    el.error.hidden = true;
  }

  /** The title step cannot move on while it is empty; later steps are optional. */
  function updateNext() {
    el.next.disabled = STEPS[step].id === 'title' && !!T.flowStepError('title', draft);
  }

  function focusField() {
    const target = el.field.querySelector('input') || el.field.querySelector('[aria-pressed="true"]') || el.field.querySelector('button');
    if (target) target.focus();
  }

  function render(direction) {
    const current = STEPS[step];
    const last = step === STEPS.length - 1;
    el.count.textContent = `Step ${step + 1} of ${STEPS.length}`;
    el.progress.setAttribute('aria-valuenow', String(step + 1));
    el.progress.querySelectorAll('span').forEach((seg, i) => seg.classList.toggle('done', i <= step));
    el.back.style.visibility = step === 0 ? 'hidden' : 'visible';
    el.question.textContent = current.question;
    el.hint.textContent = current.hint;
    el.field.textContent = '';
    el.field.appendChild(FIELDS[current.id]());
    el.skip.hidden = !current.skippable;
    el.next.textContent = last ? 'Add activity' : 'Next';
    clearError();
    updateNext();
    el.body.classList.remove('from-right', 'from-left');
    if (direction) {
      void el.body.offsetWidth; // restart the slide
      el.body.classList.add(direction === 'back' ? 'from-left' : 'from-right');
    }
  }

  function finish() {
    const result = T.flowResult(draft);
    if (result.error) {
      // Something no longer fits: go back to the step that can fix it
      step = Math.max(0, STEPS.findIndex((s) => s.id === result.step));
      render('back');
      focusField();
      showError(result.error);
      return;
    }
    onAdd(result);
    close();
  }

  function advance() {
    const error = T.flowStepError(STEPS[step].id, draft);
    if (error) {
      showError(error);
      return;
    }
    if (step === STEPS.length - 1) return finish();
    step += 1;
    render('forward');
    focusField();
  }

  function skip() {
    const id = STEPS[step].id;
    if (id === 'link') draft.link = '';
    if (id === 'size') draft.points = 0;
    if (id === 'priority') draft.quadrant = null;
    if (step === STEPS.length - 1) return finish();
    step += 1;
    render('forward');
    focusField();
  }

  function back() {
    if (step === 0) return close();
    step -= 1;
    render('back');
    focusField();
  }

  function close() {
    if (el.dialog.open) el.dialog.close();
  }

  function open() {
    draft = { title: '', link: '', points: 0, quadrant: null };
    step = 0;
    render(null);
    if (!el.dialog.open) el.dialog.showModal();
    focusField();
  }

  function init(options) {
    onAdd = options.onAdd;
    quadrants = options.quadrants || {};
    el = {
      dialog: document.getElementById('flow-dialog'),
      body: document.getElementById('flow-body'),
      count: document.getElementById('flow-count'),
      progress: document.getElementById('flow-progress'),
      back: document.getElementById('flow-back'),
      close: document.getElementById('flow-close'),
      question: document.getElementById('flow-question'),
      hint: document.getElementById('flow-hint'),
      field: document.getElementById('flow-field'),
      error: document.getElementById('flow-error'),
      skip: document.getElementById('flow-skip'),
      next: document.getElementById('flow-next'),
    };
    el.progress.setAttribute('aria-valuemax', String(STEPS.length));
    STEPS.forEach(() => el.progress.appendChild(document.createElement('span')));
    el.back.addEventListener('click', back);
    el.close.addEventListener('click', close);
    el.skip.addEventListener('click', skip);
    el.next.addEventListener('click', advance);
    // Enter in a text field moves on, like Next
    el.field.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.isComposing) return;
      e.preventDefault();
      if (!el.next.disabled) advance();
    });
  }

  window.TaskFlow = { init, open };
})();
