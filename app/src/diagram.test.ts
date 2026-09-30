import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CogniteClient } from '@cognite/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  FULL_PARSE_PATH,
  GLOBAL_LIBRARY_ID,
  LIBRARY_NAME,
  PARTIAL_MATCH,
  SAMPLE_SPACE,
  cogniteFileUpsert,
  fullParseBody,
  isRasterPdf,
  projectLibraryId,
  runDrawing,
  suggestionsFromEdges,
} from './diagram';

const PROJECT_LIBRARY_ID = 'eb6b2b38-3bca-41ae-8dda-e3186afcaced';

const PUMP_TANK_EDGES = [
  edge('01f63b39-6b19-418b-b038-8fcaa83bfdd5', 'P001', [0.4792238923970443, 0.850260988297188, 0.5203656027326446, 0.8737490391007595]),
  edge('2a198c14-ff76-4076-b66a-79798428d290', 'P001', [0.30299820594167787, 0.03760453419009413, 0.3441399162772782, 0.061092584993665766]),
  edge('5cfe3baa-a81f-4a1a-87e8-f909a5cfcac4', 'T001', [0.30993244407504633, 0.5489158189549359, 0.35008463495474307, 0.5724038697585074]),
  edge('acb2e4c7-91cf-45a2-889c-81579377b906', 'T001', [0.17600269615544448, 0.03736621325960332, 0.2161548870351412, 0.06085426406317484]),
];

function edge(id: string, tag: string, box: [number, number, number, number]) {
  const [xMin, yMin, xMax, yMax] = box;
  return {
    externalId: id,
    endNode: { space: SAMPLE_SPACE, externalId: tag },
    properties: {
      cdf_cdm: {
        'CogniteDiagramAnnotation/v1': {
          status: 'Suggested',
          startNodeText: tag,
          confidence: 1,
          startNodeXMin: xMin,
          startNodeYMin: yMin,
          startNodeXMax: xMax,
          startNodeYMax: yMax,
          startNodePageNumber: 1,
        },
      },
    },
  };
}

describe('diagram parsing request', () => {
  it('keeps partial match off and uses the project library id', () => {
    const body = fullParseBody({
      libraryId: PROJECT_LIBRARY_ID,
      externalId: 'pump-tank',
      nonce: 'session-nonce',
    });
    expect(PARTIAL_MATCH).toBe(false);
    expect(body.partialMatch).toBe(false);
    expect(body.libraryId).toBe(PROJECT_LIBRARY_ID);
    expect(typeof body.libraryId).toBe('string');
    expect(body.libraryId).not.toBe(GLOBAL_LIBRARY_ID);
    expect(body.documents[0]?.pageNumber).toBe(1);
    expect(body.filters.Asset.equals.value).toBe(SAMPLE_SPACE);
    expect(JSON.stringify(body)).not.toContain('STORAGE TANK');
    expect(JSON.stringify(body)).not.toContain('FEED PUMP');
  });

  it('refuses the global library id and an empty session', () => {
    expect(() =>
      fullParseBody({ libraryId: GLOBAL_LIBRARY_ID, externalId: 'pump-tank', nonce: 'n' }),
    ).toThrow(/project copy/);
    expect(() =>
      fullParseBody({ libraryId: PROJECT_LIBRARY_ID, externalId: 'pump-tank', nonce: '' }),
    ).toThrow(/token exchange/);
  });

  it('picks the project copy of NORSOK Z-004', () => {
    expect(
      projectLibraryId([
        { name: 'NORSOK Z-004', externalId: GLOBAL_LIBRARY_ID, scope: 'Global' },
        { name: LIBRARY_NAME, externalId: PROJECT_LIBRARY_ID, scope: 'Project' },
      ]),
    ).toBe(PROJECT_LIBRARY_ID);
  });

  it('uploads a CogniteFile and does not create an asset', () => {
    const upsert = cogniteFileUpsert('pump-tank', 'pump-tank.pdf');
    const encoded = JSON.stringify(upsert);
    expect(upsert.items[0]?.sources[0]?.source.externalId).toBe('CogniteFile');
    expect(upsert.items[0]?.sources[0]?.properties.mimeType).toBe('application/pdf');
    expect(encoded).not.toContain('CogniteAsset');
    expect(encoded).not.toContain('Approved');
  });
});

describe('suggested boxes', () => {
  it('flips bottom-origin boxes onto the tag and keeps the pump-tank links', () => {
    const suggestions = suggestionsFromEdges(PUMP_TANK_EDGES);

    const texts = suggestions.map((item) => item.text);
    expect(texts.filter((text) => text === 'T001')).toHaveLength(2);
    expect(texts.filter((text) => text === 'P001')).toHaveLength(2);
    expect(texts).not.toContain('STORAGE TANK');
    expect(texts).not.toContain('FEED PUMP');
    expect(suggestions.every((item) => item.label === 'String match 1.00')).toBe(true);

    const upperPump = suggestions.find((item) => item.id.startsWith('01f63b39'));
    expect(upperPump?.y).toBeCloseTo(1 - 0.8737490391007595);
    expect(upperPump?.y).not.toBeCloseTo(0.850260988297188);

    const titlePump = suggestions.find((item) => item.id.startsWith('2a198c14'));
    expect(titlePump?.y).toBeGreaterThan(0.9);
  });

  it('does not treat an approved edge as a new suggestion', () => {
    const approved = edge('approved', 'T001', [0.1, 0.2, 0.3, 0.4]);
    approved.properties.cdf_cdm['CogniteDiagramAnnotation/v1'].status = 'Approved';
    expect(suggestionsFromEdges([approved])).toEqual([]);
  });
});

describe('runDrawing', () => {
  it('does not send a scanned PDF to full parsing', async () => {
    const samples = join(dirname(fileURLToPath(import.meta.url)), '../../sample-pids/public-domain-samples');
    const vector = new Uint8Array(readFileSync(join(samples, '01_pump_tank_PID_vector.pdf')));
    const scan = new Uint8Array(readFileSync(join(samples, '02_OMRE_scanned_PID.pdf')));
    expect(isRasterPdf(vector)).toBe(false);
    expect(isRasterPdf(scan)).toBe(true);

    const post = vi.fn(() => Promise.reject(new Error('should not parse')));
    const client = { post } as unknown as CogniteClient;
    const file = new File([scan], 'scan.pdf', { type: 'application/pdf' });
    await expect(runDrawing(file, client)).resolves.toEqual({ kind: 'raster' });
    expect(post).not.toHaveBeenCalled();
  });

  it('uploads, exchanges a token, and parses once with the project library', async () => {
    const posts: { path: string; data: unknown }[] = [];
    const gets: string[] = [];
    let diagramReads = 0;
    const sessionCreates: unknown[] = [];
    const upload = vi.fn(() => Promise.resolve());
    const client = {
      instances: {
        upsert: vi.fn(() => Promise.resolve({})),
        query: vi.fn(() => Promise.resolve({ items: { annotations: PUMP_TANK_EDGES } })),
      },
      sessions: {
        create: vi.fn((items: unknown[]) => {
          sessionCreates.push(items);
          return Promise.resolve([{ nonce: 'nonce-from-token-exchange' }]);
        }),
      },
      post: vi.fn((path: string, options: { data?: unknown }) => {
        posts.push({ path, data: options.data });
        if (path.endsWith('/files')) return Promise.resolve({ data: { items: [{ uploadUrl: 'https://upload.example/pdf' }] } });
        if (path.endsWith('/copy')) return Promise.resolve({ data: { externalId: 'should-not-copy' } });
        return Promise.resolve({ data: [{ externalId: 'job-1' }] });
      }),
      get: vi.fn((path: string) => {
        gets.push(path);
        if (path.endsWith('/libraries')) {
          return Promise.resolve({
            data: {
              items: [
                { name: 'NORSOK Z-004', externalId: GLOBAL_LIBRARY_ID, scope: 'Global' },
                { name: LIBRARY_NAME, externalId: PROJECT_LIBRARY_ID, scope: 'Project' },
              ],
            },
          });
        }
        diagramReads += 1;
        const status = diagramReads === 1 ? 'InProgress' : 'Success';
        return Promise.resolve({
          data: { items: [{ fileId: { externalId: 'drop-1' }, status, pageNumber: 1 }] },
        });
      }),
    } as unknown as CogniteClient;

    const file = new File([new TextEncoder().encode('%PDF-1.4\nvector')], 'pump-tank.pdf', {
      type: 'application/pdf',
    });
    const result = await runDrawing(file, client, {
      externalId: 'drop-1',
      sleep: () => Promise.resolve(),
      upload,
      attempts: 3,
    });

    expect(result.kind).toBe('parsed');
    if (result.kind !== 'parsed') return;
    expect(result.suggestions.map((item) => item.text).sort()).toEqual(['P001', 'P001', 'T001', 'T001']);
    expect(client.instances.upsert).toHaveBeenCalledOnce();
    const upserted = JSON.stringify(vi.mocked(client.instances.upsert).mock.calls[0]?.[0]);
    expect(upserted).toContain('application/pdf');
    expect(upserted).toContain('CogniteFile');
    expect(upserted).not.toContain('CogniteAsset');

    expect(upload).toHaveBeenCalledWith('https://upload.example/pdf', expect.any(Uint8Array));
    expect(sessionCreates).toEqual([[{ tokenExchange: true }]]);
    expect(posts.some((call) => call.path.includes('/sessions'))).toBe(false);

    const parse = posts.find((call) => call.path === FULL_PARSE_PATH);
    expect(parse?.data).toMatchObject({
      libraryId: PROJECT_LIBRARY_ID,
      partialMatch: false,
      nonce: 'nonce-from-token-exchange',
    });
    expect(posts.filter((call) => call.path === FULL_PARSE_PATH)).toHaveLength(1);
    expect(posts.some((call) => call.path.endsWith('/copy'))).toBe(false);
  });
});
