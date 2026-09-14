# A Dictionary of the Plant Names of the Philippine Islands — web edition

Elmer D. Merrill, *A Dictionary of the Plant Names of the Philippine Islands*.
Bureau of Government Laboratories, Department of the Interior, Manila, 1903
(Publication No. 8). Public domain.

This repository turns the scanned 1903 publication into a searchable web app
that works on desktop and mobile.

## Where things stand

**Part I — the native-name index — has been transcribed by eye from the page
images and is sound.** All 107 pages, 5,000 headwords corrected. ÍPIL, MOLÁVE,
GUÍJO, YÁCAL, TÍNDALO and the rest are searchable; before the pass the scan read
ÍPIL as "fprz" and a search for it returned nothing.

**Part II — the scientific index — has not been.** Its binomials and prose are
still as the scanner read them, so some taxa are duplicated under misread names
(*Pterocarpus indicus* also appears as "Prerocarpus rnpicus") and Merrill's
notes carry garbled fragments. See [docs/source-quality.md](docs/source-quality.md)
for what that costs and what fixing it would take.

What the vision pass changed, measured by how well the book's two independently
OCR'd halves agree with each other:

| | Before | After |
|---|---:|---:|
| Cross-half agreement, exact | 21.1% | **46.9%** |
| Cross-half, unreconcilable | 51.9% | **24.5%** |
| Headwords no language could produce | 175 | **0** |

Current extraction, from `npm run build`:

| | |
|---|---|
| Native names | 4,395 |
| Plants (taxa) | 2,102 |
| Plant families | 137 |
| Name → plant links | 5,727 |
| Taxa with Merrill's notes | 947 |
| Headwords corrected from the page images | 5,000 |
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
| `pipeline/ingest-transcription.js <page>` | Turns a transcription on stdin into a correction file |
| `pipeline/rekey-corrections.js` | Re-derives every correction after a parser change |

Stage 1b is the only one that touches the network; everything downstream works
without it, just with no confidence scores.

### What the parser has to cope with

The book is two indexes over the same facts, printed differently:

- **Part I** (pp. 11–117 of the original, 19–127 of the PDF) — native name →
  scientific name, one entry per line:
  `ANAHAO, T., V. Licuala spectabilis Miq.`
- **Part II** (pp. 120–193 / 128–201) — scientific name → family, descriptive
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
- **Corrections are data, not edits.** Hand-read headwords live in
  `data/corrections/` and are applied during the build. Editing the generated
  files would not survive `npm run build`.
- **Theme-aware and responsive** — two panes on desktop, list-then-detail on
  phones, light and dark.

## Licence and attribution

The 1903 text is in the public domain. Please keep the attribution to Merrill
and the Bureau of Government Laboratories on any derivative.
