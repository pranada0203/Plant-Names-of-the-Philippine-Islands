# Roadmap

Ordered by what unblocks the most. Nothing below is started.

## 0. Text quality — largely done

Both halves have been transcribed from the page images: 5,000 native headwords
and 511 scientific names. Cross-half agreement rose from 21.1% to 47.4%, and the
count of headwords no Philippine language could produce fell from 175 to zero.

What remains is Part I's *taxon strings* — the scientific name printed on each
native-name line, which neither pass touched. 283 of 1,709 taxa are stubs of a
misread binomial as a result, so a few plants still appear twice under two
spellings. See [source-quality.md](source-quality.md), and note in particular
why merging them automatically on the species epithet is **not** safe.

## 1. The reader's obvious next question: "show me the page"

Every entry records its scan leaf and its printed page number, the hOCR gives a
bounding box for every word, and `npm run fetch-images` now downloads the page
images. Everything needed to crop the scanned line and show it beside the
transcription is in place; only the UI work is left. It would let a reader
settle any remaining doubt themselves, and it is the single highest-value
feature this app can still gain.

## 2. Search

- Diacritic- and variant-tolerant search is in; **phonetic** search is not.
  Merrill himself documents the variation — *e/i*, *o/u*, *i/y* interchange,
  `ñ` for *ng*. A fold that collapses those classes would find `dungon` from
  `dungun`, which one-letter tolerance already half-does but not deliberately.
- No highlighting of the matched span in results.
- No search within Merrill's descriptive notes, which are full of useful terms
  ("valuable timber", "gutta-percha", "used in medicine").

## 3. Browse, not just search

A dictionary is for browsing. Missing:

- A–Z index that feels like flipping pages.
- Browse by family, and by genus within family.
- Browse by language — "every Bicol name in the book" is a genuinely
  interesting view and the data supports it today.

## 4. Offline

The manifest is written but there is **no service worker and no icons**, so it
is not yet installable. `app/assets/icon-192.png` and `icon-512.png` need to
exist. Given the payload is one JSON file, offline is close to free once a
service worker caches the shell plus `data/dictionary.json`.

## 5. Modern names

Merrill's 1903 nomenclature is superseded. *Afzelia bijuga* is now *Intsia
bijuga*; many families have been split or renamed. Mapping to accepted modern
names (POWO / World Flora Online) would make the book usable by people who know
the current names — but it is a separate dataset and a separate sourcing
decision, and it must be shown as an *addition* to Merrill, never as a
correction of him.

## 6. Corrections as data

If any hand-correction happens, it must not be edits to generated files —
`npm run build` would erase them. It needs a `data/corrections.json` that stage 3
applies on top of the parse, keyed by page plus raw line, with the original kept
visible. Worth building before the first correction, not after the hundredth.

## Known rough edges in what exists

- 84 Part I lines still fail to parse (`data/issues.json`); most are lines the
  scan mangled past recognition, but they are worth a read.
- Part II: two family spellings still unresolved (`Amarylidew`, `Cwreurbitacew`)
  and 225 entries carry no family.
- Some Part II blocks absorb the page's running head or a stray marginal
  fragment into their notes.
- The payload is served uncompressed by `pipeline/serve.js`; any real host will
  gzip it, but local loads move 1.6 MB.
