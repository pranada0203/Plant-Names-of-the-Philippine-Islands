# Corrections

One file per page, `pNNN.json`, holding headwords read by eye from the Internet
Archive page images where the OCR reading was wrong.

Keyed by page plus the OCR's own reading (`was`), both stable for a given source
PDF. A key that stops matching is reported as stale by `npm run parse` rather
than silently dropped.

```jsonc
{
  "page": 76,
  "entries": [
    { "page": 76, "was": "FPRZ", "headword": "Ípil", "note": "OCR produced a non-word" }
  ]
}
```

These are applied by `pipeline/lib/corrections.js` during stage 2, never edited
into the generated files under `data/` — `npm run build` regenerates those.
