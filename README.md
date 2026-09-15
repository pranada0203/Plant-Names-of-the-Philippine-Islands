# A Dictionary of the Plant Names of the Philippine Islands — web edition

Elmer D. Merrill, *A Dictionary of the Plant Names of the Philippine Islands*.
Bureau of Government Laboratories, Department of the Interior, Manila, 1903
(Publication No. 8). Public domain.

This repository turns the scanned 1903 publication into a searchable web app
that works on desktop and mobile.

**[Open the dictionary →](https://pranada0203.github.io/Plant-Names-of-the-Philippine-Islands/)**
— the canonical address. Any other deployment is a mirror of it.

![The app: a search for "dungon" returning three spellings of one tree, the entry
for DUNGON with Merrill's notes, and the two scanned lines it was read from.](docs/screenshot.png)

A search for `dungon` returns DÚÑGON, DONGÓN and DUÑGÚN — three spellings of one
*Heritiera littoralis*, each labelled with why it is there — and every entry can
show the scanned line it was transcribed from.

## Where things stand

**Every field the book prints has been transcribed by eye from the page images**
— in three passes: Part I's native headwords, Part II's scientific headings, and
finally the scientific name printed on each Part I line. 5,984 corrections over
181 pages. ÍPIL, MOLÁVE, GUÍJO, YÁCAL, TÍNDALO and the rest are searchable;
before the first pass the scan read ÍPIL as "fprz" and a search for it returned
nothing.

Measured by how well the book's two independently OCR'd halves agree with each
other, and by how many headwords are words no Philippine language could produce:

| | Before | After Part I | After Part II | After Part I taxa |
|---|---:|---:|---:|---:|
| Cross-half agreement, exact | 21.1% | 46.9% | 47.4% | **47.2%** |
| Cross-half, unreconcilable | 51.9% | 24.5% | 23.3% | **23.4%** |
| Impossible headwords | 175 | 0 | 0 | **0** |
| Distinct taxa | 2,149 | 2,102 | 1,709 | **1,666** |
| Stub taxa (Part I only) | — | — | 283 | **189** |

The taxon count *fell* because it had been inflated: *Pterocarpus indicus* also
existed as "Prerocarpus rnpicus", *Hopea plagata* as both "Hopea palagata" and
"H. pragata". Correcting the scientific index merged them; the third pass merged
another 40.

The cross-half figures moved by 0.4 points between the last two columns, but not
because of the third pass — that pass does not touch headwords. They were
re-measured after a parser fix recovered 29 Part II entries, which enlarged the
comparison set.

**Every entry can show you the scanned line it was read from.** The Internet
Archive's hOCR gives a bounding box for every word, so stage 2 finds the line
each entry was printed on and the app crops the leaf to it on request — 100% of
Part I's lines and 98.5% of Part II's blocks. A reader who doubts a reading does
not have to take the transcription's word for it.

**It can be browsed, not only searched.** A **Browse** button opens an index of
the book: the alphabet with a count on every letter, the twelve languages
Merrill could identify, and all 147 families — each family showing its genera
with their species beneath.

**Search knows how Merrill spelled.** He records on page 9 that *e*/*i*, *o*/*u*
and *i*/*y* are interchangeable in his sources, so a search for `dungon` returns
DÚÑGON, DONGÓN and DUÑGÚN — three spellings of one tree — each labelled with why
it is there. The matched letters are marked, and his descriptive notes are
searched too, so "gutta-percha" or "used in medicine" finds the plants he says
that about.

**It works offline and installs like an app.** A service worker keeps the shell
and the payload, so after one visit the dictionary needs no network at all; the
page images it keeps separately, because the 1903 scan will not change.

189 taxa still exist only because Part I names them and Part II does not. Most
are not misreadings: they are Merrill's own inconsistent spelling (*Livinstonia*
/ *Livistonia* / *Livistona*, *Jasminum sambac* and "Jasseminum sambac" on
adjacent lines) or plants the scientific index simply omits. See
[docs/source-quality.md](docs/source-quality.md) — automatic merging is still not
safe, and the reasons are worth reading before anyone tries it.

Current extraction, from `npm run build`:

| | |
|---|---|
| Native names | 4,414 |
| Plants (taxa) | 1,666 |
| Plant families | 147 |
| Name → plant links | 5,238 |
| Taxa with Merrill's notes | 1,009 |
| Taxa with a family | 1,465 |
| Entries corrected from the page images | 5,984 |
| Entries located on the page images | 6,492 |
| Lines the parser could not read | 37 |

## Quick start

```bash
npm run build
```

```bash
npm run serve
```

Then open <http://localhost:5173>. There is no bundler and no dependencies —
the app is static files and the pipeline is plain Node. The one thing the app
does not draw itself is its text face, and that is vendored rather than linked:
`app/assets/fonts/` holds two woff2 files of Source Serif 4 (69 KB, SIL OFL,
licence included), fetched by `npm run fonts` and served from the repo, so the
page has no third party in its critical path and still looks like itself
offline. The roman is a variable font, so one file covers every weight the
stylesheet uses.

`npm run build` needs `pdftotext` (poppler) on PATH. If you only want to run the
app, `app/data/dictionary.json` is already committed.

## Layout

```
source/     the scanned PDF (do not edit)
pipeline/   PDF -> text -> structured entries -> app payload
data/       intermediate and diagnostic JSON (data/raw/ is gitignored)
app/        the web app: static HTML, CSS, ES modules (js/scan.js is the page-image
            viewer, sw.js the offline cache, assets/ the generated icons and the
            vendored text face)
docs/       source assessment, data model, roadmap
```

## The pipeline

| Stage | Script | Does |
|---|---|---|
| 1 | `pipeline/01-extract-text.js` | `pdftotext -layout` → `data/raw/pages.json` |
| 1b | `pipeline/01b-fetch-ia.js` | Fetches the Internet Archive hOCR for per-word confidence (network; skippable) |
| 1c | `pipeline/01c-fetch-images.js` | Fetches page images for the vision pass (network; skippable) |
| 2 | `pipeline/02-parse.js` | Parses both halves of the book → `data/part1-*.json`, `data/part2-*.json` |
| 3 | `pipeline/03-build-index.js` | Joins the halves into one graph → `app/data/dictionary.json` |
| 4 | `pipeline/04-audit.js` | Measures how much the scan can be trusted → `data/audit.json` |

Run them individually with `npm run extract | fetch-ia | parse | index | audit`.

Supporting tools:

| Script | Does |
|---|---|
| `pipeline/show-page.js <page>` | Prints what the pipeline currently believes a page says |
| `pipeline/ingest-transcription.js <page>` | Turns a Part I transcription on stdin into a correction file |
| `pipeline/ingest-part2.js <page>` | The same for Part II scientific names |
| `pipeline/show-taxa.js <page>` | Lists the Part I lines whose scientific name has no Part II counterpart |
| `pipeline/ingest-taxa.js <page>` | Turns a transcription of those scientific names into a correction file |
| `pipeline/rekey-corrections.js` | Re-derives every correction after a parser change |
| `pipeline/verify-boxes.js` (`npm run verify-boxes`) | Checks every scan box really sits on its own line |
| `pipeline/make-icons.js` (`npm run icons`) | Draws the app icons and the favicon |
| `pipeline/01d-fetch-fonts.js` (`npm run fonts`) | Vendors the text face into `app/assets/fonts/` |

Stages 1b, 1c and 1d are the only ones that touch the network; everything downstream
works without it, just with no confidence scores. 1d is needed only when the text face
changes — the woff2 files are committed.

### What the parser has to cope with

The book is two indexes over the same facts, printed differently:

- **Part I** (pp. 11–118 of the original, 19–126 of the PDF) — native name →
  scientific name, one entry per line:
  `ANAHAO, T., V. Licuala spectabilis Miq.`
- **Part II** (pp. 119–193 / 127–201) — scientific name → family, descriptive
  note, and the native names for it, hanging-indented across several lines.

Part II is where the family and Merrill's notes live, so the join between the
halves is what makes the app more useful than either index alone. The join is
not clean: the two halves were OCR'd independently and disagree about spelling
often, so the build falls back to one-letter-tolerant matching and records how
each link was made.

Nothing is silently dropped. Lines that do not parse land in `data/issues.json`;
every entry keeps its page number and the raw line it came from, and the app
shows both.

## Design notes

- **No build step.** ES modules, one JSON payload, plain CSS. `app/` is the
  whole site and every path in it is relative, so it serves from a domain root
  or a project subpath without rewriting. It is published to GitHub Pages by
  `.github/workflows/pages.yml` on any push that changes `app/`, and that
  address — `pranada0203.github.io/Plant-Names-of-the-Philippine-Islands` — is
  the canonical one. It will run on any other static host just as well, but a
  second live copy is a separate origin with its own service-worker cache, so
  readers who bookmark a mirror will not see updates made here.
- **The payload is one file** (~1.9 MB, ~350 KB gzipped). Fine for now; if it
  grows, split the search index from the entry bodies.
- **The page images are not in this repository.** 183 leaves is 82 MB, and the
  Internet Archive already hosts them as the source this edition cites. The app
  loads them from there, on demand, only when a reader opens "Show the scan" —
  so the dictionary itself works with no network beyond the payload, and the
  viewer says so plainly when the Archive cannot be reached.
- **Offline is the normal case, not a fallback.** `app/sw.js` caches the shell
  and the payload under a version stamped in by stage 3 — a hash of both the
  data and the app's own files, so neither can go stale while the other moves.
  Leaves are cached separately and never revalidated, since the scan is fixed.
- **An update is never applied underneath the reader.** A new worker waits and
  the page offers a reload. Swapping the payload mid-session would change the
  ids behind the URLs someone is looking at.
- **The icons are drawn by code** (`npm run icons`), not pasted in as binaries
  nobody can regenerate. `pipeline/lib/png.js` is a 60-line PNG writer over
  Node's own zlib.
- **The font is vendored, not linked, and not subset by us** (`npm run fonts`).
  Google already cuts each face into unicode-range subsets, and the whole book
  fits in one of them — every character in the payload is ASCII or Latin-1 — so
  the `latin` file is taken as-is. That is what keeps a webfont from becoming a
  build step. The roman is requested as a weight *range* so Google serves the
  variable file; the italic is requested at 400 alone, because a binomial is
  never set bold and the variable italic's extra 30 KB would buy weights no
  rule could use. Both precache lists, `app/sw.js` and `SHELL_FILES` in
  `pipeline/03-build-index.js`, must name every file it writes; the build warns
  when they drift.
- **The palette is cited, not chosen.** Merrill records four plants for the dyes
  they yield, and those four are the colour system — indigo (*Indigofera*,
  TÁYUM, p. 157), red (*Caesalpinia sappan*, SAPÁNG, p. 131), ochre
  (*Avicennia officinalis*, APIÁPI, p. 127) and mangrove tan (*Bruguiera*,
  BUSÍLI, p. 130). Each has one job and does not borrow: indigo is the frame,
  sappan is action and position, ochre is attention, and the tan is every
  neutral on the sheet. Green is the one colour that is not a dye and is
  reserved for scientific names — the dyes colour the apparatus, green is the
  living thing the book points at. The token block in `app/css/app.css` names
  the plants, so the stylesheet says where each colour came from.
- **Honesty over polish.** Where the scan is doubtful the app says so, on the
  entry, rather than presenting a confident wrong answer.
- **Corrections are data, not edits.** Hand-read entries live in
  `data/corrections/part1/`, `part2/` and `taxa/` and are applied during the build. Editing the generated
  files would not survive `npm run build`.
- **Theme-aware and responsive** — two panes on desktop, list-then-detail on
  phones, light and dark.

## Licence and attribution

The code — pipeline, app and docs — is MIT licensed; see [LICENSE](LICENSE).

The book is not the code's to license. Merrill's 1903 text is in the public
domain, as is the Internet Archive's scan of it, and the transcriptions in
`data/corrections/` are readings of that text offered on the same terms. Please
keep the attribution to Merrill and the Bureau of Government Laboratories on any
derivative — not because the licence demands it, but because the work is his.
