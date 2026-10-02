# Product specification: Diagram Daddy

## 1. Product definition

Diagram Daddy bootstraps an equipment register and a connected diagram graph
from P&IDs when no trustworthy asset list exists.

This is a **document-to-register** workflow. It is not conventional diagram
contextualization against an existing asset hierarchy.

The source drawings contain several kinds of information:

- equipment and instrument tags that may become assets;
- repeated occurrences of the same tag;
- legends and symbol dictionaries;
- pipe classes and line conventions;
- notes and title-block metadata;
- references to other drawings; and
- lines that may imply equipment-to-equipment connections.

OCR must read all of these. Only an approved equipment or instrument tag may
create a `CogniteAsset`.

## 2. Product principles

1. **Recall before promotion.** Extraction should surface plausible marks for
   review. It must not silently turn every OCR string into an asset.
2. **Meaning comes from position and convention.** Identical text can mean an
   asset tag, a drawing number, or a pipe class depending on its region and
   symbol.
3. **Legends are data.** Legends and notes form a drawing-set dictionary used
   to interpret process-field marks and lines.
4. **Approval is the write boundary.** OCR, Diagram detection, and Atlas create
   proposals only.
5. **One identity, many occurrences.** Repeated appearances of a tag become one
   asset and multiple diagram annotations.
6. **The original is preserved.** TIFF/PDF files remain extraction evidence.
   Browser- and Canvas-ready page images are derived files with provenance.
7. **CDF first.** Use CDF OCR, Diagram APIs, CDM, Canvas, and official
   contextualization features before adding custom processing.

## 3. Actors and user outcomes

### Reviewer

- Sees every candidate on the original drawing.
- Can classify, correct, merge, reject, and add a missed box.
- Can distinguish an asset tag from a legend item, note, pipe class, drawing
  reference, or noise.
- Can approve an identity once and retain every approved occurrence.

### Data owner

- Gets an auditable first-pass asset register created from approved evidence.
- Can trace each asset back to one or more source boxes.
- Can disable, automatically select, or force Atlas vision for controlled
  comparison.
- Can later reconcile the generated register with another system through Entity
  matching.

### Canvas user

- Opens a Canvas-compatible diagram file.
- Sees approved asset annotations at the correct locations.
- Can navigate from the drawing to created assets and related drawings.

## 4. End-to-end workflow

### Stage A — ingest and prepare pages

1. Ingest the original TIFF, PDF, PNG, or JPEG as `CogniteFile`.
2. Preserve source identity, MIME type, page count, and provenance.
3. For formats a browser cannot reliably paint, use CDF Diagram convert to
   produce one Canvas-ready PNG per page.
4. Keep normalized coordinates aligned between the source page and derived PNG.

### Stage B — understand the drawing set

1. Detect page regions: process field, legend, notes, title block, reference
   table, and unknown.
2. Extract legend entries, line styles, symbol definitions, pipe classes, and
   drawing references.
3. Build a reviewable dictionary scoped to the drawing set.
4. Treat references to symbol sheets as dependencies, not assets.

### Stage C — generate OCR candidates

1. Run broad CDF OCR to recover text and boxes.
2. Run CDF Diagram pattern detection as a complementary tag-shaped-text signal.
   Pattern mode does not require an existing asset list, but it is not the asset
   inventory and cannot be the only reader.
3. Merge overlapping results while retaining every source and confidence.
4. Never drop a candidate only because it does not match a known pattern.

### Stage D — classify and reality-check

1. Classify each candidate as:
   - `assetTag`
   - `drawingReference`
   - `pipeClass`
   - `lineConvention`
   - `note`
   - `titleBlock`
   - `unknown`
   - `noise`
2. Use page region, nearby words, enclosing symbol, drawing-set dictionary, and
   tag syntax as evidence.
3. Atlas may normalize text, challenge OCR, propose classes, identify likely
   handwriting, and propose line connections.
4. Atlas output remains advisory and retains provenance.

### Stage E — human review

1. Render the source or derived page with clickable boxes.
2. Allow text correction, class selection, manual box creation, rejection, and
   grouping of repeated tag occurrences.
3. Show source-specific confidence and disagreements instead of collapsing them
   into an unexplained score.
4. Require explicit approval before durable plant context is written.

### Stage F — approval and write-back

For an approved asset identity, one atomic Data Modeling apply must create or
update:

1. one `CogniteAsset`;
2. one `Approved` `CogniteDiagramAnnotation` for each approved occurrence;
3. the review decision and approver metadata; and
4. any approved typed relation supported by the deployed solution model.

Approval of non-asset classes has different effects:

- a drawing reference links files;
- a pipe class or line convention enriches the drawing dictionary;
- a note or title-block item remains document metadata;
- noise creates no durable domain object.

### Stage G — connection review

1. Trace candidate lines only after relevant legend conventions are available.
2. Keep proposed endpoints, line type, geometry, and evidence.
3. Require human confirmation for raster-derived connections.
4. Write a typed equipment relation only after both endpoint identities are
   approved.

### Stage H — later reconciliation

Use CDF Entity matching only when another register exists. It reconciles the
P&ID-derived register with the later source; it does not bootstrap the initial
register.

## 5. Functional requirements

### Ingestion and display

- FR-001: The system MUST preserve the original drawing file.
- FR-002: Every reviewed page MUST be viewable with clickable overlay boxes.
- FR-003: TIFF pages MUST have Canvas-ready PNG derivatives created through CDF
  Diagram convert.
- FR-004: Derived pages MUST retain source file, source page, and conversion
  provenance.
- FR-005: Boxes MUST use normalized coordinates and MUST NOT be burned into the
  derived image.

### Extraction and classification

- FR-010: CDF OCR MUST be the broad text-and-box baseline.
- FR-011: CDF Diagram pattern detection MAY supplement OCR but MUST NOT require
  an existing asset list.
- FR-012: Candidate fusion MUST preserve per-source confidence and provenance.
- FR-013: Every candidate MUST have a page region and candidate class before
  asset approval is enabled.
- FR-014: Legend, note, title-block, pipe-class, and drawing-reference text MUST
  NOT be eligible for asset promotion.
- FR-015: A reviewer MUST be able to add text or a box that OCR missed.

### Identity and approval

- FR-020: A candidate MUST remain untrusted until a recorded human decision.
- FR-021: Repeated occurrences of one normalized tag MUST be groupable into one
  proposed asset identity.
- FR-022: Approval MUST be idempotent.
- FR-023: Asset approval MUST atomically write the asset, all approved
  annotations, and the recorded decision.
- FR-024: Rejection MUST NOT create or delete plant context.
- FR-025: Every durable object MUST be traceable to its approved evidence.
- FR-026: Approval controls MUST remain disabled for `unknown` candidates and
  unresolved identity conflicts.

### Atlas

- FR-030: Atlas vision MUST support `off`, `auto`, and `always`.
- FR-031: The default Atlas vision mode MUST be `off`.
- FR-032: `auto` MUST select vision only from explicit signals such as raster
  content, suspected handwriting, uncertain classification, uncertain
  connections, no OCR candidates, or reviewer request.
- FR-033: Missing preview access or vision failure MUST fall back to CDF-only
  review.
- FR-034: Atlas MUST NOT create assets, annotations, or graph relationships.
- FR-035: Every Atlas proposal MUST retain agent, runtime/model, source file,
  page, crop, timestamp, and request mode.
- FR-036: Customer drawings MUST NOT leave approved Cognite processing
  boundaries.
- FR-037: Reusable production vision logic MUST run as a versioned Agent Builder
  tool or Cognite Function, not as an ephemeral sandbox script.

### Connections and references

- FR-040: Connection proposals MUST state endpoint candidates, line class,
  geometry, confidence, and provenance.
- FR-041: Raster connection proposals MUST require human confirmation.
- FR-042: A connection MUST NOT be approved before both endpoints are approved
  asset identities.
- FR-043: Drawing references MUST resolve to files without becoming assets.
- FR-044: Unresolved drawing references MUST remain visible as review work.

## 6. Data contracts

The implementation plan in `../docs/IMPLEMENTATION_PLAN.md` owns deployment
order and migration. These are the required logical contracts.

### Existing CDF contracts

- `cdf_cdm.CogniteFile:v1`
- `cdf_cdm.CogniteAsset:v1`
- `cdf_cdm.CogniteDiagramAnnotation:v1`

### Current prototype contract

`cardinal_diagram_review.DiagramReviewCandidate:v1` stores untrusted text,
page, bounding box, confidence, source, and pending decision. It is intentionally
insufficient for approval because it has no region, semantic class, identity
group, or full provenance.

### Required review contract

A versioned successor must add:

- source file and review file instance IDs;
- source page and review page;
- normalized bounding box;
- raw text and normalized text;
- region type and candidate class;
- source observations with confidence and provenance;
- reviewer decision, reviewer, and decision time;
- proposed identity key and grouping state; and
- optional enclosing-symbol and nearby-text evidence.

Changing the deployed container must be additive. A breaking logical change
requires a new container/view and an explicit migration; a view-version bump
alone does not make an unversioned container safe to change.

### Required drawing-set contracts

- A drawing-page mapping relates each original page to its Canvas-ready file.
- A drawing convention stores reviewed line/symbol meaning with drawing-set
  scope.
- A drawing reference relates a source file/page to a referenced drawing
  number and, when resolved, a target file.
- A connection proposal stores unapproved topology separately from approved
  equipment relations.

Resource names in this section are logical names. Final spaces and external IDs
must follow the project naming decision documented in the ADR before deployment.
The existing `cardinal_diagram_review` and `cardinal_review` identifiers are
retained during the prototype to avoid an undeclared migration.

## 7. Acceptance scenarios

1. OCR reads a numeric drawing reference in a legend. The candidate is
   classified as `drawingReference`; asset approval is unavailable.
2. OCR reads a pipe class inside its legend symbol. The candidate becomes
   `pipeClass`; no asset is created.
3. OCR reads an equipment tag in the process field. A reviewer corrects one
   character and approves it; one asset and one approved annotation are written.
4. The same approved tag appears on two sheets. One asset and two annotations
   exist.
5. OCR and pattern detection overlap. One candidate remains, with both
   observations and confidences retained.
6. OCR misses handwriting. The reviewer adds a box and transcription, then
   approves it with manual provenance.
7. Atlas disagrees with OCR. The reviewer sees both values; neither is silently
   preferred.
8. A TIFF is reviewed through a derived PNG. Approval writes the annotation on
   the PNG while preserving the TIFF as source evidence.
9. A line reaches two unapproved tags. The connection cannot be approved.
10. Atlas preview is unavailable. CDF-only review remains operational.
11. Approval is retried after a client timeout. No duplicate asset or annotation
    is created.
12. A rejected candidate produces no asset, annotation, or equipment relation.

## 8. Success measures and release gates

- No asset or approved relation is created without a recorded approval.
- No reviewed legend/reference benchmark item is promoted to an asset.
- Repeated approved tags produce one identity and the expected occurrence count.
- Every created asset has at least one approved source annotation.
- Every annotation resolves to a Canvas-viewable file and correct page.
- OCR recall and review effort are measured on a manually labeled benchmark;
  release targets are set from the baseline before pilot acceptance.
- Atlas `auto`/`always` is promoted only when it improves benchmark recall or
  classification without reducing the CDF-only candidate set.

## 9. Out of scope for the bootstrap release

- Automatic promotion with no human review.
- Replacing a future system of record.
- Entity matching before another register exists.
- Automatic approval of raster-derived topology.
- Steady-state P&ID Annotation deployment packs before the initial hierarchy
  exists.
- Sending customer drawings to unapproved external AI services.
