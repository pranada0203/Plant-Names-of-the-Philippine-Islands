# How good is the source text?

Both halves of the book have now been transcribed by eye from the page images.
This document records how the damage was measured, what the two passes fixed,
and what is still wrong.

Reproduce the numbers with `npm run audit` (writes `data/audit.json`).

## What we are working from

`source/dictionaryofplan00merr.pdf` — 209 pages, a photographic scan of the 1903
printing, with an OCR text layer produced by **Tesseract 5.3**.

## Three things the Internet Archive settled

The PDF is the Internet Archive's own derivative of item
`dictionaryofplan00merr`.

**Its `_djvu.txt` is the same OCR run**, so there was no better text to fetch:
17,040 vs 17,034 distinct tokens, 16,953 shared, identical accent counts, the
differences confined to the cover leaves. That avenue is closed.

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
of what the typeface cost. Before any correction:

| Set on the page as | n | Median confidence | Under 50 |
|---|---:|---:|---:|
| Native headwords — small caps | 4,157 | **45** | **54.1%** |
| Scientific names — roman | 1,383 | **86** | 27.2% |

Two further measurements agreed. Of the 2,908 names the book prints in **both**
halves (OCR'd independently, so a disagreement means one reading is wrong), only
**21.1%** matched exactly and **51.9%** could not be reconciled at all. And
**175 headwords (3.5%)** contained no vowel or an impossible consonant run —
`BAPBDROP`, `BATUCSTC` — words no Philippine language produces.

## The method

Transcribing from the image and *diffing by eye* against the OCR are two jobs,
and the second invites mistakes. So each page is transcribed straight — every
entry, in printed order — and a script does the comparison, aligning the two
sequences with Needleman-Wunsch so a line the parser dropped shifts nothing.

Corrections live in `data/corrections/part1/` and `part2/`, one file per page,
keyed by page plus the scanner's own reading, and are applied during stage 2 —
never edited into generated files, which `npm run build` regenerates.

Each file keeps the **full transcription**, not just the diff, so
`pipeline/rekey-corrections.js` can re-derive every correction after a parser
change. That was used repeatedly, re-keying all 181 pages without re-reading a
single image.

## Pass one: Part I, the native-name index

All **107 pages**, **5,000 headwords corrected** — essentially every one, since
almost all carried at least a lost accent.

It exposed three silent bugs. Multi-word headwords were being split, with the
remainder swallowed into the *scientific name* ("AMORES SECOS, Sp.-Fil.
Chrysopogon aciculatus" parsed as headword AMORES, taxon "SECOS, Sp.-Fil.
Chrysopogon aciculatus"). Correction keys collided where a page reads the same
headword twice meaning two different plants — page 76 has INATA four times.
And re-ingesting a page keyed its corrections to their own output, so the next
clean parse dropped every one.

## Pass two: Part II, the scientific index

All **74 pages**, **511 scientific names corrected**. A genus heading only has
to be corrected once: the parser expands abbreviated species ("A. aspera") from
whichever genus is open, so repairing "Aeiata" to *Aglaia* fixes the six species
beneath it too.

This is what collapsed the duplicate taxa. *Pterocarpus indicus* had also
existed as "Prerocarpus rnpicus", *Hopea plagata* as both "Hopea palagata" and
"H. pragata", *Musa textilis* as "Meco, texttilis". The taxon count fell from
2,102 to **1,709** as those merged, and the survivors carry the family and notes
that had been split across the duplicates.

Four more silent defects surfaced:

- **Part II opened a page earlier than the parser thought.** The boundary was
  anchored on ACHRAS SAPOTA, the first entry of Part II's *second* page; the
  section actually opens with ABROMA ALATA. Twelve scientific entries were lost.
- **Abbreviated initials get destroyed.** "A. ARGENTEA" reaches the text layer
  as ". ARGENTEA", ">>. MINUTIFLORA", "Pp>p>. ROLFEI", or — shifted three
  columns into where the initial used to be — "    MARIANENSIS Chois." Each form
  is now recognised as a species continuing the open genus.
- **Two entries sometimes share one OCR line**, the second swallowed by the
  first. They are split on an interior abbreviated genus; an authority
  ("A. Gray") is told from an epithet ("ODORATISSIMA") by counting capitals,
  since epithets are set in small caps.
- **Wrapped native-name lines were read as headings** — and then became the genus
  for every abbreviated species under them, producing taxa like "Mobóti bunius"
  where the book says *Antidesma bunius*. A heading's first token ends in a
  period; a wrapped name list ends its first token with a comma or semicolon.

## Result

| | Before | After Part I | After Part II |
|---|---:|---:|---:|
| Cross-half agreement, exact | 21.1% | 46.9% | **47.4%** |
| Cross-half, unreconcilable | 51.9% | 24.5% | **23.3%** |
| Implausible headwords | 175 | 0 | **0** |
| Distinct native names | 4,740 | 4,395 | **4,395** |
| Distinct taxa | 2,149 | 2,102 | **1,709** |
| Taxa with a family | 1,184 | 1,196 | **1,437** |
| Taxa with Merrill's notes | 937 | 947 | **1,001** |
| Plant families | 137 | 137 | **147** |

The name count *fell* in pass one because it had been inflated: the same name
misread two ways counted twice. The taxon count fell in pass two for the same
reason.

Median OCR confidence of the scientific names still as the scanner left them is
91, with 5.8% under 50. The roman type was never the problem.

## What is still wrong

**Part I's taxon strings were not transcribed.** The two passes corrected
*headwords* (Part I) and *scientific headings* (Part II). But Part I also prints
a scientific name on every line — "ABACÁ, T., V. Musa textilis Neé." — and those
were left as the scanner read them. Where one is garbled badly enough not to
match its Part II counterpart, it survives as a stub taxon:

- SAMPAGUÍTA still resolves to both *Jasminum sambac* and "Jasseminum sambac".
- ANÁHAO carries "Livistona" and "Livistonia rotundifolia" separately.

**283 of 1,709 taxa are stubs of this kind.** Merging them automatically is not
safe: matching on the species epithet alone would join *Eurycles sylvestris* to
*Pandanus sylvestris*, and *Maranta arundinacea* to *Imperata arundinacea*,
which are different plants. This needs the same treatment the other two fields
got — transcription — or a hand-checked merge list.

Smaller residues: 70 Part I lines still fail to parse (`data/issues.json`), and
12 headwords could not be located in the hOCR so carry no confidence score; the
app treats those as doubtful rather than as fine.
