# Roadmap

Ordered by what unblocks the most. Everything here is done except section 5,
modern nomenclature, which is a separate dataset and a separate decision.

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

## 2. Search — done

- **Phonetic folding.** Merrill says on page 9 that "there is a great variation
  in the spelling of the same word, *e* and *i*, *o* and *u*, and frequently *i*
  and *y* have the same values and are interchangeable." Those classes are now
  collapsed for matching, so `dungon` finds DONGÓN and DUÑGÚN — all three the
  same *Heritiera littoralis*. 191 groups of headwords collapse under the rule.
  Nothing further is folded: two headwords in the whole book contain a `k`, so a
  c/k rule would cost precision and earn nothing.
- **The matched span is marked** in the results, mapped back through the fold so
  it lands on the right letters of the printed word — MALA**DÚÑGUN** — and a
  small tag says *why* a result is there when it is not obvious: a spelling
  variant, a one-letter difference, or a hit in the prose.
- **The notes are searched**, last and only for queries of three letters or
  more. By phrase first, then by words: what Merrill actually writes is "used in
  the practice of medicine", so "used in medicine" has to match on words or it
  finds nothing at all.

What is left is ranking rather than recall — a plant matched in the description
sorts below every name match, which is right for "timber" and arguably wrong
for a query that is obviously prose.

## 3. Browse — done

A **Browse** button in the masthead opens an index of the whole book: the
alphabet with a count on every letter, the twelve languages Merrill could
identify, and all 147 families. Each opens its own page, and each of those is a
URL, so the browser's own back button works through them.

- **A–Z.** Each letter is a page of names in flowing columns — the shape an
  index has in print. This turned up a bug in the existing A–Z *filter*, which
  compared the printed initial directly: 107 headwords begin with an accented
  letter, so ÁBAR was not under A and none of them were reachable. A files 416
  names now, not 357. Ñ files under N, which is not a simplification but what
  Merrill does — his own index runs NENÉNU, ÑGÁLUY, ÑGAÑGAÍTA, NÍGUI, NILÁD.
- **By family, and by genus within it.** Palmae shows 19 genera with their
  species beneath, and where the book gives a genus its own entry — "ARECA.
  (Palmae.) Tall palms..." — the heading *is* that entry rather than a repeat of
  it in the list below.
- **By language.** Every Bicol name, all 199 of them, and so on.

Grouping by genus needed the `genus` field fixed first: it carried whatever case
the page was set in — ARENGA beside Calamus beside CorypHa — which is invisible
until something tries to group by it, and then Palmae has nineteen genera
holding no species each. It is derived from the display binomial now, and 38
case-duplicate genera collapsed.

## 4. Offline — done

`app/sw.js` caches the app and the payload, so after one visit the dictionary
needs no network. Page images are kept in a cache of their own, capped at 80
leaves and never revalidated: the 1903 scan will not change, so a leaf fetched
today is still right after the next twenty builds.

The cache version is a hash of both the payload's reader-visible content and
the app's own files, stamped into `sw.js` by stage 3. Hashing only one of the
two leaves the other stale, which is a bug best found before shipping rather
than after.

A waiting update is offered, never applied: swapping the payload under a reader
mid-session changes the ids behind the URLs they are looking at.

Icons are drawn by `npm run icons` — a leaf, from two circular arcs, over a
60-line PNG writer. The app is installable.

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

- 37 Part I lines still fail to parse (`data/issues.json`). 35 are scan debris
  -- "Le", "o4", "is)" -- and 2 are real entries the text layer cannot give up:
  one whose headword reads "31706", one whose genus lost its capital.
- One dialect marker is still unreadable (`[].` on page 87) and 8 use
  abbreviations the book never defines: C., P., A., F. Those are left
  unresolved rather than guessed at; see source-quality.md.
- Part II: one family spelling still unresolved (`Cebu`, which is a province and
  not a family at all) and 17 entries carry no family.
- Some Part II blocks absorb the page's running head or a stray marginal
  fragment into their notes.
- The payload is served uncompressed by `pipeline/serve.js`; any real host will
  gzip it, but local loads move 1.6 MB.
