# ADR 0001: Treat P&IDs as the source of the initial asset register

- Status: Accepted
- Date: 2026-10-02
- Decision owners: Cardinal project

## Context

Conventional diagram contextualization starts with two existing collections:

1. engineering drawings; and
2. an asset register whose identifiers can be found on those drawings.

Cardinal does not have the second collection. The asset register must be
bootstrapped from OCR, symbols, legends, and repeated marks in the P&IDs.

The distinction matters because a drawing contains many identifiers that are not
assets:

- drawing numbers in reference tables;
- pipe classes in legend symbols;
- material specification references;
- note and title-block numbers; and
- labels explaining line styles.

A detector can accurately read these strings and still be wrong to create
assets from them. Conversely, a pattern library tuned only to known tag formats
can miss handwritten, degraded, or previously unseen tags.

The prototype also runs in a CDF project where some classic write APIs are
restricted. CDM/Data Modeling is the durable write path.

## Decision

Cardinal is a **document-to-register** system.

### Extraction

- CDF OCR is the broad text-and-box baseline.
- CDF Diagram pattern detection is a complementary proposal source.
- Full Diagram parsing against an Asset filter is not the bootstrap extraction
  path.
- Atlas may challenge and classify results but remains advisory.

### Interpretation

- Page region and drawing-set conventions are first-class evidence.
- Legends, notes, title blocks, and reference tables are extracted before their
  contents are used to interpret process-field candidates.
- Every candidate is semantically classified before asset approval is enabled.

### Identity

- An OCR box is an occurrence, not an asset.
- Multiple approved occurrences may resolve to one proposed asset identity.
- Identity uncertainty is handled by review, not aggressive normalization.

### Write boundary

- Detection and classification do not create plant context.
- Explicit human approval is required.
- Asset approval atomically writes one CDM `CogniteAsset`, approved
  `CogniteDiagramAnnotation` occurrences, and review audit links.
- Deterministic IDs make approval idempotent.

### Files and Canvas

- Original TIFF/PDF files remain evidence.
- CDF Diagram convert produces Canvas-ready PNG pages where required.
- Bounding boxes remain normalized coordinates and are not burned into images.
- Approved annotations target the Canvas-viewable page file while retaining
  provenance to the original source page.

### Connections

- Topology extraction is a later proposal layer.
- Legend conventions inform line interpretation.
- Raster-derived connections require review.
- A relation cannot be approved until both endpoint identities exist.

### Entity matching

Entity matching is deferred until another register exists. It reconciles the
P&ID-derived register; it does not generate the first register.

## Consequences

### Positive

- Correct OCR no longer implies incorrect asset creation.
- Legend content becomes useful context instead of false positives.
- Assets are auditable back to approved source evidence.
- Repeated tag occurrences produce one identity and multiple diagram links.
- Canvas receives native file/annotation relationships.
- Atlas can improve difficult cases without becoming an undeclared dependency.

### Costs

- The review model needs regions, classes, provenance, and identity grouping.
- Human review remains necessary for ambiguous text and raster topology.
- The workflow has more stages than direct diagram-to-asset matching.
- Benchmark labeling is required to measure recall and leakage.
- Original-to-derived page provenance must be maintained.

### Risks and mitigations

- **Low OCR recall:** combine broad OCR, pattern detection, Atlas when approved,
  and manual boxes; measure against a labeled benchmark.
- **Legend leakage:** require candidate class and process-field evidence before
  asset approval.
- **Over-merging identities:** use conservative normalization and block approval
  on conflicts.
- **Duplicate writes:** derive deterministic asset/annotation IDs and use one
  Data Modeling apply.
- **Atlas unavailable:** retain a complete CDF-only review path.
- **Schema churn:** use additive containers and explicit migrations; do not
  mistake a view version for a container migration.

## Alternatives considered

### Use full Diagram parsing with an empty or seed asset list

Rejected for bootstrap. It makes extraction quality depend on an inventory that
does not exist and encourages circular creation of the same inventory.

### Turn every tag-shaped OCR result into an asset

Rejected. Drawing numbers, pipe classes, and notes can match tag-like syntax.
Position, symbol, and legend meaning must be considered first.

### Have Atlas create assets directly

Rejected. Model output is probabilistic, private-preview availability can
change, and approval/auditability are product requirements.

### Burn boxes into PNG files

Rejected. Rasterized boxes are not interactive domain context. Normalized CDM
annotations preserve clickability, identity, and review provenance.

### Run Entity matching first

Rejected. Entity matching requires another entity collection. It is useful only
after the P&ID-derived register or another master source exists. The library
module `cdf_entity_matching` matches time series to existing assets. It is a
Phase 8 tool, not the bootstrap.

### Deploy `cdf_p_and_id_annotation` as the reader

Rejected for bootstrap. Accepted for steady state. That module, and
`cdf_file_annotation`, find tags that already exist as assets or files and can
auto-approve them. After Cardinal has created the register, deploy
`cdf_p_and_id_annotation` for new drawings instead of extending the local
full-parsing path. Reuse its annotation ID scheme and write payload. Do not use
its auto-approval threshold while a human must still confirm new tags.

## Follow-up decisions

Separate ADRs are required for:

1. retaining versus migrating the prototype CDF spaces;
2. observation storage shape;
3. asset identity/external-ID normalization; and
4. the approved typed equipment-relation model.
