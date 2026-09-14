# Roadmap

Ordered by what unblocks the most. Nothing below is started.

## 0. Decide the text-quality question first

Everything else is polish on top of text that is currently wrong about half the
time on cross-checkable names. See [source-quality.md](source-quality.md) for
the measurements and the four options. This is a decision for you, not a task
for the pipeline: the cheapest option (fetch the Internet Archive's own OCR)
needs your go-ahead because it means fetching from an external service.

Until it is settled, treat the app as a working prototype over provisional text.

## 1. The reader's obvious next question: "show me the page"

Every entry already records its PDF page. If we obtain page images (which comes
free with options 1–3 above), the detail view can show the scanned line beside
the transcription. That converts every quality flag from a warning into
something the reader can resolve themselves, and it is the single highest-value
feature this app can have given the state of the text.

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
