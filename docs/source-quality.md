# How good is the source text?

Part I — the native-name index, and the half of the book people actually search
— has been transcribed by eye from the page images and is now sound. Part II's
scientific names and prose have not, and are still as the scanner read them.

This document records how that was established and measured. Reproduce the
numbers with `npm run audit` (writes `data/audit.json`).

## What we are working from

`source/dictionaryofplan00merr.pdf` — 209 pages, a photographic scan of the 1903
printing, with an OCR text layer produced by **Tesseract 5.3**.

## Two things the Internet Archive settled

The PDF is the Internet Archive's own derivative of item
`dictionaryofplan00merr`.

**Its `_djvu.txt` is the same OCR run**, so there was no better text to fetch:
17,040 vs 17,034 distinct tokens, 16,953 shared, identical accent counts, and
the differences confined to the cover leaves. That avenue is closed.

**Its hOCR was worth having.** Plain text discards what hOCR keeps — an
`x_wconf` confidence and a bounding box per word. `npm run fetch-ia` downloads
it and stage 2 stamps each headword with the lowest confidence the engine gave
it. That turned quality from a guess into a measurement, and it is what made the
scale of the problem legible:

| Reading | Should be | Confidence |
|---|---|---:|
| `BapBdrop` | *(unrecoverable)* | **1** |
| `Aagnocdsto` | AGNOCÁSTO | **4** |
| `fprz` | ÍPIL | **9** |
| `Cdégon-tocd` | CÓGON-TOCÓ | **25** |
| `Afzelia` (roman, same line as `fprz`) | — | **92** |

**And its page images are served per leaf as JPEG** —
`archive.org/download/<item>/page/n<leaf>.jpg` — so the vision pass needed
neither the 63 MB JP2 archive nor a JPEG 2000 decoder. IA leaf `nX` is our page
`X + 1`.

## Why the damage was where it was

Merrill printed headwords in **small capitals** and the scientific names beside
them in **roman**. Same scan, same page, same engine — a controlled comparison
of what the typeface cost. Before the vision pass:

| Set on the page as | n | Median confidence | Under 50 |
|---|---:|---:|---:|
| Native headwords — small caps | 4,157 | **45** | **54.1%** |
| Scientific names — roman | 1,383 | **86** | 27.2% |

Two further measurements agreed. Of the 2,908 names the book prints in **both**
halves (OCR'd independently, so a disagreement means one reading is wrong),
only **21.1%** matched exactly and **51.9%** could not be reconciled at all. And
**175 headwords (3.5%)** contained no vowel or an impossible consonant run —
`BAPBDROP`, `BATUCSTC` — words no Philippine language produces.

## The vision pass

All **107 pages of Part I** were read from the page images and transcribed.
**5,000 headwords** were corrected — essentially every one, since almost all
carried at least a lost accent.

The transcription was written straight (every headword, in printed order) and
`pipeline/ingest-transcription.js` did the comparison against the parse,
aligning the two sequences with Needleman-Wunsch so a line the parser had
dropped shifted nothing. Corrections live in `data/corrections/`, one file per
page, keyed by page plus the scanner's own reading, and are applied during stage
2 — never edited into generated files, which `npm run build` regenerates.

Each file keeps the **full transcription**, not just the diff, so
`pipeline/rekey-corrections.js` can re-derive every correction after a parser
change. That was used twice here, re-keying all 107 pages without re-reading a
single image.

### Result

| | Before | After |
|---|---:|---:|
| Cross-half agreement, exact | 21.1% | **46.9%** |
| Cross-half, within one letter | 27.0% | 28.7% |
| Cross-half, unreconcilable | **51.9%** | **24.5%** |
| Implausible headwords | 175 (3.5%) | **0** |
| Distinct native names | 4,740 | 4,395 |
| Name → plant links | 5,591 | 5,727 |

The name count *fell* because it was inflated: the same name misread two ways
counted twice. Links *rose* because corrected names now match their Part II
mentions — Part II contributed 2,188 extra links, up from 1,383.

The residual 24.5% is no longer mostly Part I's fault. Merrill himself warns
that spellings vary — "e and i, o and u, and frequently i and y have the same
values and are interchangeable" — and what remains is a mix of that genuine
variation and Part II's still-uncorrected readings.

## What is still wrong

**Part II was not transcribed.** Its scientific names and descriptive prose are
as the scanner read them, and the damage shows wherever the app surfaces them:

- Duplicate taxa from misread binomials — *Pterocarpus indicus* also appears as
  "Prerocarpus rnpicus", *Musa textilis* as "Méco, texttilis", *Hopea plagata*
  as both "Hopea palagata" and "H. pragata".
- Garbled fragments inside Merrill's notes (`Pll avis NG eee aa 12)`).
- Some cross-references are consequently wrong: a name linked to a mangled taxon
  that should have merged with its correct twin.

Fixing this means the same treatment for pages 127–201 (~75 pages), transcribing
the scientific names rather than the headwords. It would collapse the duplicate
taxa and tighten the cross-references. The tooling already exists; only the
ingest script's target would change.

Two smaller residues: 70 Part I lines still fail to parse
(`data/issues.json`), and 12 headwords could not be located in the hOCR so
carry no confidence score — the app treats those as doubtful rather than fine.
