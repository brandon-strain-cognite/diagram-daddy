import { describe, expect, it } from 'vitest';

import {
  REVIEW_INSTANCE_SPACE,
  REVIEW_VIEW,
  canvasPreviewExternalId,
  dedupeCandidates,
  reviewCandidateUpsert,
  reviewCandidatesFromDetections,
  stagedDrawingsFromNodes,
} from './review-candidate';

const FILE = { space: 'cardinal_samples', externalId: 'cdp_1_coc_5007_5' };

describe('review candidates', () => {
  it('stores CDF text, page, box, and confidence without creating plant context', () => {
    const [candidate] = reviewCandidatesFromDetections(
      FILE,
      [
        {
          text: ' PT-101 ',
          confidence: 1,
          region: {
            page: 1,
            vertices: [
              { x: 0.2, y: 0.3 },
              { x: 0.28, y: 0.34 },
            ],
          },
        },
      ],
      'cdf-pattern',
    );

    expect(candidate).toMatchObject({
      fileSpace: FILE.space,
      fileExternalId: FILE.externalId,
      page: 1,
      text: 'PT-101',
      xMin: 0.2,
      yMin: 0.3,
      xMax: 0.28,
      yMax: 0.34,
      confidence: 1,
      source: 'cdf-pattern',
      decision: 'pending',
    });
    expect(candidate?.externalId).toMatch(/^c[0-9a-f]{16}$/);

    const upsert = reviewCandidateUpsert(candidate ? [candidate] : []);
    const encoded = JSON.stringify(upsert);
    expect(upsert.items[0]?.space).toBe(REVIEW_INSTANCE_SPACE);
    expect(upsert.items[0]?.sources[0]?.source).toEqual(REVIEW_VIEW);
    expect(encoded).not.toContain('CogniteAsset');
    expect(encoded).not.toContain('CogniteDiagramAnnotation');
    expect(encoded).not.toContain('Approved');
  });

  it('accepts OCR bounds and drops detections that cannot be reviewed on the drawing', () => {
    const candidates = reviewCandidatesFromDetections(
      FILE,
      [
        { text: 'FV-101', boundingBox: { xMin: 0.1, yMin: 0.4, xMax: 0.16, yMax: 0.44 } },
        { text: '   ' },
        { text: 'OFF', boundingBox: { xMin: 0.5, yMin: 0.5, xMax: 0.5, yMax: 0.6 } },
        { text: 'BAD', confidence: 4, boundingBox: { xMin: 0.1, yMin: 0.1, xMax: 0.2, yMax: 0.2 } },
      ],
      'cdf-ocr',
      2,
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ text: 'FV-101', page: 2, confidence: null, source: 'cdf-ocr' });
    expect(candidates[1]).toMatchObject({ text: 'BAD', confidence: null });
  });

  it('groups stored nodes by drawing and ignores plant views', () => {
    const drawings = stagedDrawingsFromNodes(
      [
        {
          externalId: 'c001',
          properties: {
            cardinal_diagram_review: {
              'DiagramReviewCandidate/v1': {
                fileSpace: FILE.space,
                fileExternalId: FILE.externalId,
                page: 1,
                text: 'PT-101',
                xMin: 0.2,
                yMin: 0.3,
                xMax: 0.28,
                yMax: 0.34,
                confidence: 1,
                source: 'cdf-pattern',
                decision: 'pending',
              },
            },
          },
        },
      ],
      [
        {
          space: FILE.space,
          externalId: FILE.externalId,
          properties: {
            cdf_cdm: {
              'CogniteFile/v1': { name: 'Sheet 5007', mimeType: 'application/pdf' },
            },
          },
        },
      ],
    );
    expect(drawings).toEqual([
      {
        space: FILE.space,
        externalId: FILE.externalId,
        name: 'Sheet 5007',
        mimeType: 'application/pdf',
        canvasSheets: [],
        candidates: [expect.objectContaining({ text: 'PT-101', decision: 'pending' })],
      },
    ]);
    expect(JSON.stringify(drawings)).not.toContain('CogniteAsset');
  });

  it('keeps one pending record when pattern and OCR find the same mark', () => {
    const pattern = reviewCandidatesFromDetections(
      FILE,
      [{ text: 'P-101A', confidence: 1, boundingBox: { xMin: 0.4, yMin: 0.5, xMax: 0.48, yMax: 0.54 } }],
      'cdf-pattern',
    );
    const ocr = reviewCandidatesFromDetections(
      FILE,
      [{ text: 'P-101A', confidence: 0.4, boundingBox: { xMin: 0.4, yMin: 0.5, xMax: 0.48, yMax: 0.54 } }],
      'cdf-ocr',
    );

    const [kept] = dedupeCandidates([...ocr, ...pattern]);
    expect(kept).toMatchObject({ source: 'cdf-pattern', confidence: 1, decision: 'pending' });
  });

  it('attaches the Canvas PNG for a TIFF page and leaves the source file as the extraction input', () => {
    const source = 'cdp_1-2_aep_5006_16';
    const preview = canvasPreviewExternalId(source, 1);
    const drawings = stagedDrawingsFromNodes(
      [
        {
          externalId: 'c010',
          properties: {
            cardinal_diagram_review: {
              'DiagramReviewCandidate/v1': {
                fileSpace: FILE.space,
                fileExternalId: source,
                page: 1,
                text: 'FV-101',
                xMin: 0.1,
                yMin: 0.2,
                xMax: 0.2,
                yMax: 0.3,
                source: 'cdf-pattern',
                decision: 'pending',
              },
            },
          },
        },
      ],
      [
        {
          space: FILE.space,
          externalId: source,
          properties: { cdf_cdm: { 'CogniteFile/v1': { name: 'Sheet 5006', mimeType: 'image/tiff' } } },
        },
        {
          space: FILE.space,
          externalId: preview,
          properties: { cdf_cdm: { 'CogniteFile/v1': { name: 'Sheet 5006 page 1', mimeType: 'image/png' } } },
        },
      ],
    );

    expect(drawings[0]).toMatchObject({
      externalId: source,
      mimeType: 'image/tiff',
      canvasSheets: [{ page: 1, space: FILE.space, externalId: preview }],
    });
  });
});
