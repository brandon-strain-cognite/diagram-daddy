import type { CogniteClient } from '@cognite/sdk';

import { SAMPLE_SPACE, cdfPath } from './diagram';

export const CANDIDATE_SPACE = 'cardinal_ocr_candidates';
export const CANDIDATE_TAG = 'ocr-candidate';
export const VERIFIED_TAG = 'verified';

const BETA_HEADER = { 'cdf-version': '20230101-beta' };
const BATCH = 1000;
const ASSET_VIEW = {
  type: 'view' as const,
  space: 'cdf_cdm',
  externalId: 'CogniteAsset',
  version: 'v1',
};
const ANNOTATION_VIEW = {
  type: 'view' as const,
  space: 'cdf_cdm',
  externalId: 'CogniteDiagramAnnotation',
  version: 'v1',
};

export type OcrBox = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

export type OcrWord = {
  text?: string;
  confidence?: number;
  boundingBox?: OcrBox;
};

export type TagCandidate = {
  id: string;
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ProjectDrawing = {
  id: number;
  space: string;
  externalId: string;
  name: string;
  mimeType?: string;
};

export type StagedAsset = { externalId: string; name: string; tags: string[] };

export type ReviewStatus = {
  staged: number;
  suggested: number;
  approved: number;
  rejected: number;
};

export type FinishPlan = {
  keep: StagedAsset[];
  remove: string[];
  verified: number;
  discarded: number;
};

type InstanceItem = {
  externalId: string;
  startNode?: { space: string; externalId: string };
  endNode?: { space: string; externalId: string };
  properties?: Record<string, Record<string, Record<string, unknown>>>;
};

export function candidatesFromOcr(words: OcrWord[]): TagCandidate[] {
  const candidates: TagCandidate[] = [];
  words.forEach((word, index) => {
    const text = word.text?.trim() ?? '';
    const confidence = Number(word.confidence ?? 0);
    const box = word.boundingBox;
    if (!box || !isTagShaped(text) || confidence < 0.5) return;
    candidates.push({
      id: `${text.toUpperCase()}:${index}:${box.xMin}:${box.yMin}`,
      text,
      confidence,
      x: Math.min(box.xMin, box.xMax),
      y: Math.min(box.yMin, box.yMax),
      width: Math.abs(box.xMax - box.xMin),
      height: Math.abs(box.yMax - box.yMin),
    });
  });
  return candidates.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function drawingTag(drawing: ProjectDrawing): string {
  return `drawing:${drawing.externalId}`;
}

export function candidateExternalId(text: string): string {
  const slug = text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `ocr-${slug || 'tag'}`;
}

export function stagingBody(
  drawing: ProjectDrawing,
  candidates: TagCandidate[],
  existing: Map<string, string[]>,
) {
  const best = new Map<string, TagCandidate>();
  for (const candidate of candidates) {
    const id = candidateExternalId(candidate.text);
    const previous = best.get(id);
    if (!previous || candidate.confidence > previous.confidence) best.set(id, candidate);
  }
  const tag = drawingTag(drawing);
  return [...best.entries()].map(([externalId, candidate]) => {
    const tags = new Set(existing.get(externalId) ?? [CANDIDATE_TAG]);
    tags.add(tag);
    return {
      instanceType: 'node' as const,
      space: CANDIDATE_SPACE,
      externalId,
      sources: [
        {
          source: ASSET_VIEW,
          properties: {
            name: candidate.text.trim(),
            description: 'Unreviewed OCR text staged for Diagram parsing review.',
            tags: [...tags],
          },
        },
      ],
    };
  });
}

export function finishPlan(
  drawing: ProjectDrawing,
  staged: StagedAsset[],
  approvedIds: Set<string>,
): FinishPlan {
  const tag = drawingTag(drawing);
  const keep: StagedAsset[] = [];
  const remove: string[] = [];
  let verified = 0;
  let discarded = 0;
  for (const asset of staged) {
    if (approvedIds.has(asset.externalId)) {
      verified += 1;
      const tags = new Set(asset.tags.filter((item) => item !== CANDIDATE_TAG));
      tags.add(VERIFIED_TAG);
      keep.push({ ...asset, tags: [...tags] });
      continue;
    }
    discarded += 1;
    const tags = asset.tags.filter((item) => item !== tag);
    const stillUsed = tags.includes(VERIFIED_TAG) || tags.some((item) => item.startsWith('drawing:'));
    if (stillUsed) keep.push({ ...asset, tags });
    else remove.push(asset.externalId);
  }
  return { keep, remove, verified, discarded };
}

export async function loadDrawings(client: CogniteClient): Promise<ProjectDrawing[]> {
  const listed = await client.files.list({ filter: { uploaded: true }, limit: 1000 });
  return listed.items.flatMap((file) => {
    const instanceId = file.instanceId;
    if (!instanceId || instanceId.space !== SAMPLE_SPACE || file.id === undefined) return [];
    return [
      {
        id: file.id,
        space: instanceId.space,
        externalId: instanceId.externalId,
        name: file.name ?? instanceId.externalId,
        mimeType: file.mimeType,
      },
    ];
  });
}

export async function loadCandidates(client: CogniteClient, drawing: ProjectDrawing): Promise<TagCandidate[]> {
  const response = await client.post<{ items?: { annotations?: OcrWord[] }[] }>(
    cdfPath(client.project, 'context/diagram/ocr'),
    {
      data: { fileId: drawing.id, startPage: 1, limit: 1 },
      headers: BETA_HEADER,
    },
  );
  return candidatesFromOcr(response.data.items?.[0]?.annotations ?? []);
}

export async function stageCandidates(client: CogniteClient, drawing: ProjectDrawing): Promise<number> {
  const candidates = await loadCandidates(client, drawing);
  const ids = [...new Set(candidates.map((candidate) => candidateExternalId(candidate.text)))];
  const existing = new Map<string, string[]>();
  for (const chunk of chunks(ids, BATCH)) {
    const found = await client.post<{ items?: InstanceItem[] }>(
      cdfPath(client.project, 'models/instances/byids'),
      {
        data: {
          items: chunk.map((externalId) => ({ instanceType: 'node', space: CANDIDATE_SPACE, externalId })),
          sources: [{ source: ASSET_VIEW }],
        },
      },
    );
    for (const item of found.data.items ?? []) existing.set(item.externalId, assetOf(item).tags);
  }
  const body = stagingBody(drawing, candidates, existing);
  const visible = body.map((item) => ({ ...item, space: SAMPLE_SPACE }));
  for (const chunk of chunks([...body, ...visible], BATCH)) {
    await client.instances.upsert({ items: chunk });
  }
  return body.length;
}

export async function loadReviewStatus(client: CogniteClient, drawing: ProjectDrawing): Promise<ReviewStatus> {
  const [staged, annotations] = await Promise.all([
    listStaged(client, drawing),
    listCandidateAnnotations(client, drawing),
  ]);
  const count = (status: string) => annotations.filter((item) => item.status === status).length;
  return {
    staged: staged.length,
    suggested: count('Suggested'),
    approved: count('Approved'),
    rejected: count('Rejected'),
  };
}

export async function finishReview(client: CogniteClient, drawing: ProjectDrawing): Promise<FinishPlan> {
  const [staged, annotations] = await Promise.all([
    listStaged(client, drawing),
    listCandidateAnnotations(client, drawing),
  ]);
  const approved = new Set(
    annotations.filter((item) => item.status === 'Approved').map((item) => item.endNode),
  );
  const plan = finishPlan(drawing, staged, approved);
  for (const space of [CANDIDATE_SPACE, SAMPLE_SPACE]) {
    for (const chunk of chunks(plan.keep, BATCH)) {
      await client.instances.upsert({
        items: chunk.map((asset) => ({
          instanceType: 'node' as const,
          space,
          externalId: asset.externalId,
          sources: [{ source: ASSET_VIEW, properties: { tags: asset.tags } }],
        })),
      });
    }
    for (const chunk of chunks(plan.remove, BATCH)) {
      await client.post(cdfPath(client.project, 'models/instances/delete'), {
        data: {
          items: chunk.map((externalId) => ({ instanceType: 'node', space, externalId })),
        },
      });
    }
  }
  return plan;
}

async function listStaged(client: CogniteClient, drawing: ProjectDrawing): Promise<StagedAsset[]> {
  const items = await listAll(client, {
    instanceType: 'node',
    sources: [{ source: ASSET_VIEW }],
    filter: {
      and: [
        { equals: { property: ['node', 'space'], value: CANDIDATE_SPACE } },
        { containsAny: { property: ['cdf_cdm', 'CogniteAsset/v1', 'tags'], values: [drawingTag(drawing)] } },
      ],
    },
  });
  return items.map(assetOf);
}

async function listCandidateAnnotations(
  client: CogniteClient,
  drawing: ProjectDrawing,
): Promise<{ status: string; endNode: string }[]> {
  const items = await listAll(client, {
    instanceType: 'edge',
    sources: [{ source: ANNOTATION_VIEW }],
    filter: {
      equals: {
        property: ['edge', 'startNode'],
        value: { space: drawing.space, externalId: drawing.externalId },
      },
    },
  });
  return items.flatMap((item) => {
    if (item.endNode?.space !== CANDIDATE_SPACE) return [];
    const props = item.properties?.cdf_cdm?.['CogniteDiagramAnnotation/v1'] ?? {};
    return [{ status: String(props.status ?? ''), endNode: item.endNode.externalId }];
  });
}

async function listAll(client: CogniteClient, body: Record<string, unknown>): Promise<InstanceItem[]> {
  const items: InstanceItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.post<{ items?: InstanceItem[]; nextCursor?: string }>(
      cdfPath(client.project, 'models/instances/list'),
      { data: { ...body, limit: BATCH, ...(cursor ? { cursor } : {}) } },
    );
    items.push(...(page.data.items ?? []));
    cursor = page.data.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

function assetOf(item: InstanceItem): StagedAsset {
  const props = item.properties?.cdf_cdm?.['CogniteAsset/v1'] ?? {};
  const tags = Array.isArray(props.tags) ? props.tags.map(String) : [];
  return { externalId: item.externalId, name: String(props.name ?? item.externalId), tags };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function isTagShaped(text: string): boolean {
  return text.length >= 4 && /[A-Za-z]/.test(text) && /\d/.test(text);
}
