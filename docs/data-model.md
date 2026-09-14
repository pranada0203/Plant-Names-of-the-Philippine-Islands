# Data model

`app/data/dictionary.json` is the single file the app loads. Everything else in
`data/` is intermediate or diagnostic.

Hand-read corrections live in `data/corrections/part1/` (Part I native
headwords), `data/corrections/part2/` (Part II scientific names) and
`data/corrections/taxa/` (the scientific name printed on each Part I line), one
file per page, applied during stage 2. See
[source-quality.md](source-quality.md).

## Shape

```jsonc
{
  "meta":          { /* title, counts, provenance — see below */ },
  "dialects":      { "T": "Tagalog", "V": "Visayan", ... },
  "dialectCounts": { "T": 2411, ... },
  "families":      { "Leguminosae": 148, ... },
  "names":         [ /* native names */ ],
  "taxa":          [ /* plants */ ]
}
```

`names` and `taxa` are arrays; **an entry's array index is its id**, and links
between them are those indices. That keeps the payload small and lookups O(1).

## `names[]` — a native plant name

```jsonc
{
  "id": 191,
  "name": "ANAHAO",           // normalised for display and sorting
  "printed": "ANAHAO",        // as the scan read it, shown under "as the scan reads it"
  "key": "anahao",            // folded for search;  = an undecodable glyph
  "dialects": ["T", "V"],     // keys into `dialects`
  "places": ["Cagayan"],      // where Merrill gave a province instead of a language
  "taxa": [                   // the plants this name denotes
    { "id": 812, "authority": "Miq.", "printed": "Licuala spectabilis Miq.", "via": "partII-near" }
  ],
  "pages": [24],              // scan leaf, for checking against the PDF
  "printedPages": ["16"],     // page number as the book itself paginates
  "confidence": 68,           // lowest x_wconf the OCR engine gave this headword
  "flags": ["accent-lost"]    // see below
}
```

One record per *distinct* headword. Merrill lists the same headword on several
lines when it denotes several plants; those lines are merged, and `taxa`,
`dialects`, `places` and `pages` accumulate across them.

`taxa[].via` records how the link was made, so a doubtful join can be traced:

| `via` | Meaning |
|---|---|
| *(absent)* | Printed directly in Part I under this headword |
| `partII` | Part II lists this name under that species, spelled identically |
| `partII-near` | Same, but the two halves differ by one letter |

## `taxa[]` — a plant

```jsonc
{
  "id": 812,
  "name": "Licuala spectabilis",   // botanical convention: Genus species
  "printed": "LICUALA SPECTABILIS",// as the book sets it
  "authority": "Miq.",
  "genus": "LICUALA",
  "family": "Palmae",
  "familySource": "fuzzy",         // how the family was determined
  "notes": "A low stemless palm...",
  "page": 171,
  "fromPartII": true,              // false = only ever mentioned in Part I
  "names": [191, 402, 1130],       // indices into `names`
  "extraNames": [                  // printed in Part II, no match in Part I
    { "name": "Silag", "dialects": ["Il"], "place": null }
  ]
}
```

`familySource`:

| Value | Meaning |
|---|---|
| `exact` | The printed family name matched Merrill's list as-is |
| `fuzzy` | Repaired from a mangled ligature — `Legwminosew` → `Leguminosae` |
| `inherited` | The species line gave none; taken from its genus heading |
| `null` | No family recorded |

The ligature repair matters: the 1903 printer's `-aceae` ligature is read by the
scanner as `-acee`, `-acew`, `-aceew` and more. Without repair a single family
shatters into several and the family filter is useless. See
`pipeline/lib/taxonomy.js`.

## Quality flags on `names[]`

| Flag | Meaning |
|---|---|
| `accent-lost` | An accented vowel was flattened; the vowel's identity is gone |
| `glyph-damage` | The headword contains characters that are not letters |
| `dialect-unrecognised` | The language abbreviation did not match Merrill's list |
| `taxon-suspect` | The scientific name on this line does not look like a binomial |

These are **under-inclusive by design**: they catch damage the pipeline can see.
They do not catch a word misread as a different plausible word.

## `confidence` — the signal that supersedes the flags

`names[].confidence` is the lowest `x_wconf` Tesseract gave any word of the
headword, read from the Internet Archive hOCR (stage 1b). It is a measurement,
where the flags above are a guess, and the app prefers it: `fprz` carries no
flag at all but scores **9**.

| Range | The app says |
|---|---|
| 70–100 | nothing — the reading stands |
| 40–69 | "the scanner was unsure of this reading" |
| 0–39 | "the scanner was guessing here"; marked *misread?* in results |
| `null` | the word was not located in the hOCR — unknown, not fine |

`null` is treated as doubtful by the "Hide doubtful readings" filter, because
passing an unverified reading silently would defeat the filter.

See [source-quality.md](source-quality.md) for what the distribution looks like
and why it is concentrated in the small-caps headwords.

## `meta.provenance`

Carries the parse report, the audit counts, and how many links came from where —
so a future reader can tell how the numbers in the app were arrived at without
re-running the pipeline.

## Search keys

`key` is folded: lowercased, diacritics stripped, punctuation removed, and the
scan's digit-for-letter substitutions undone (`l6po` → `lopo`, `c4gon` →
`cagon`; digits never occur in these names, so a digit is always a misread
letter). An undecodable glyph becomes ``, which the client matcher treats
as a wildcard so a half-read name is still findable.

`app/js/search.js` applies the same folding to the query, then ranks: exact,
prefix, substring, one-letter-different, scientific-name match.
