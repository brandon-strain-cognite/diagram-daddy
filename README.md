# Cardinal

Cardinal's Diagram Daddy app creates a reviewed first-pass asset register and
diagram graph from P&IDs when no trustworthy equipment list exists.

## Sources of truth

Read these before changing product behavior:

1. [`app/SPEC.md`](app/SPEC.md) — normative product behavior and acceptance
   scenarios.
2. [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — architecture,
   data contracts, phases, quality gates, and PR sequence.
3. [`docs/adr/0001-document-to-asset-register.md`](docs/adr/0001-document-to-asset-register.md)
   — why Cardinal treats drawings as the source of the initial register.

If implementation and documentation disagree, stop and reconcile them before
adding behavior.

## Current status

The prototype can:

- stage OCR/pattern candidates;
- review boxes over a PDF;
- convert a TIFF page to a Canvas-ready PNG through CDF; and
- review clickable boxes over that derived page.

It does not yet:

- classify legend/reference/note content;
- edit or approve candidates;
- group repeated occurrences into asset identities;
- atomically create assets and approved annotations; or
- create reviewed equipment connections.

The existing full-parsing path in `app/src/diagram.ts` is legacy prototype
behavior. It must not be extended as the bootstrap asset-extraction path.

## Development

```sh
npm --prefix app test
npm --prefix app run build
```

Use the phased PR sequence in the implementation plan. Do not commit customer
drawings, credentials, or derived customer images.
