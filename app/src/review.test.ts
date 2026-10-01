import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_SPACE,
  candidateExternalId,
  candidatesFromOcr,
  finishPlan,
  stagingBody,
  type OcrWord,
  type ProjectDrawing,
} from './review';

const drawing: ProjectDrawing = {
  id: 7,
  space: 'cardinal_samples',
  externalId: 'cdp_1_coc_5007_5',
  name: 'CDP_1_COC_5007_5.pdf',
};

function word(text: string, confidence: number): OcrWord {
  return { text, confidence, boundingBox: { xMin: 0.1, xMax: 0.2, yMin: 0.3, yMax: 0.34 } };
}

describe('ocr candidates', () => {
  it('keeps every tag-shaped box at confidence 0.50 or higher', () => {
    const candidates = candidatesFromOcr([
      word('PT101', 0.4),
      word('the', 0.99),
      word('PT101', 0.8),
      word('pt101', 0.9),
      word('L101A', 0.7),
    ]);
    expect(candidates.map((item) => item.text)).toEqual(['PT101', 'pt101', 'L101A']);
  });
});

describe('staging', () => {
  it('stages one provisional asset per distinct tag in the candidate space', () => {
    const candidates = candidatesFromOcr([word('PT-101', 0.8), word('PT 101', 0.95), word('L101A', 0.7)]);
    const body = stagingBody(drawing, candidates, new Map());
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ instanceType: 'node', space: CANDIDATE_SPACE, externalId: 'ocr-pt-101' });
    expect(body[0]?.sources[0]?.source.externalId).toBe('CogniteAsset');
    expect(body[0]?.sources[0]?.properties).toMatchObject({
      name: 'PT 101',
      tags: ['ocr-candidate', 'drawing:cdp_1_coc_5007_5'],
    });
  });

  it('keeps tags from other drawings when restaging', () => {
    const candidates = candidatesFromOcr([word('PT101', 0.9)]);
    const existing = new Map([[candidateExternalId('PT101'), ['verified', 'drawing:other']]]);
    const body = stagingBody(drawing, candidates, existing);
    expect(body[0]?.sources[0]?.properties.tags).toEqual(['verified', 'drawing:other', 'drawing:cdp_1_coc_5007_5']);
  });
});

describe('finish review', () => {
  const tag = 'drawing:cdp_1_coc_5007_5';

  it('keeps verified candidates and deletes the rest', () => {
    const plan = finishPlan(
      drawing,
      [
        { externalId: 'ocr-pt-101', name: 'PT-101', tags: ['ocr-candidate', tag] },
        { externalId: 'ocr-note-12', name: 'NOTE-12', tags: ['ocr-candidate', tag] },
      ],
      new Set(['ocr-pt-101']),
    );
    expect(plan.keep).toEqual([{ externalId: 'ocr-pt-101', name: 'PT-101', tags: [tag, 'verified'] }]);
    expect(plan.remove).toEqual(['ocr-note-12']);
    expect(plan.verified).toBe(1);
  });

  it('does not delete a candidate another drawing still uses', () => {
    const plan = finishPlan(
      drawing,
      [{ externalId: 'ocr-pt-101', name: 'PT-101', tags: ['ocr-candidate', tag, 'drawing:other'] }],
      new Set(),
    );
    expect(plan.remove).toEqual([]);
    expect(plan.keep[0]?.tags).toEqual(['ocr-candidate', 'drawing:other']);
  });

  it('does not delete a candidate already verified elsewhere', () => {
    const plan = finishPlan(
      drawing,
      [{ externalId: 'ocr-pt-101', name: 'PT-101', tags: ['verified', tag] }],
      new Set(),
    );
    expect(plan.remove).toEqual([]);
  });
});
