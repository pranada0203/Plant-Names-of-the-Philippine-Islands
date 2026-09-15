/**
 * Browsing, as distinct from searching.
 *
 * Search answers a question you already have. A dictionary is also for the
 * other thing — turning pages to find out what is in it. Three ways in:
 *
 *   by letter    the A–Z index, as the book prints it
 *   by language  every Bicol name, every Zambales name
 *   by family    the botany, with genera and their species beneath
 *
 * These are views over the payload already in memory; nothing is fetched and
 * nothing is precomputed until the reader asks for it.
 */

import { initialOf } from './search.js';

let data = null;
let open = null;
let letters = null;   // [{ letter, ids }] built on first use

export function initBrowse(payload, openEntry) {
  data = payload;
  open = openEntry;
  letters = null;
}

function byLetter() {
  if (letters) return letters;
  const groups = new Map();
  data.names.forEach((n, i) => {
    const c = initialOf(n.name);
    if (!/^[A-Z]$/.test(c)) return;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(i);
  });
  letters = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'))
    .map(([letter, ids]) => ({ letter, ids }));
  return letters;
}

/* ------------------------------------------------------------- fragments */

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A link into a browse view. */
function indexLink(label, count, hash, cls = 'browse-chip') {
  const a = document.createElement('a');
  a.className = cls;
  a.href = '#' + hash;
  a.append(label);
  if (count !== null) a.append(h('span', 'browse-count', String(count)));
  return a;
}

/** A clickable entry, for the dense lists. */
function entryLink(kind, id, label, italic = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = italic ? 'browse-entry sci' : 'browse-entry';
  b.textContent = label;
  b.onclick = () => open(kind, id);
  return b;
}

function backLink() {
  const a = document.createElement('a');
  a.className = 'browse-back';
  a.href = '#browse';
  a.textContent = '← All indexes';
  return a;
}

/* ----------------------------------------------------------------- views */

/** The front page of the index: every way in, with its size. */
export function browseIndex() {
  const f = document.createDocumentFragment();
  f.append(h('h2', 'browse-title', 'Browse the dictionary'));
  // The counts come from the payload, not from the sentence: they change every
  // time the pipeline runs, and a number written into the copy goes stale
  // silently -- as these two did.
  const c = data.meta.counts;
  f.append(h('p', 'browse-lede',
    `Merrill recorded ${c.names.toLocaleString()} native names for ` +
    `${c.taxa.toLocaleString()} plants. These are the ways into that, short of ` +
    'knowing what you are looking for.'));

  f.append(h('h3', 'section', 'By letter'));
  const az = h('div', 'browse-az');
  for (const { letter, ids } of byLetter()) {
    az.append(indexLink(letter, ids.length, 'browse/letter/' + letter, 'browse-letter'));
  }
  f.append(az);
  f.append(h('p', 'browse-foot',
    'Accents are ignored, so ÁBAR is under A. Ñ files under N, as it does in the book.'));

  f.append(h('h3', 'section', 'By language'));
  const langs = h('div', 'browse-chips');
  const counts = data.dialectCounts || {};
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([code, n]) => {
    langs.append(indexLink(data.dialects[code] || code, n, 'browse/lang/' + code));
  });
  f.append(langs);
  f.append(h('p', 'browse-foot',
    'Merrill could not identify the language of every name; many carry a province instead, ' +
    'and many carry nothing at all.'));

  const fams = Object.entries(data.families).sort((a, b) => a[0].localeCompare(b[0], 'en'));
  f.append(h('h3', 'section', `By family (${fams.length})`));
  const famBox = h('div', 'browse-chips');
  for (const [name, n] of fams) {
    famBox.append(indexLink(name, n, 'browse/family/' + encodeURIComponent(name)));
  }
  f.append(famBox);
  return f;
}

/** One letter of the A–Z, as a page of names. */
export function browseLetter(letter) {
  const f = document.createDocumentFragment();
  f.append(backLink());
  const group = byLetter().find((g) => g.letter === letter);
  const ids = group ? group.ids : [];
  // A single letter set at heading size looks like a mistake. This is the
  // initial at the head of a section of the index, so it is set as one.
  f.append(h('h2', 'browse-title browse-initial', letter));
  f.append(h('p', 'browse-lede', `${ids.length.toLocaleString()} name${ids.length === 1 ? '' : 's'}`));

  const cols = h('div', 'browse-columns');
  for (const i of ids) cols.append(entryLink('name', i, data.names[i].name));
  f.append(cols);
  return f;
}

/** Every name recorded in one language. */
export function browseLanguage(code) {
  const f = document.createDocumentFragment();
  f.append(backLink());
  const label = data.dialects[code] || code;
  const ids = [];
  data.names.forEach((n, i) => { if (n.dialects.includes(code)) ids.push(i); });

  f.append(h('h2', 'browse-title', label));
  f.append(h('p', 'browse-lede', `${ids.length.toLocaleString()} name${ids.length === 1 ? '' : 's'} ` +
    'Merrill attributes to this language.'));

  const cols = h('div', 'browse-columns');
  for (const i of ids) cols.append(entryLink('name', i, data.names[i].name));
  f.append(cols);
  return f;
}

/** One family, its genera, and the species under each. */
export function browseFamily(family) {
  const f = document.createDocumentFragment();
  f.append(backLink());

  const genera = new Map();
  let species = 0;
  data.taxa.forEach((t, i) => {
    if (t.family !== family) return;
    species++;
    const g = t.genus || '—';
    if (!genera.has(g)) genera.set(g, []);
    genera.get(g).push(i);
  });

  f.append(h('h2', 'browse-title', family));
  f.append(h('p', 'browse-lede',
    `${genera.size} genera, ${species} entries.`));

  const sorted = [...genera.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'));
  const box = h('div', 'browse-genera');
  for (const [genus, ids] of sorted) {
    const block = h('div', 'browse-genus');

    // The book gives a genus its own entry -- "ARECA. (Palmae.) Tall palms..."
    // -- and then the species beneath it as "A. catechu". So the heading is
    // that entry, where there is one, rather than a repeat of it in the list
    // below: a column reading Areca / Areca / alba / catechu helps nobody.
    const own = ids.find((i) => !data.taxa[i].name.includes(' '));
    const heading = own === undefined
      ? h('h3', 'browse-genus-name sci', genus)
      : h('h3', 'browse-genus-name');
    if (own !== undefined) heading.append(entryLink('taxon', own, genus, true));
    block.append(heading);

    const list = h('div', 'browse-species');
    for (const i of ids) {
      if (i === own) continue;
      // The genus is already the heading; repeating it on every line makes the
      // column a wall of the same word.
      const t = data.taxa[i];
      const epithet = t.name.split(/\s+/).slice(1).join(' ');
      list.append(entryLink('taxon', i, epithet || t.name, true));
    }
    block.append(list);
    box.append(block);
  }
  f.append(box);
  return f;
}
