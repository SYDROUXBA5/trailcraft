/* In-app sheets for the squad screens, in place of the browser's confirm().

   A confirm() box is grey, small and says the website's address over the
   question: on a projector in front of a chief it looks like an error, a
   phone in the iPhone app may not show it at all, and some browsers drop it
   without asking. A sheet is the app's own: big type, the app's colours,
   the dangerous choice in red, and Cancel where a thumb rests.

   Everything put into a sheet goes in by textContent: names and call signs
   in the questions were typed on other people's phones. No HTML here. */

let current = null;   // { finish } while a sheet is up

const root = () => document.getElementById('appSheet');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Puts a sheet up. `build(card, finish)` fills the card; finish(value)
    takes it down and settles the promise with value. Escape, a tap on the
    dimmed page and a second sheet over it all count as Cancel (`none`). */
function sheet(title, build, none) {
  const box = root();
  if (!box) return Promise.resolve(none);
  current?.finish(current.none);
  return new Promise((resolve) => {
    const back = document.activeElement;
    box.textContent = '';
    const card = el('div', 'app-sheet-card');
    const h = el('h2', 'app-sheet-title', title);
    h.id = 'appSheetTitle';
    h.tabIndex = -1;
    card.append(h);
    const onKey = (e) => {
      /* Escape is Cancel here, and goes no further (the app's own Escape
         would close the screen under the sheet). Tab stays in the sheet. */
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(none); return; }
      if (e.key !== 'Tab') return;
      const all = [...card.querySelectorAll('input, button')];
      if (!all.length) return;
      const first = all[0], last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!card.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    const onBack = (e) => { if (e.target === box) finish(none); };
    function finish(value) {
      if (current?.finish !== finish) return;
      current = null;
      box.hidden = true;
      box.textContent = '';
      document.removeEventListener('keydown', onKey, true);
      box.removeEventListener('click', onBack);
      try { back?.focus?.({ preventScroll: true }); } catch { /* gone */ }
      resolve(value);
    }
    current = { finish, none };
    build(card, finish);
    box.append(card);
    box.hidden = false;
    document.addEventListener('keydown', onKey, true);
    box.addEventListener('click', onBack);
    /* The first field, or the safe button, takes the focus: Enter on a
       keyboard never lands on Delete by accident. */
    (card.querySelector('input') || card.querySelector('[data-sheet-safe]') || h).focus({ preventScroll: true });
  });
}

function buttons(card, list) {
  const row = el('div', 'app-sheet-btns');
  for (const b of list) {
    const btn = el('button', `btn ${b.cls}`, b.text);
    btn.type = 'button';
    if (b.safe) btn.dataset.sheetSafe = '';
    btn.addEventListener('click', b.on);
    row.append(btn);
  }
  card.append(row);
}

/** A question with two answers. Resolves true for `yes`, false otherwise. */
export function ask({ title, body = '', yes = 'OK', no = 'Cancel', danger = false }) {
  return sheet(title, (card, finish) => {
    if (body) card.append(el('p', 'app-sheet-body', body));
    buttons(card, [
      { text: no, cls: 'ghost', safe: true, on: () => finish(false) },
      { text: yes, cls: danger ? 'danger' : 'moss', safe: !danger, on: () => finish(true) },
    ]);
  }, false);
}

/** Plain reading: a heading and a paragraph for each item, and Close. */
export function info({ title, items, close = 'Close' }) {
  return sheet(title, (card, finish) => {
    const list = el('dl', 'app-sheet-list');
    for (const it of items) list.append(el('dt', '', it.head), el('dd', '', it.text));
    card.append(list);
    buttons(card, [{ text: close, cls: 'moss', safe: true, on: () => finish(undefined) }]);
  }, undefined);
}

/** A short form. Resolves { key: value } on `yes`, or null. Each field is
    { key, label, value, placeholder, max, type, inputmode }, or a choice of
    a few with `choices: [{ value, text }]`; `grid` lays short fields out two by two. */
export function form({ title, body = '', fields, yes = 'OK', no = 'Cancel', note = '', grid = false }) {
  return sheet(title, (card, finish) => {
    if (body) card.append(el('p', 'app-sheet-body', body));
    const wrap = el('div', grid ? 'app-sheet-fields app-sheet-grid' : 'app-sheet-fields');
    const inputs = [];
    for (const f of fields) {
      const lab = el('label', 'app-sheet-field', f.label);
      let inp;
      if (f.choices) {
        inp = document.createElement('select');
        for (const c of f.choices) {
          const o = el('option', '', c.text);
          o.value = c.value;
          inp.append(o);
        }
        inp.value = f.value ?? f.choices[0]?.value ?? '';
      } else {
        inp = document.createElement('input');
        inp.type = f.type || 'text';
        inp.value = f.value ?? '';
        if (f.placeholder) inp.placeholder = f.placeholder;
        if (f.inputmode) inp.inputMode = f.inputmode;
        inp.maxLength = f.max || 60;
        inp.autocomplete = 'off';
        inp.spellcheck = false;
      }
      inp.dataset.key = f.key;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } });
      lab.append(inp);
      /* A line under the field, by textContent like the rest. */
      if (f.hint) lab.append(el('span', 'app-sheet-hint', f.hint));
      wrap.append(lab);
      inputs.push(inp);
    }
    card.append(wrap);
    if (note) card.append(el('p', 'app-sheet-note', note));
    const done = () => finish(Object.fromEntries(inputs.map(i => [i.dataset.key, i.value])));
    buttons(card, [
      { text: no, cls: 'ghost', safe: true, on: () => finish(null) },
      { text: yes, cls: 'moss', on: done },
    ]);
  }, null);
}

/** Whether a sheet is up (the map's keys leave it alone then). */
export const sheetOpen = () => !!current;

/** A few things to do, one button each. Resolves the picked option's
    `value`, or null for Close. Each option is { value, text, hint }; the
    hint is a short line under the button's words. */
export function choose({ title, body = '', options, note = '', no = 'Close' }) {
  return sheet(title, (card, finish) => {
    if (body) card.append(el('p', 'app-sheet-body', body));
    const list = el('div', 'app-sheet-choices');
    for (const o of options) {
      const btn = el('button', 'btn ghost app-sheet-choice');
      btn.type = 'button';
      btn.dataset.choice = o.value;
      btn.append(el('span', 'app-sheet-choice-text', o.text));
      if (o.hint) btn.append(el('span', 'app-sheet-hint', o.hint));
      btn.addEventListener('click', () => finish(o.value));
      list.append(btn);
    }
    card.append(list);
    if (note) card.append(el('p', 'app-sheet-note', note));
    buttons(card, [{ text: no, cls: 'moss', safe: true, on: () => finish(null) }]);
  }, null);
}

/** A sheet that stays up while something is being made: a line of what is
    happening, an element of the caller's (the video's preview, which has to
    be in the page for a browser to record it) and Stop.

    Returns { stopped, say(text), offer({ body, yes, no }), close() }.
    `stopped` settles 'stop' on Stop, Escape or a tap outside, 'closed' on
    close(), or the answer to offer(): 'yes' or 'no'. offer() swaps Stop for
    a last choice (Save video / Discard) once the thing is made; `yes` null
    leaves only `no`. */
export function progress({ title, body = '', extra = null, stop = 'Stop' }) {
  let fin = null, bodyEl = null, status = null, row = null, card = null;
  const stopped = sheet(title, (c, finish) => {
    card = c;
    fin = finish;
    bodyEl = el('p', 'app-sheet-body', body);
    c.append(bodyEl);
    if (extra) c.append(extra);
    status = el('p', 'app-sheet-note', '');
    status.setAttribute('role', 'status');
    c.append(status);
    buttons(c, [{ text: stop, cls: 'ghost', safe: true, on: () => finish('stop') }]);
    row = c.lastElementChild;
  }, 'stop');
  return {
    stopped,
    say: (text) => { if (status) status.textContent = text; },
    offer({ body: said = '', yes = null, no = 'Close' }) {
      if (!card || !row) return;
      if (said) bodyEl.textContent = said;
      status.textContent = '';
      const list = [{ text: no, cls: 'ghost', safe: true, on: () => fin('no') }];
      if (yes) list.push({ text: yes, cls: 'moss', on: () => fin('yes') });
      row.remove();
      buttons(card, list);
      row = card.lastElementChild;
      (row.querySelector('.moss') || row.querySelector('button'))?.focus({ preventScroll: true });
    },
    close: () => fin?.('closed'),
  };
}
