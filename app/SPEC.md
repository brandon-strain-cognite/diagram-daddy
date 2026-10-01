# Feature Specification: Diagram Daddy

Locked 1 October 2026.

CDF performs diagram OCR. Atlas supplements the OCR result. A human approves every asset, drawing placement, and equipment connection before anything becomes trusted plant context.

## User Scenarios & Testing

### User Stories

1. As a reviewer, I want CDF-detected tags shown as boxes on the drawing, so that I can verify them in place.
2. As a reviewer, I want Atlas to group split OCR tokens, flag likely misreads, and classify each candidate, so that I review a reading rather than raw words.
3. As a reviewer, I want to draw a box and transcribe handwriting that CDF missed, so that the sheet can still be captured.
4. As a reviewer, I want proposed connections between equipment, so that I can accept the relationships shown by the line diagram.
5. As a reviewer, I want approval to create the asset, its drawing annotation, and its accepted connections together, so that the knowledge graph matches the reviewed sheet.
6. As an investigator, I want an approved drawing to open in Diagram parsing, Search, and Canvas, so that I can research related context after review.

### Acceptance Scenarios

- Given a PDF or TIFF `CogniteFile` in the configured location, when Tag detection runs, then each detection becomes one untrusted review candidate with text, page, confidence, and box.
- Given those candidates, when Atlas runs, then it returns normalization, classification, and connection proposals without creating or changing CDF data.
- Given a candidate CDF did not detect, when the reviewer draws a box and enters text, then that manual candidate enters the same review flow.
- Given an approved candidate, when write-back completes, then one `CogniteAsset`, one Approved `CogniteDiagramAnnotation`, and the accepted equipment relations exist.
- Given a rejected candidate, when review is saved, then the audit record remains and no asset or connection is created.
- Given a write-back failure after the asset insert, when the operation is retried or rolled back, then the asset is not presented as trusted.

## Requirements

### Functional Requirements

- FR-001: The system MUST store original drawings as `CogniteFile` nodes with MIME type `application/pdf` or `image/tiff`.
- FR-002: CDF Diagram parsing MUST be the OCR engine. The app MUST NOT run a separate OCR library.
- FR-003: Detection MUST create review candidates only. It MUST NOT create `CogniteAsset` nodes.
- FR-004: Atlas MUST receive candidate text, boxes, confidence, and relevant CDF context. It MUST NOT be given responsibility for reading drawing pixels or inventing boxes.
- FR-005: Atlas MUST remain read-only. It MUST NOT approve candidates or write CDF data.
- FR-006: The overlay MUST show CDF boxes and Atlas suggestions together and allow text edits, box edits, classification, notes, approval, and rejection.
- FR-007: The overlay MUST allow a manually drawn box and transcription for content CDF missed.
- FR-008: The overlay MUST allow the reviewer to accept, edit, reject, or create a connection between two candidates.
- FR-009: Approval MUST create the asset, Approved `CogniteDiagramAnnotation`, and accepted CDM equipment relations. The asset becomes trusted only after all required writes succeed.
- FR-010: A diagram annotation MUST link the file to the asset and store the reviewed page, text, and bounding box. It is distinct from an equipment-to-equipment relation.
- FR-011: Raster connection approval MUST store the equipment relation. It MUST NOT claim to have reconstructed the drawn pipe geometry.
- FR-012: Rejected candidates MUST remain auditable and MUST NOT appear as plant assets.
- FR-013: The current Finish Review cleanup MUST remain disabled until this approval model replaces it.
- FR-014: After an approved asset hierarchy exists, later drawings SHOULD use CDF Tag detection and the P&ID Annotation deployment pack for matching.
- FR-015: Vector drawings SHOULD use CDF Full diagram parsing for native symbol and connection tracing. Raster TIFF files remain limited to tag detection plus reviewed connections.

## Success Criteria

- SC-001: One PDF and one TIFF each have 25–50 human-labeled tags and connections before the workflow is scaled.
- SC-002: CDF OCR precision, recall, and box overlap are reported separately from Atlas normalization and connection quality.
- SC-003: Every trusted asset has one reviewed annotation and one recorded human decision.
- SC-004: Accepted connections resolve only between approved assets.
- SC-005: Approved drawings render in Diagram parsing and Canvas while the original file bytes remain unchanged.

## Clarifications

- Raster TIFFs cannot use CDF symbol, merge, or connection tracing. Those capabilities require vector files.
- Atlas can propose that two tags are connected. A human must confirm it because Atlas cannot verify the raster line.
- Canvas comments support later investigation. Reviewer decisions and notes belong on the review record.

## Assumptions

- The customer initially has no equipment-tag list, so the first hierarchy is created from reviewed drawings.
- Approved assets may initially sit under a diagram-derived root until the customer supplies a plant hierarchy.
- Equipment connections use CDM direct relations because classic Relationships API writes are restricted on this cluster.
- Atlas runtime 2.0 remains private preview and is not the only extraction path.

## Data Models & CDF Integration

### Existing views

- `cdf_cdm.CogniteFile:v1` — original drawing.
- `cdf_cdm.CogniteAsset:v1` — approved equipment or tag node.
- `cdf_cdm.CogniteDiagramAnnotation:v1` — reviewed file-to-asset link, page, text, and bounding box.
- `cdf_cdm.CogniteEquipment:v1` — used when the approved item needs equipment semantics beyond the base asset.

### New views

Review candidate, in the Cardinal schema space:

- source file reference and page
- text, normalized text, and classification
- bounding box and CDF confidence
- Atlas rationale, proposal confidence, and proposed connections
- reviewer decision, reviewer note, and timestamps
- references to the asset, annotation, and relations created on approval

Equipment connection:

- CDM direct relation between two approved assets
- source candidate references and reviewer decision
- no claim to store the raster pipe path

### Spaces

- Drawing files remain in the configured drawing instance space.
- Review candidates live in a dedicated review instance space.
- Approved assets and their relations live in the governed plant instance space.
- The existing duplicated `cardinal_ocr_candidates` staging remains frozen until a separate migration decision.
