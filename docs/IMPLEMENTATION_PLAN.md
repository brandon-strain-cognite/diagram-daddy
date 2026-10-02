# Cardinal implementation plan

## Purpose

This is the build plan for Diagram Daddy. Product behavior is normative in
[`../app/SPEC.md`](../app/SPEC.md). The architectural decision is recorded in
[`adr/0001-document-to-asset-register.md`](adr/0001-document-to-asset-register.md).

The plan converts engineering drawings into the first reviewed asset register.
It does not assume that an asset list already exists.

## Non-negotiable invariants

1. Detection creates proposals, never plant context.
2. A human decision is required before an asset, approved annotation, or
   equipment relation is written.
3. Legend/reference/note content cannot be promoted as an asset.
4. One approved tag identity may have many drawing occurrences.
5. Original files remain evidence; derived page files remain traceable to them.
6. The CDF-only path works when Atlas is disabled or unavailable.
7. Customer drawings stay inside approved Cognite processing boundaries.
8. Classic Assets write restrictions in the current project are not bypassed;
   bootstrap assets use CDM/Data Modeling.

## System boundaries

### CDF responsibilities

- Store original and derived `CogniteFile` instances.
- Perform broad OCR and Diagram detection.
- Convert TIFF pages to Canvas-ready PNGs.
- Store review state and provenance in Data Modeling.
- Store approved `CogniteAsset` and `CogniteDiagramAnnotation` instances.
- Display approved diagram context in Canvas.
- Run durable glue through supported CDF Functions, Agent Builder tools,
  Workflows, or Transformations where appropriate.

### Atlas responsibilities

- Challenge uncertain OCR and classification.
- Normalize candidate text.
- Use crops and surrounding context to propose candidate classes.
- Detect likely handwriting.
- Propose topology and explain uncertainty.
- Never approve or write plant context.

### Reviewer responsibilities

- Correct or add text and boxes.
- Classify ambiguous candidates.
- Group repeated tag occurrences into an identity.
- Confirm asset creation and topology.
- Resolve conflicts that automation cannot safely decide.

### Flows app responsibilities

- Present original/derived pages and overlays.
- Expose provenance and disagreements.
- Persist review decisions through narrow services.
- Execute idempotent approval commands.
- Restore selected drawing/page/candidate from host-synced app state.

## Logical pipeline

```text
Original files
  -> page preparation
  -> region segmentation
  -> legend/drawing-set dictionary
  -> OCR + pattern observations
  -> candidate fusion
  -> semantic classification
  -> identity grouping
  -> human review
  -> atomic approval
  -> CDM assets + approved annotations
  -> reviewed connection proposals
  -> typed equipment relations
  -> later entity matching to another register
```

## Data model plan

### Existing prototype

- Schema space: `cardinal_diagram_review`
- Instance space: `cardinal_review`
- View: `DiagramReviewCandidate:v1`
- File/asset space used by the prototype: `cardinal_samples`

These identifiers predate the current naming standard. Do not silently rename
them. The migration decision must be explicit because spaces are permanent
access-control boundaries.

### Target layering

The bootstrap review model is a solution model. It references CDM files and
writes approved CDM assets/annotations. It must not duplicate CDM properties.

Before deployment, choose one of these paths:

1. **Recommended for this prototype:** retain the existing spaces, add a new
   additive review container/view, document the naming exception, and migrate
   v1 records.
2. Create standard-named solution and instance spaces, migrate all prototype
   records, update scoped capabilities, then retire consumers of the old view.

No model migration starts until that choice is recorded in a follow-up ADR.

### Candidate observation

Multiple readers can observe the same mark. Preserve those observations instead
of overwriting them.

Required fields:

- observation source (`cdfOcr`, `cdfPattern`, `atlasVision`, `manual`);
- source-specific raw text and confidence;
- reader/tool version and timestamp;
- source file, source page, and crop/box;
- optional request/run identifier; and
- error/fallback state.

Implementation choice for Phase 2:

- either a child observation node/edge per source; or
- a bounded JSON list on the candidate container.

Use child observations if individual observations must be queried or updated.
Use bounded JSON only if access is always through the parent candidate. Do not
create an EAV model.

### Review candidate v2

Required fields:

- `sourceFile`: relation to the original `CogniteFile`;
- `reviewFile`: relation to the Canvas-viewable file;
- `sourcePage` and `reviewPage`;
- `xMin`, `yMin`, `xMax`, `yMax`;
- `rawText` and `normalizedText`;
- `regionType`;
- `candidateClass`;
- `classificationConfidence`;
- `decision`;
- `reviewedBy` and `reviewedTime`;
- `identityKey` and `identityState`;
- optional `enclosingSymbol`;
- optional nearby text evidence; and
- provenance observations.

Candidate classes:

- `assetTag`
- `drawingReference`
- `pipeClass`
- `lineConvention`
- `note`
- `titleBlock`
- `unknown`
- `noise`

Region types:

- `processField`
- `legend`
- `notes`
- `titleBlock`
- `referenceTable`
- `unknown`

Decision states:

- `pending`
- `accepted`
- `rejected`
- `needsInput`
- `superseded`

`accepted` means the candidate's interpretation was accepted. It does not imply
an asset was created unless the class is `assetTag` and the identity approval
completed.

### Drawing page

A source page maps to one Canvas-viewable file/page:

- original file and page;
- derived file and page;
- conversion method and time;
- dimensions and optional rotation;
- checksum/version evidence; and
- active/superseded state.

The current `{sourceExternalId}__canvas_p{page}` convention remains valid for
prototype-derived files. File external IDs may preserve source-defined naming.

### Drawing convention

Stores reviewed drawing-set meaning:

- convention type (`lineStyle`, `symbol`, `pipeClass`, `designationRule`);
- label and normalized code;
- description;
- visual evidence region;
- drawing-set scope;
- source file/page; and
- review decision/provenance.

### Drawing reference

Stores:

- source file/page and evidence box;
- raw and normalized drawing number;
- adjacent title text;
- resolved target file when available;
- resolution state; and
- review provenance.

This is a file relationship, never an asset.

### Proposed asset identity

Groups accepted `assetTag` occurrences:

- normalized tag;
- proposed display name/type;
- member candidate IDs;
- identity conflicts;
- approval state; and
- resulting `CogniteAsset` instance ID after approval.

Identity normalization must be conservative. Punctuation/case normalization may
group obvious variants; uncertain substitutions such as `0/O` or `1/I` require
review.

### Connection proposal

Stores unapproved topology:

- start/end proposed identity;
- source drawing/page;
- line geometry;
- proposed line/convention class;
- confidence;
- extraction source and provenance;
- review decision; and
- resulting relation ID after approval.

The approved relation shape must be chosen against the deployed domain model
before Phase 6. Do not invent an untyped edge in application code.

## Approval transaction

### Asset identity approval

Construct deterministic external IDs from the approved normalized identity and
project scope. Submit one Data Modeling apply containing:

1. the `CogniteAsset` node;
2. one `CogniteDiagramAnnotation` edge for every approved occurrence;
3. updates that mark the identity and candidates approved; and
4. explicit references from the review records to the created objects.

Use deterministic annotation IDs based on asset identity plus occurrence
identity. A retry after timeout must apply the same IDs.

Validate before write:

- class is `assetTag`;
- at least one occurrence is accepted;
- every occurrence has a valid review file/page and box;
- normalized tag is non-empty;
- no unresolved identity conflict exists; and
- reviewer identity is present.

### Other approvals

- Drawing reference: upsert the reviewed reference and optional file relation.
- Convention/pipe class: upsert the reviewed drawing-set dictionary item.
- Note/title block: retain reviewed metadata only.
- Noise/rejection: update review state only.
- Connection: write a typed relation only after endpoint assets exist.

### Atomicity

Data Modeling instances in the approval payload must succeed or fail as one
apply. If a supporting API cannot participate in that apply, do not call it
inside the approval boundary; prepare the resource before approval or use an
explicit resumable state machine.

## Application architecture

The current `App.tsx` mixes loading, selection state, file rendering, and
pipeline behavior. Build new behavior through testable boundaries:

```text
ReviewStateProvider
  -> useReviewViewModel
     -> DrawingLibraryService
     -> CandidateService
     -> ApprovalService
     -> AtlasRealityCheckService
  -> ReviewWorkspace
     -> DrawingNavigator
     -> DiagramViewport
     -> CandidateInspector
     -> IdentityInspector
```

Rules:

- SDK clients and stateful services are injected.
- Business rules live in commands/services, not render components.
- Drawing/page/candidate selection is synchronized through the Flows host.
- Every service has request, response, and failure tests.
- Approval logic is pure-plan-first: build and validate the apply payload before
  making a network call.

## Delivery phases

### Phase 0 — preserve the current prototype

**Goal:** establish a reproducible baseline before changing semantics.

Work:

- Keep PDF and TIFF/PNG overlay review operational.
- Record benchmark documents outside production/customer paths.
- Record candidate counts by source and page without logging detected text.
- Mark `diagram.ts` full parsing as legacy bootstrap behavior.
- Add a fixture-driven benchmark with manually labeled synthetic/public pages.

Exit gate:

- Existing tests and build pass.
- The versioned deployment opens both PDF and TIFF-derived PNG.
- Baseline recall/false-positive measurements are recorded.

### Phase 1 — page and region model

**Goal:** know where text appears before deciding what it means.

Work:

- Add drawing-page mappings.
- Detect or manually assign process field, legend, notes, title block,
  reference table, and unknown regions.
- Show region boundaries and filters in the review app.
- Ensure boxes map correctly after TIFF conversion and page rotation.

Tests:

- Coordinate mapping at page edges and rotation.
- TIFF source-to-PNG page mapping.
- Region containment and overlap.
- Host state restores selected drawing/page.

Exit gate:

- Every staged candidate resolves to a viewable page and one region.

### Phase 2 — OCR observations and candidate fusion

**Goal:** maximize candidate recall without creating context.

Work:

- Call broad CDF OCR for page text/boxes.
- Retain pattern-mode detections as a second source.
- Add manual observations.
- Merge overlapping observations into candidates while retaining provenance.
- Stop using full parsing with an Asset filter for bootstrap extraction.

Tests:

- Overlapping OCR/pattern observations merge.
- Different nearby marks do not merge.
- Source confidence and raw text survive fusion.
- Empty/failed readers do not erase other results.

Exit gate:

- Benchmark reports recall and review candidate count by source.
- CDF-only extraction works with no asset instances in scope.

### Phase 3 — legend and semantic classification

**Goal:** prevent non-assets from entering asset review and build drawing
conventions.

Work:

- Add candidate and region classes.
- Extract drawing references, pipe classes, line conventions, and symbol-sheet
  dependencies.
- Add Atlas reality-check adapter behind `off`/`auto`/`always`.
- Display reader disagreements and unresolved classes.

Tests:

- Legend number cannot enable asset approval.
- Pipe class and drawing reference route to their own inspectors.
- Process-field tag remains asset-eligible.
- Atlas unavailable/failure falls back to CDF-only.
- Atlas provenance is complete.

Exit gate:

- No labeled legend/reference benchmark item is asset-eligible.
- Every asset-eligible benchmark item has process-field evidence or an explicit
  reviewer override.

### Phase 4 — OCR workbench and identity grouping

**Goal:** let a reviewer turn text observations into reliable identities.

Work:

- Edit text/class.
- Add/move/resize boxes.
- Reject or mark needs-input.
- Group repeated tag occurrences.
- Surface conservative normalization conflicts.
- Add keyboard-safe navigation and visible save state.

Tests:

- Manual transcription retains manual provenance.
- Group/ungroup preserves occurrences.
- Conflicting normalized identities block approval.
- Decisions survive reload.

Exit gate:

- A reviewer can complete a drawing without leaving the overlay workflow.

### Phase 5 — atomic asset and annotation approval

**Goal:** create the first trustworthy asset register.

Work:

- Implement deterministic identity and annotation IDs.
- Build and validate atomic Data Modeling apply payloads.
- Write CDM assets and approved annotations.
- Record approver and resulting instance IDs.
- Add retry and conflict handling.
- Verify the same service principal has scoped read/write access to all spaces.

Tests:

- One occurrence creates one asset and one annotation.
- Two occurrences create one asset and two annotations.
- Retry is idempotent.
- Invalid/unknown/rejected candidates cannot call apply.
- Partial validation failures make no writes.

Exit gate:

- Every created asset is traceable to reviewed evidence.
- Every annotation opens on the correct Canvas-viewable page.
- Token inspection or a real write smoke confirms the pipeline principal's
  scoped read/write access.

### Phase 6 — references, conventions, and connections

**Goal:** turn the reviewed register into a navigable drawing graph.

Work:

- Resolve drawing references to `CogniteFile`.
- Apply reviewed legend conventions to line interpretation.
- Generate connection proposals with geometry and evidence.
- Review endpoint identity and line class.
- Write typed relations only after domain-model review.

Tests:

- References never create assets.
- Unresolved references remain work items.
- Connection approval requires two approved endpoint assets.
- Raster proposals cannot auto-approve.

Exit gate:

- Canvas navigation follows approved file references and equipment context.
- Approved topology is traceable to source geometry and reviewer.

### Phase 7 — Atlas benchmark and production hardening

**Goal:** decide whether optional vision earns its operational cost.

Work:

- Compare `off`, `auto`, and `always` on the same labeled benchmark.
- Measure recall, classification accuracy, review corrections, latency, and
  failures.
- Version the durable Atlas/Cognite Function tool.
- Confirm approved multimodal and customer-data boundaries.
- Add workflow orchestration, monitoring, and resumability.

Exit gate:

- Atlas is enabled only where it improves the agreed metrics.
- CDF-only fallback passes the same functional workflow.
- No customer drawing reaches an unapproved endpoint.

### Phase 8 — later register reconciliation

**Goal:** align the P&ID-derived register with a later source of truth.

Work:

- Configure CDF Entity matching.
- Review candidate matches and preserve both source identities.
- Merge or relate records according to data ownership rules.

This phase is intentionally after bootstrap asset creation.

## Test strategy

### Golden benchmark

Use public/synthetic pages with labels for:

- process-field asset tags;
- repeated tag occurrences;
- handwriting;
- legend line styles;
- pipe classes;
- drawing references;
- notes/title blocks; and
- true equipment connections where known.

Store labels, not customer drawing pixels, in Git. Keep customer/test datasets
outside Cursor-indexed repositories.

### Metrics

- Candidate recall by class.
- Asset-eligible precision after classification.
- Legend/reference leakage into asset eligibility.
- Identity grouping precision and recall.
- Annotation coordinate correctness.
- Reviewer edits per accepted identity.
- Atlas incremental gain versus CDF-only.
- Median/p95 processing and review latency.

The first benchmark establishes the baseline. Numerical pilot thresholds must be
agreed and committed before Phase 5 is called pilot-ready.

### Automated test layers

- Pure unit tests for coordinate, fusion, classification, normalization, and
  approval payload rules.
- Service tests for CDF request/response/error handling.
- Component tests for review behavior and disabled approval states.
- Integration tests for review-to-apply workflows with external APIs mocked.
- CDF smoke tests in the dev project for schema, access, idempotency, and Canvas
  resolution.

## Access and deployment gates

Before a phase that writes a new resource type is complete:

1. identify the service principal used by the app/function/workflow;
2. grant only required read/write capabilities scoped to the relevant spaces or
   dataset;
3. include files plus Data Modeling instance access for source/review/approved
   objects;
4. verify with token inspection or a real write as that principal; and
5. document grants and any legacy API restrictions.

The current cluster restricts some classic write APIs. Do not retry a blocked
classic Assets destination; keep the bootstrap path in CDM/Data Modeling.

## Current implementation inventory

### Reusable

- Overlay rendering for staged candidates.
- TIFF-to-PNG staging through CDF Diagram convert.
- Normalized bounding boxes.
- CDF pattern detection benchmark.
- Atlas mode decision logic and fallback semantics.

### Prototype-only or incomplete

- `DiagramReviewCandidate:v1` lacks classification and full provenance.
- `diagram.ts` full parsing assumes assets are available through its filter.
- Candidate deduplication only handles exact text and box matches.
- Approval/rejection/editing is not implemented.
- Identity grouping is not implemented.
- Atlas mode selection is not connected to a durable vision tool.
- Drawing references, conventions, and connections are not modeled.

## Pull request sequence

Keep each PR buildable:

1. **Docs:** product spec, ADR, implementation plan.
2. **Page model:** page mapping, regions, viewer state.
3. **Observations:** OCR service and candidate fusion.
4. **Classification:** legend/reference routing and Atlas adapter contract.
5. **Workbench:** editing, manual boxes, decisions, identity grouping.
6. **Approval:** deterministic atomic asset/annotation write-back and access.
7. **Graph:** references, conventions, and reviewed connections.
8. **Hardening:** benchmark, workflows, monitoring, and Atlas decision.

Do not mix customer sample files into any PR.

## Open decisions

These decisions block the named phase, not earlier documentation or tests:

- **Before Phase 2 schema deployment:** retain existing spaces or migrate to
  standard-named solution/instance spaces.
- **Before Phase 2:** child observation nodes versus bounded JSON provenance.
- **Before Phase 5:** deterministic asset external-ID normalization rules.
- **Before Phase 6:** approved equipment-relation type in the domain model.
- **Before Phase 7:** approved Atlas multimodal endpoint and data boundary.
- **Before pilot acceptance:** numerical quality and review-effort thresholds.
