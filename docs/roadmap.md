# Roadmap

Ordered by what unblocks the most. Sections 0, 1 and 6 are done; the rest is
not started.

## 0. Text quality — done

Every field the book prints has been transcribed from the page images, in three
passes: 5,000 native headwords, 911 scientific names, and the 73 Part I taxon
strings that needed it. Cross-half agreement rose from 21.1% to 47.0%, the count
of headwords no Philippine language could produce fell from 175 to zero, and the
taxon count fell from 2,149 to 1,669 as duplicate spellings of the same plant
merged.

What remains is not a transcription problem. 188 taxa still exist only because
Part I names them and Part II does not, but the readings are faithful: they are
Merrill's own inconsistent spellings (*Livinstonia* / *Livistonia* /
*Livistona*) or plants the scientific index omits. Closing that gap needs a
hand-checked list of the author's variants; merging automatically on the species
epithet is **not** safe. See [source-quality.md](source-quality.md).

## 1. "Show me the page" — done

Every entry carries the box of the line it was printed on, found by aligning the
parsed entries against the hOCR's own line boxes: 100% of Part I's lines and
98.5% of Part II's blocks. The app crops the leaf to that box on request, and a
second click pulls back to the whole page. The images come from the Internet
Archive rather than this repository.

What is left here is small: 2 native names and 22 Part II blocks could not be
located and so offer nothing to look at, and the leaf is fetched fresh each
time rather than being cached for offline use (see section 4).

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
is not yet installable. A service worker would also let the page images be kept
after first view, which is the one part of the app that needs the network. `app/assets/icon-192.png` and `icon-512.png` need to
exist. Given the payload is one JSON file, offline is close to free once a
service worker caches the shell plus `data/dictionary.json`.

## 5. Modern names

Merrill's 1903 nomenclature is superseded. *Afzelia bijuga* is now *Intsia
bijuga*; many families have been split or renamed. Mapping to accepted modern
names (POWO / World Flora Online) would make the book usable by people who know
the current names — but it is a separate dataset and a separate sourcing
decision, and it must be shown as an *addition* to Merrill, never as a
correction of him.

## 6. Corrections as data — done

Hand-read entries live in `data/corrections/part1/`, `part2/` and `taxa/`, one
file per page, and are applied during the parse rather than edited into the
generated files. Each is keyed by page plus the scanner's own reading, so a
parser change that alters what a line reads reports the correction as stale
instead of dropping it silently; `pipeline/rekey-corrections.js` re-derives the
whole set from the stored transcriptions.

## Known rough edges in what exists

- 70 Part I lines still fail to parse (`data/issues.json`); most are lines the
  scan mangled past recognition, but they are worth a read.
- Part II: one family spelling still unresolved (`Cebu`, which is a province and
  not a family at all) and 17 entries carry no family.
- Some Part II blocks absorb the page's running head or a stray marginal
  fragment into their notes.
- The payload is served uncompressed by `pipeline/serve.js`; any real host will
  gzip it, but local loads move 1.6 MB.
