import { Search, foldMap } from './search.js';
import { initScan, scanFigure, scanAvailable, revealScans } from './scan.js';
import { initOffline } from './offline.js';
import { initBrowse, browseIndex, browseLetter, browseLanguage, browseFamily } from './browse.js';

const el = (id) => document.getElementById(id);
const app = el('app');

let data = null;
let search = null;
let current = null;      // { kind, id }

/* ------------------------------------------------------------------ boot */

async function boot() {
  // Before the payload, not after: if the fetch below fails because there is no
  // network and no cache yet, the worker should still be installed for next
  // time rather than the app giving up entirely.
  initOffline();

  const res = await fetch('data/dictionary.json');
  if (!res.ok) throw new Error(`Could not load dictionary.json (${res.status})`);
  data = await res.json();
  search = new Search(data);
  initScan(data.meta && data.meta.scan);
  initBrowse(data, show);

  fillFilters();
  restoreTheme();
  wire();
  applyRoute();
  renderDetail();
  run();
}

function fillFilters() {
  const dia = el('dialect');
  const counts = data.dialectCounts || {};
  Object.entries(data.dialects)
    .filter(([code]) => counts[code])
    .sort((a, b) => (counts[b[0]] || 0) - (counts[a[0]] || 0))
    .forEach(([code, label]) => {
      dia.append(new Option(`${label} (${counts[code]})`, code));
    });

  const fam = el('family');
  Object.entries(data.families)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([name, n]) => fam.append(new Option(`${name} (${n})`, name)));

  const letters = el('letter');
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') letters.append(new Option(c, c));
}

/* --------------------------------------------------------------- searching */

/**
 * How far to trust a headword, from the OCR engine's own per-word confidence
 * (Tesseract `x_wconf`, via the Internet Archive's hOCR). Below about 40 the
 * engine was effectively guessing: "fprz" — its reading of ÍPIL — scored 9.
 * `null` means the word could not be located in the hOCR at all, which is not
 * the same as being fine.
 */
const DOUBTFUL = 40;
const SOLID = 70;

function confidenceNote(c) {
  if (c === null || c === undefined) return { level: 'unknown', text: 'reading not verified against the scan' };
  if (c < DOUBTFUL) return { level: 'bad', text: `the scanner was guessing here — ${c}/100 confident` };
  if (c < SOLID) return { level: 'weak', text: `the scanner was unsure of this reading — ${c}/100` };
  return { level: 'ok', text: null };
}

let pending = null;
function run() {
  const opts = {
    dialect: el('dialect').value || null,
    family: el('family').value || null,
    letter: el('letter').value || null,
    minConfidence: el('confident').checked ? SOLID : null,
  };
  const { total, results } = search.query(el('q').value, opts);
  renderResults(results, total);
}

function scheduleRun() {
  clearTimeout(pending);
  pending = setTimeout(run, 90);
}

/* --------------------------------------------------------------- rendering */

function renderResults(results, total) {
  const list = el('results');
  list.replaceChildren();

  el('count').textContent = total
    ? `${total.toLocaleString()} match${total === 1 ? '' : 'es'}${total > results.length ? ` · showing ${results.length}` : ''}`
    : 'No matches';

  const frag = document.createDocumentFragment();
  for (const r of results) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.kind = r.kind;
    b.dataset.id = String(r.id);
    if (current && current.kind === r.kind && current.id === r.id) b.setAttribute('aria-current', 'true');

    const head = document.createElement('div');
    head.className = 'headword';
    const sub = document.createElement('div');
    sub.className = 'sub';

    if (r.kind === 'name') {
      const n = data.names[r.id];
      head.append(highlight(n.name, r.at, r.len));
      sub.textContent = n.taxa.map((t) => data.taxa[t.id].name).join(' · ') || '—';
      if (n.dialects.length) {
        const tag = document.createElement('span');
        tag.className = 'kind';
        tag.textContent = n.dialects.map((d) => data.dialects[d] || d).join('/');
        head.append(tag);
      }
      if (confidenceNote(n.confidence).level === 'bad') {
        const d = document.createElement('span');
        d.className = 'doubt';
        d.title = confidenceNote(n.confidence).text;
        d.textContent = 'misread?';
        head.append(d);
      }
    } else {
      const t = data.taxa[r.id];
      head.style.fontStyle = 'italic';
      // A note match is a match on the description, not on the name, so the
      // name is left alone and the description carries the mark instead.
      head.append(r.via === 'note' ? t.name : highlight(t.name, r.at, r.len));
      const tag = document.createElement('span');
      tag.className = 'kind';
      tag.textContent = 'species';
      tag.style.fontStyle = 'normal';
      head.append(tag);
      if (r.via === 'note') sub.append(snippet(t.notes, r.at, r.len));
      else sub.textContent = t.family || (t.notes ? t.notes.slice(0, 70) : '—');
    }
    const why = WHY[r.via];
    if (why) {
      const tag = document.createElement('span');
      tag.className = 'why';
      tag.textContent = why;
      head.append(tag);
    }

    b.append(head, sub);
    li.append(b);
    frag.append(li);
  }
  list.append(frag);
}

/**
 * Why a result is in the list, when the reader could not otherwise tell.
 * An exact or prefix match needs no explanation; being shown DUNGUN for
 * DUNGON does.
 */
const WHY = {
  phonetic: 'spelling variant',
  near: 'one letter out',
  note: 'description',
};

/**
 * Mark the part of `text` that matched.
 *
 * The match was found in the folded key -- no accents, no punctuation, i for y
 * -- so its position has to be carried back to the text as printed. `foldMap`
 * records which character of the original produced each character of the key,
 * which makes that exact rather than approximate: a match at key position 4 in
 * ÁLAG-ÁLAG is marked at the right letter even though the fold dropped an
 * accent and a hyphen before it.
 */
function highlight(text, at, len) {
  const frag = document.createDocumentFragment();
  if (!(at >= 0) || !len) { frag.append(text); return frag; }
  const { map } = foldMap(text);
  if (at >= map.length) { frag.append(text); return frag; }
  const from = map[at];
  const to = map[Math.min(at + len, map.length) - 1] + 1;
  const m = document.createElement('mark');
  m.textContent = text.slice(from, to);
  frag.append(text.slice(0, from), m, text.slice(to));
  return frag;
}

/**
 * A window of Merrill's note around the match, with the match marked.
 *
 * The lead is deliberately much shorter than the tail. A result row is one
 * clipped line a few words wide, so a centred window puts the very thing the
 * reader searched for out past the ellipsis -- which is the one word that had
 * to be visible.
 */
function snippet(text, at, len, lead = 14, tail = 90) {
  const frag = document.createDocumentFragment();
  if (!text) return frag;
  const { map } = foldMap(text);
  if (!(at >= 0) || at >= map.length) { frag.append(text.slice(0, 90)); return frag; }
  const from = map[at];
  const to = map[Math.min(at + len, map.length) - 1] + 1;

  // Widen to whole words, so the snippet does not start mid-syllable.
  let start = Math.max(0, from - lead);
  let end = Math.min(text.length, to + tail);
  if (start > 0) { const sp = text.indexOf(' ', start); if (sp >= 0 && sp < from) start = sp + 1; }
  if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > to) end = sp; }

  const m = document.createElement('mark');
  m.textContent = text.slice(from, to);
  frag.append(
    (start > 0 ? '…' : '') + text.slice(start, from),
    m,
    text.slice(to, end) + (end < text.length ? '…' : '')
  );
  return frag;
}

function show(kind, id) {
  current = { kind, id };
  location.hash = `${kind}/${id}`;
  renderDetail();
  for (const b of el('results').querySelectorAll('button')) {
    b.toggleAttribute('aria-current', b.dataset.kind === kind && Number(b.dataset.id) === id);
  }
  app.classList.add('detail-open');
  el('detail').scrollTop = 0;
  el('detail').focus({ preventScroll: true });
}

const BROWSE_VIEWS = {
  letter: browseLetter,
  lang: browseLanguage,
  family: browseFamily,
};

function renderDetail() {
  const box = el('detail-inner');
  box.replaceChildren();
  if (!current) return box.append(placeholder());
  if (current.kind === 'browse') {
    const view = BROWSE_VIEWS[current.view];
    return box.append(view ? view(current.key) : browseIndex());
  }
  box.append(current.kind === 'name' ? nameView(data.names[current.id]) : taxonView(data.taxa[current.id]));
}

// Every flag the parser can set needs wording here. Without it the raw slug is
// shown to the reader, and "taxon-noise" means nothing to anyone outside this
// repository.
const FLAG_TEXT = {
  'accent-lost': 'an accent in this word could not be read from the scan',
  'glyph-damage': 'the scan produced characters that are not letters',
  'dialect-unrecognised': 'the language abbreviation could not be read from the scan',
  'dialect-undocumented': 'the book abbreviates the language here but never says what it stands for',
  'taxon-noise': 'a stray mark was attached to the scientific name and removed',
  'taxon-suspect': 'the scientific name may be misread',
};

function nameView(n) {
  const f = document.createDocumentFragment();

  const head = document.createElement('div');
  head.className = 'entry-head';
  const h = document.createElement('h2');
  h.textContent = n.name;
  head.append(h);

  const meta = document.createElement('div');
  meta.className = 'meta';
  for (const d of n.dialects) meta.append(tag(data.dialects[d] || d));
  for (const p of n.places) meta.append(tag(p));
  if (!n.dialects.length && !n.places.length) meta.append(tag('language not recorded'));

  // The engine's own confidence supersedes our heuristic flags where it exists:
  // "glyph-damage" is a guess about the reading, x_wconf is a measurement of it.
  const note = confidenceNote(n.confidence);
  if (note.text) {
    const c = document.createElement('span');
    c.className = 'conf';
    c.textContent = note.text;
    meta.append(c);
  }
  for (const flag of n.flags) {
    if (note.level !== 'ok' && flag === 'glyph-damage') continue;
    meta.append(tag(FLAG_TEXT[flag] || flag, true));
  }
  head.append(meta);
  f.append(head);

  f.append(section('Identified as'));
  if (n.taxa.length) {
    const ul = document.createElement('ul');
    ul.className = 'taxon-list';
    for (const ref of n.taxa) {
      const t = data.taxa[ref.id];
      const li = document.createElement('li');

      const a = document.createElement('button');
      a.className = 'sci';
      a.type = 'button';
      a.style.cssText = 'background:none;border:0;padding:0;cursor:pointer;text-align:left';
      a.textContent = t.name;
      a.onclick = () => show('taxon', t.id);
      li.append(a);

      if (ref.authority || t.authority) {
        const au = document.createElement('span');
        au.className = 'auth';
        au.textContent = ' ' + (ref.authority || t.authority);
        li.append(au);
      }
      if (t.family) li.append(div('fam', t.family));
      if (t.notes) li.append(div('note', t.notes));
      ul.append(li);
    }
    f.append(ul);
  } else {
    f.append(div('notes', 'No scientific name was recorded for this entry.'));
  }

  // Sibling names: other words the book records for the same plants.
  const siblings = new Map();
  for (const ref of n.taxa) {
    for (const id of data.taxa[ref.id].names) {
      if (id !== n.id) siblings.set(id, data.names[id]);
    }
  }
  if (siblings.size) {
    f.append(section(`Also called (${siblings.size})`));
    f.append(chips([...siblings.values()].sort((a, b) => a.name.localeCompare(b.name))));
  }

  const scan = scanSection(n.sightings, n.printed);
  if (scan) f.append(scan);
  f.append(source(pageCitation(n.sightings), n.printed));
  return f;
}

function taxonView(t) {
  const f = document.createDocumentFragment();

  const head = document.createElement('div');
  head.className = 'entry-head';
  const h = document.createElement('h2');
  h.className = 'sci';
  h.textContent = t.name;
  head.append(h);

  const meta = document.createElement('div');
  meta.className = 'meta';
  if (t.authority) meta.append(tag(t.authority));
  if (t.family) {
    meta.append(tag(t.family + (t.familySource === 'inherited' ? ' (from genus)' : '')));
  } else {
    meta.append(tag('family not recorded', true));
  }
  if (!t.fromPartII) meta.append(tag('no entry in the scientific index', true));
  head.append(meta);
  f.append(head);

  if (t.notes) {
    f.append(section('Merrill’s note'));
    f.append(div('notes', t.notes));
  }

  const named = t.names.map((i) => data.names[i]);
  if (named.length) {
    f.append(section(`Native names (${named.length})`));
    f.append(chips(named.sort((a, b) => a.name.localeCompare(b.name))));
  }

  if (t.extraNames && t.extraNames.length) {
    f.append(section(`Also listed here only (${t.extraNames.length})`));
    const box = document.createElement('div');
    box.className = 'chips';
    for (const v of t.extraNames) {
      const s = document.createElement('span');
      s.className = 'chip';
      s.style.cursor = 'default';
      s.textContent = v.name;
      if (v.dialects.length || v.place) {
        const d = document.createElement('span');
        d.className = 'dia';
        d.textContent = v.dialects.map((x) => data.dialects[x] || x).join('/') || v.place;
        s.append(d);
      }
      box.append(s);
    }
    f.append(box);
  }

  const cite = [{ page: t.page, printedPage: t.printedPage, box: t.box }];
  const scan = scanSection(cite, t.printed);
  if (scan) f.append(scan);
  f.append(source(pageCitation(cite), t.printed + (t.authority ? ' ' + t.authority : '')));
  return f;
}

/* ---------------------------------------------------------------- fragments */

/**
 * Cite the page a reader would find in a physical copy when we know it, and
 * say plainly when the number is the scan leaf instead.
 */
function pageCitation(sightings) {
  const printed = [...new Set(sightings.map((s) => s.printedPage).filter(Boolean))];
  if (printed.length) return `Page ${printed.join(', ')} of the 1903 printing`;
  const leaves = [...new Set(sightings.map((s) => s.page))];
  return `Scan leaf ${leaves.join(', ')}`;
}

/**
 * The scan itself, folded away until asked for.
 *
 * Closed by default for two reasons: the reader came here for the dictionary,
 * not the photograph, and a `<details>` that is shut keeps the browser from
 * fetching the leaf at all. A headword printed on six lines gets six strips —
 * they are six different plants, and the whole point is to let someone check
 * which line says what.
 */
function scanSection(sightings, printed) {
  if (!scanAvailable()) return null;
  const usable = (sightings || []).filter((s) => s && s.box);
  if (!usable.length) return null;

  const d = document.createElement('details');
  d.className = 'scan-block';
  const sum = document.createElement('summary');
  sum.textContent = usable.length > 1
    ? `Show the scan (${usable.length} lines)`
    : 'Show the scan';
  d.append(sum);
  // The leaves are fetched when the reader asks for them, and not before: a
  // closed disclosure should cost nothing.
  d.addEventListener('toggle', () => { if (d.open) revealScans(d); });
  for (const s of usable) {
    const fig = scanFigure(s, printed);
    if (fig) d.append(fig);
  }
  return d;
}

function tag(text, warn = false) {
  const s = document.createElement('span');
  s.className = warn ? 'tag warn' : 'tag';
  s.textContent = text;
  return s;
}
function div(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
}
function section(text) {
  const h = document.createElement('h3');
  h.className = 'section';
  h.textContent = text;
  return h;
}
function chips(names) {
  const box = document.createElement('div');
  box.className = 'chips';
  for (const n of names) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = n.name;
    if (n.dialects.length) {
      const d = document.createElement('span');
      d.className = 'dia';
      d.textContent = n.dialects.map((x) => data.dialects[x] || x).join('/');
      b.append(d);
    }
    // A doubtful sibling is worth marking here especially: the reader is being
    // told "this plant is also called X", and X may not be a real word.
    const note = confidenceNote(n.confidence);
    if (note.level === 'bad') {
      b.classList.add('doubtful');
      b.title = note.text;
    }
    b.onclick = () => show('name', n.id);
    box.append(b);
  }
  return box;
}
function source(where, printed) {
  const d = document.createElement('div');
  d.className = 'source';
  d.append(document.createTextNode(where + ' · as the scan reads it:'));
  const c = document.createElement('code');
  c.textContent = printed;
  d.append(c);
  return d;
}

function placeholder() {
  const c = data.meta.counts;
  const d = document.createElement('div');
  d.className = 'placeholder';
  d.innerHTML = `
    <h2>A Dictionary of the Plant Names of the Philippine Islands</h2>
    <p>Elmer D. Merrill, Botanist. Bureau of Government Laboratories,
       Department of the Interior, Manila, 1903.</p>
    <p>Search a native name (<em>anahao</em>, <em>abaca</em>) or a scientific one
       (<em>Musa</em>, <em>Ficus</em>).</p>
    <dl>
      <dt>Native names</dt><dd>${c.names.toLocaleString()}</dd>
      <dt>Plants</dt><dd>${c.taxa.toLocaleString()}</dd>
      <dt>Families</dt><dd>${c.families}</dd>
      <dt>Cross-references</dt><dd>${c.links.toLocaleString()}</dd>
    </dl>
    <p style="margin-top:1.5rem;font-size:0.85rem">
      Text is transcribed from a scan of the 1903 printing and has not been fully
      proofread. Every entry shows the page it came from and the raw line it was
      read from, so you can check it against the original.</p>`;
  return d;
}

/* --------------------------------------------------------------- plumbing */

function wire() {
  el('q').addEventListener('input', scheduleRun);
  for (const id of ['dialect', 'family', 'letter', 'confident']) el(id).addEventListener('change', run);

  el('results').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kind]');
    if (b) show(b.dataset.kind, Number(b.dataset.id));
  });

  el('back').addEventListener('click', () => {
    app.classList.remove('detail-open');
    location.hash = '';
  });

  el('theme').addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme');
    const next = now === 'dark' ? 'light' : now === 'light' ? '' : 'dark';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('theme', next); } catch { /* private mode */ }
  });

  el('about').addEventListener('click', () => {
    location.hash = '';
    current = null;
    renderDetail();
    app.classList.add('detail-open');
  });
  el('browse').addEventListener('click', () => { location.hash = 'browse'; });

  window.addEventListener('hashchange', () => { applyRoute(); renderDetail(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== el('q')) { e.preventDefault(); el('q').focus(); }
    if (e.key === 'Escape') { app.classList.remove('detail-open'); el('q').focus(); }
  });
}

function applyRoute() {
  const hash = location.hash;

  // #browse, or #browse/<view>/<key>. The key is a letter, a dialect code or a
  // family name, so it is percent-encoded on the way in.
  if (hash === '#browse' || hash.startsWith('#browse/')) {
    const [, view, ...rest] = hash.slice('#browse'.length).split('/');
    current = { kind: 'browse', view: view || null, key: decodeURIComponent(rest.join('/') || '') };
    app.classList.add('detail-open');
    return;
  }

  const m = /^#(name|taxon)\/(\d+)$/.exec(hash);
  if (!m) { current = null; return; }
  const id = Number(m[2]);
  const pool = m[1] === 'name' ? data.names : data.taxa;
  current = id < pool.length ? { kind: m[1], id } : null;
  if (current) app.classList.add('detail-open');
}

function restoreTheme() {
  try {
    const t = localStorage.getItem('theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch { /* private mode */ }
}

boot().catch((err) => {
  el('detail-inner').innerHTML =
    `<div class="placeholder"><h2>Could not load the dictionary</h2><p>${err.message}</p>
     <p>Run <code>npm run build</code> to regenerate <code>app/data/dictionary.json</code>,
     and serve this folder over HTTP rather than opening the file directly.</p></div>`;
  app.classList.add('detail-open');
});
