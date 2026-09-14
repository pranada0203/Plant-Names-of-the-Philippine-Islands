# A Dictionary of the Plant Names of the Philippine Islands — web edition

Elmer D. Merrill, *A Dictionary of the Plant Names of the Philippine Islands*.
Bureau of Government Laboratories, Department of the Interior, Manila, 1903
(Publication No. 8). Public domain.

This repository turns the scanned 1903 publication into a searchable web app
that works on desktop and mobile.

## Where things stand

The full pipeline runs and the app works. **The limiting factor is not the code,
it is the scan.** See [docs/source-quality.md](docs/source-quality.md).

The short version: Merrill set the native names in small capitals, and the OCR
handled them badly. On the same pages, in the same scan, the roman scientific
names score a median confidence of 86 while the small-caps headwords score 45 —
and only 1,117 of 4,740 headwords (23.6%) reach a confidence of 70. The app now
reports that per entry instead of presenting every reading as equally sound, but
the remedy is better text, not more parsing.

Fetching the Internet Archive's own OCR settled one question: the PDF's text
layer and the IA's `_djvu.txt` are the same Tesseract run, sharing 16,953 of
17,040 tokens. What the IA did add is **hOCR**, carrying a confidence score and
a bounding box for every word — which is where the numbers above come from.

Current extraction, from `npm run build`:

| | |
|---|---|
| Native names | 4,740 |
| Plants (taxa) | 2,149 |
| Plant families | 137 |
| Name → plant links | 5,591 |
| Pages with descriptive notes | 937 taxa |
| Lines the parser could not read | 84 of ~5,100 |
| Headwords the OCR engine was confident about | 1,117 (23.6%) |

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
| 2 | `pipeline/02-parse.js` | Parses both halves of the book → `data/part1-*.json`, `data/part2-*.json` |
| 3 | `pipeline/03-build-index.js` | Joins the halves into one graph → `app/data/dictionary.json` |
| 4 | `pipeline/04-audit.js` | Measures how much the scan can be trusted → `data/audit.json` |

Run them individually with `npm run extract | fetch-ia | parse | index | audit`.
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
- **Theme-aware and responsive** — two panes on desktop, list-then-detail on
  phones, light and dark.

## Licence and attribution

The 1903 text is in the public domain. Please keep the attribution to Merrill
and the Bureau of Government Laboratories on any derivative.
