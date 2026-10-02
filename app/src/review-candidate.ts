export const REVIEW_SCHEMA_SPACE = 'cardinal_diagram_review';
export const REVIEW_INSTANCE_SPACE = 'cardinal_review';
export const REVIEW_VIEW = {
  type: 'view' as const,
  space: REVIEW_SCHEMA_SPACE,
  externalId: 'DiagramReviewCandidate',
  version: 'v1',
};

export type ReviewCandidateSource = 'cdf-pattern' | 'cdf-ocr' | 'manual';
export type ReviewDecision = 'pending';

export type ReviewCandidate = {
  externalId: string;
  fileSpace: string;
  fileExternalId: string;
  page: number;
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  confidence: number | null;
  source: ReviewCandidateSource;
  decision: ReviewDecision;
};

export type CanvasSheet = {
  page: number;
  space: string;
  externalId: string;
};

export type StagedDrawing = {
  space: string;
  externalId: string;
  name: string;
  mimeType: string;
  candidates: ReviewCandidate[];
  canvasSheets: CanvasSheet[];
};

export function canvasPreviewExternalId(fileExternalId: string, page: number): string {
  return `${fileExternalId}__canvas_p${page}`;
}

export function isTiffMime(mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  return mime === 'image/tiff' || mime === 'image/tif';
}

type InstanceNode = {
  space?: string;
  externalId?: string;
  properties?: Record<string, Record<string, Record<string, unknown>>>;
};

type Box = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

type DetectionInput = {
  text?: unknown;
  confidence?: unknown;
  page?: unknown;
  region?: { page?: unknown; vertices?: unknown };
  boundingBox?: { xMin?: unknown; xMax?: unknown; yMin?: unknown; yMax?: unknown };
};

const BOX_DIGITS = 4;

export function reviewCandidatesFromDetections(
  file: { space: string; externalId: string },
  detections: DetectionInput[],
  source: Exclude<ReviewCandidateSource, 'manual'>,
  page = 1,
): ReviewCandidate[] {
  const candidates = detections.flatMap((detection) => {
    const text = typeof detection.text === 'string' ? detection.text.trim() : '';
    const box = boxOf(detection);
    if (!text || !box) return [];
    const detectedPage = positivePage(detection.page) ?? positivePage(detection.region?.page) ?? page;
    return [candidate(file, text, detectedPage, box, confidenceOf(detection.confidence), source)];
  });
  return dedupeCandidates(candidates);
}

export function dedupeCandidates(candidates: ReviewCandidate[]): ReviewCandidate[] {
  const byKey = new Map<string, ReviewCandidate>();
  for (const candidate of candidates) {
    const key = [
      candidate.fileSpace,
      candidate.fileExternalId,
      candidate.page,
      candidate.text,
      candidate.xMin,
      candidate.yMin,
      candidate.xMax,
      candidate.yMax,
    ].join('\u001f');
    const current = byKey.get(key);
    if (!current || prefer(candidate, current)) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

export function stagedDrawingsFromNodes(candidates: InstanceNode[], files: InstanceNode[]): StagedDrawing[] {
  const filesById = new Map(files.flatMap((file) => {
    if (!file.space || !file.externalId) return [];
    const props = viewProps(file, 'cdf_cdm', 'CogniteFile/v1');
    const key = `${file.space}/${file.externalId}` as `${string}/${string}`;
    return [[key, {
      name: textOf(props.name) || file.externalId,
      mimeType: textOf(props.mimeType),
    }] as const];
  }));
  const grouped = new Map<string, StagedDrawing>();
  for (const node of candidates) {
    const props = viewProps(node, REVIEW_SCHEMA_SPACE, 'DiagramReviewCandidate/v1');
    const candidate = candidateFromProps(node.externalId, props);
    if (!candidate) continue;
    const key = `${candidate.fileSpace}/${candidate.fileExternalId}` as `${string}/${string}`;
    const file = filesById.get(key);
    const drawing = grouped.get(key) ?? {
      space: candidate.fileSpace,
      externalId: candidate.fileExternalId,
      name: file?.name ?? candidate.fileExternalId,
      mimeType: file?.mimeType ?? '',
      candidates: [],
      canvasSheets: [],
    };
    drawing.candidates.push(candidate);
    grouped.set(key, drawing);
  }
  for (const drawing of grouped.values()) {
    drawing.canvasSheets = canvasSheetsFor(drawing, filesById);
  }
  return [...grouped.values()].sort((left, right) => {
    const leftPdf = left.mimeType === 'application/pdf' ? 0 : 1;
    const rightPdf = right.mimeType === 'application/pdf' ? 0 : 1;
    return leftPdf - rightPdf || left.name.localeCompare(right.name);
  });
}

export function reviewCandidateUpsert(candidates: ReviewCandidate[]) {
  return {
    items: candidates.map((item) => ({
      instanceType: 'node' as const,
      space: REVIEW_INSTANCE_SPACE,
      externalId: item.externalId,
      sources: [
        {
          source: REVIEW_VIEW,
          properties: {
            fileSpace: item.fileSpace,
            fileExternalId: item.fileExternalId,
            page: item.page,
            text: item.text,
            xMin: item.xMin,
            yMin: item.yMin,
            xMax: item.xMax,
            yMax: item.yMax,
            ...(item.confidence === null ? {} : { confidence: item.confidence }),
            source: item.source,
            decision: item.decision,
          },
        },
      ],
    })),
    replace: false,
  };
}

function canvasSheetsFor(
  drawing: StagedDrawing,
  filesById: Map<string, { name: string; mimeType: string }>,
): CanvasSheet[] {
  if (!isTiffMime(drawing.mimeType)) return [];
  const pages = [...new Set(drawing.candidates.map((candidate) => candidate.page))].sort((left, right) => left - right);
  return pages.flatMap((page) => {
    const externalId = canvasPreviewExternalId(drawing.externalId, page);
    const preview = filesById.get(`${drawing.space}/${externalId}`);
    if (preview?.mimeType !== 'image/png') return [];
    return [{ page, space: drawing.space, externalId }];
  });
}

function viewProps(node: InstanceNode, space: string, view: string): Record<string, unknown> {
  return node.properties?.[space]?.[view] ?? {};
}

function candidateFromProps(externalId: string | undefined, props: Record<string, unknown>): ReviewCandidate | null {
  const fileSpace = textOf(props.fileSpace);
  const fileExternalId = textOf(props.fileExternalId);
  const text = textOf(props.text);
  const page = positivePage(props.page);
  const box = validBox(numberOf(props.xMin), numberOf(props.yMin), numberOf(props.xMax), numberOf(props.yMax));
  if (!externalId || !fileSpace || !fileExternalId || !text || !page || !box) return null;
  const source = props.source === 'cdf-pattern' || props.source === 'cdf-ocr' || props.source === 'manual'
    ? props.source
    : 'cdf-pattern';
  return {
    externalId,
    fileSpace,
    fileExternalId,
    page,
    text,
    ...box,
    confidence: confidenceOf(props.confidence),
    source,
    decision: 'pending',
  };
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function candidate(
  file: { space: string; externalId: string },
  text: string,
  page: number,
  box: Box,
  confidence: number | null,
  source: ReviewCandidateSource,
): ReviewCandidate {
  const normalized = {
    xMin: round(box.xMin),
    yMin: round(box.yMin),
    xMax: round(box.xMax),
    yMax: round(box.yMax),
  };
  return {
    externalId: externalIdFor(file, text, page, normalized),
    fileSpace: file.space,
    fileExternalId: file.externalId,
    page,
    text,
    ...normalized,
    confidence,
    source,
    decision: 'pending',
  };
}

function boxOf(detection: DetectionInput): Box | null {
  const bounds = detection.boundingBox;
  const fromBounds = bounds
    ? validBox(numberOf(bounds.xMin), numberOf(bounds.yMin), numberOf(bounds.xMax), numberOf(bounds.yMax))
    : null;
  if (fromBounds) return fromBounds;
  const vertices = detection.region?.vertices;
  if (!Array.isArray(vertices)) return null;
  const xs = vertices.flatMap((vertex) => {
    if (!vertex || typeof vertex !== 'object' || !('x' in vertex)) return [];
    const value = numberOf(vertex.x);
    return value === null ? [] : [value];
  });
  const ys = vertices.flatMap((vertex) => {
    if (!vertex || typeof vertex !== 'object' || !('y' in vertex)) return [];
    const value = numberOf(vertex.y);
    return value === null ? [] : [value];
  });
  if (xs.length < 2 || ys.length < 2) return null;
  return validBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

function validBox(xMin: number | null, yMin: number | null, xMax: number | null, yMax: number | null): Box | null {
  if (xMin === null || yMin === null || xMax === null || yMax === null) return null;
  if (xMin < 0 || yMin < 0 || xMax > 1 || yMax > 1) return null;
  if (xMin >= xMax || yMin >= yMax) return null;
  return { xMin, yMin, xMax, yMax };
}

function confidenceOf(value: unknown): number | null {
  const confidence = numberOf(value);
  if (confidence === null || confidence < 0 || confidence > 1) return null;
  return confidence;
}

function positivePage(value: unknown): number | null {
  const page = numberOf(value);
  if (page === null || !Number.isInteger(page) || page < 1) return null;
  return page;
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number): number {
  const factor = 10 ** BOX_DIGITS;
  return Math.round(value * factor) / factor;
}

function externalIdFor(
  file: { space: string; externalId: string },
  text: string,
  page: number,
  box: Box,
): string {
  return `c${hash([file.space, file.externalId, String(page), text, box.xMin, box.yMin, box.xMax, box.yMax].join('\u001f'))}`;
}

function hash(value: string): string {
  let high = 2166136261;
  let low = 2166136261 ^ 0x9e3779b9;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    high = Math.imul(high ^ code, 16777619);
    low = Math.imul(low ^ code, 2246822519);
  }
  return `${toHex(high)}${toHex(low)}`;
}

function toHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

function prefer(next: ReviewCandidate, current: ReviewCandidate): boolean {
  if (next.source === 'cdf-pattern' && current.source !== 'cdf-pattern') return true;
  return (next.confidence ?? -1) > (current.confidence ?? -1);
}
