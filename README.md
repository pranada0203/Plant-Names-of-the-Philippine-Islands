# A Dictionary of the Plant Names of the Philippine Islands — web edition

Elmer D. Merrill, *A Dictionary of the Plant Names of the Philippine Islands*.
Bureau of Government Laboratories, Department of the Interior, Manila, 1903
(Publication No. 8). Public domain.

This repository turns the scanned 1903 publication into a searchable web app
that works on desktop and mobile.

## Where things stand

**Both halves of the book have been transcribed by eye from the page images.**
All 181 pages: 5,000 native headwords and 511 scientific names corrected. ÍPIL,
MOLÁVE, GUÍJO, YÁCAL, TÍNDALO and the rest are searchable; before the pass the
scan read ÍPIL as "fprz" and a search for it returned nothing.

Measured by how well the book's two independently OCR'd halves agree with each
other, and by how many headwords are words no Philippine language could produce:

| | Before | After Part I | After Part II |
|---|---:|---:|---:|
| Cross-half agreement, exact | 21.1% | 46.9% | **47.4%** |
| Cross-half, unreconcilable | 51.9% | 24.5% | **23.3%** |
| Impossible headwords | 175 | 0 | **0** |
| Distinct taxa | 2,149 | 2,102 | **1,709** |

The taxon count *fell* because it had been inflated: *Pterocarpus indicus* also
existed as "Prerocarpus rnpicus", *Hopea plagata* as both "Hopea palagata" and
"H. pragata". Correcting the scientific index merged them.

Still outstanding: Part I also prints a scientific name on every line, and those
were not transcribed, so 283 of 1,709 taxa remain as stubs of a misread binomial.
See [docs/source-quality.md](docs/source-quality.md) — automatic merging is not
safe, and the reasons are worth reading before anyone tries it.

Current extraction, from `npm run build`:

| | |
|---|---|
| Native names | 4,395 |
| Plants (taxa) | 1,709 |
| Plant families | 147 |
| Name → plant links | 5,275 |
| Taxa with Merrill's notes | 1,001 |
| Taxa with a family | 1,437 |
| Entries corrected from the page images | 5,511 |
| Lines the parser could not read | 70 |

## Quick start

```bash
npm run build
```

```bash
npm run serve
```

Then open <http://localhost:5173>. There is no bundler and no dependencies —
the app is static files and the pipeline is plain Node.

`npm run build` needs `pdftotext` (poppler) on PATH. If you only want to run the
app, `app/data/dictionary.json` is already committed.

## Layout

```
source/     the scanned PDF (do not edit)
pipeline/   PDF -> text -> structured entries -> app payload
data/       intermediate and diagnostic JSON (data/raw/ is gitignored)
app/        the web app: static HTML, CSS, ES modules
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
| `pipeline/rekey-corrections.js` | Re-derives every correction after a parser change |

Stages 1b and 1c are the only ones that touch the network; everything downstream works
without it, just with no confidence scores.

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

- **No build step.** ES modules, one JSON payload, plain CSS. It can be hosted
  on any static host, including GitHub Pages.
- **The payload is one file** (~1.6 MB, ~400 KB gzipped). Fine for now; if it
  grows, split the search index from the entry bodies.
- **Honesty over polish.** Where the scan is doubtful the app says so, on the
  entry, rather than presenting a confident wrong answer.
- **Corrections are data, not edits.** Hand-read entries live in
  `data/corrections/part1/` and `part2/` and are applied during the build. Editing the generated
  files would not survive `npm run build`.
- **Theme-aware and responsive** — two panes on desktop, list-then-detail on
  phones, light and dark.

## Licence and attribution

The 1903 text is in the public domain. Please keep the attribution to Merrill
and the Bureau of Government Laboratories on any derivative.
