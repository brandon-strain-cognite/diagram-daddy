import type { CogniteClient } from '@cognite/sdk';

export const SAMPLE_SPACE = 'cardinal_samples';
export const GLOBAL_LIBRARY_ID = 'global-3f656f67-8861-4869-a6fe-53416eb01faf';
export const LIBRARY_NAME = 'Cardinal NORSOK Z-004';
export const FULL_PARSE_PATH = '/api/v1/projects/{project}/diagram-parsing/parsing/full';
export const PARTIAL_MATCH = false;

const BETA_HEADER = { 'cdf-version': '20230101-beta' };
const OPEN_STATUSES = new Set(['InQueue', 'InProgress', 'Running', 'Queued', 'Pending']);
const CDM_VIEW = {
  type: 'view' as const,
  space: 'cdf_cdm',
  externalId: 'CogniteDiagramAnnotation',
  version: 'v1',
};
const FILE_VIEW = {
  type: 'view' as const,
  space: 'cdf_cdm',
  externalId: 'CogniteFile',
  version: 'v1',
};

export type Suggestion = {
  id: string;
  text: string;
  end: string;
  label: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DrawingResult =
  | { kind: 'raster' }
  | {
      kind: 'parsed';
      space: string;
      externalId: string;
      name: string;
      suggestions: Suggestion[];
    };

export type DrawingPipeline = (
  file: File,
  client: CogniteClient,
  hooks?: { onStatus?: (message: string) => void },
) => Promise<DrawingResult>;

type RunOptions = {
  externalId?: string;
  sleep?: (ms: number) => Promise<void>;
  upload?: (url: string, bytes: Uint8Array) => Promise<void>;
  attempts?: number;
  onStatus?: (message: string) => void;
};

type LibraryItem = { name?: string; externalId?: string; scope?: string };
type DiagramItem = { fileId?: { externalId?: string }; status?: string };

export function isRasterPdf(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes);
  return text.includes('/Subtype /Image') || text.includes('/Subtype/Image');
}

export function stringMatchLabel(confidence: number): string {
  return `String match ${confidence.toFixed(2)}`;
}

export function projectLibraryId(items: LibraryItem[]): string | undefined {
  return items.find(
    (item) => item.name === LIBRARY_NAME && item.scope !== 'Global' && item.externalId,
  )?.externalId;
}

export function cogniteFileUpsert(externalId: string, name: string) {
  return {
    items: [
      {
        instanceType: 'node' as const,
        space: SAMPLE_SPACE,
        externalId,
        sources: [
          {
            source: FILE_VIEW,
            properties: {
              name,
              mimeType: 'application/pdf',
              directory: 'diagram-daddy',
            },
          },
        ],
      },
    ],
  };
}

export function fullParseBody(input: { libraryId: string; externalId: string; nonce: string }) {
  if (!input.nonce) {
    throw new Error('Parsing needs a token exchange session.');
  }
  if (!input.libraryId || input.libraryId === GLOBAL_LIBRARY_ID || input.libraryId.startsWith('global-')) {
    throw new Error('Full parsing needs the project copy of NORSOK Z-004.');
  }
  return {
    documents: [
      {
        fileId: { space: SAMPLE_SPACE, externalId: input.externalId },
        pageNumber: 1,
      },
    ],
    filters: {
      Asset: { equals: { property: ['node', 'space'], value: SAMPLE_SPACE } },
      File: { equals: { property: ['node', 'space'], value: SAMPLE_SPACE } },
    },
    libraryId: input.libraryId,
    nonce: input.nonce,
    partialMatch: PARTIAL_MATCH,
    minTokens: 2,
    searchField: 'name',
  };
}

type AnnotationEdge = {
  externalId?: string;
  endNode?: { space?: string; externalId?: string };
  properties?: {
    cdf_cdm?: {
      'CogniteDiagramAnnotation/v1'?: {
        status?: string;
        startNodeText?: string;
        confidence?: number;
        startNodeXMin?: number;
        startNodeXMax?: number;
        startNodeYMin?: number;
        startNodeYMax?: number;
        startNodePageNumber?: number;
      };
    };
  };
};

export function suggestionsFromEdges(edges: AnnotationEdge[]): Suggestion[] {
  return edges.flatMap((edge) => {
    const props = edge.properties?.cdf_cdm?.['CogniteDiagramAnnotation/v1'];
    if (!props || props.status !== 'Suggested' || !edge.externalId) return [];
    const xMin = Number(props.startNodeXMin ?? 0);
    const xMax = Number(props.startNodeXMax ?? 0);
    const yMin = Number(props.startNodeYMin ?? 0);
    const yMax = Number(props.startNodeYMax ?? 0);
    const text = props.startNodeText ?? edge.endNode?.externalId ?? '';
    return [
      {
        id: edge.externalId,
        text,
        end: edge.endNode?.externalId ?? '',
        label: stringMatchLabel(Number(props.confidence ?? 1)),
        page: Number(props.startNodePageNumber ?? 1),
        x: Math.min(xMin, xMax),
        y: 1 - Math.max(yMin, yMax),
        width: Math.abs(xMax - xMin),
        height: Math.abs(yMax - yMin),
      },
    ];
  });
}

function itemsOf<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && 'items' in payload && Array.isArray(payload.items)) {
    return payload.items as T[];
  }
  return [];
}

async function putPdf(url: string, bytes: Uint8Array): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: new Blob([Uint8Array.from(bytes).buffer]),
  });
  if (!response.ok) {
    throw new Error(`PDF upload failed (${response.status}).`);
  }
}

function annotationQuery(externalId: string): Parameters<CogniteClient['instances']['query']>[0] {
  return {
    with: {
      files: {
        nodes: {
          filter: {
            and: [
              { equals: { property: ['node', 'externalId'], value: externalId } },
              { equals: { property: ['node', 'space'], value: SAMPLE_SPACE } },
            ],
          },
        },
      },
      annotations: {
        edges: { from: 'files', direction: 'outwards' },
        limit: 1000,
      },
    },
    select: {
      annotations: {
        sources: [
          {
            source: CDM_VIEW,
            properties: [
              'status',
              'startNodeText',
              'confidence',
              'startNodeYMax',
              'startNodeYMin',
              'startNodeXMax',
              'startNodeXMin',
              'startNodePageNumber',
            ],
          },
        ],
      },
    },
  };
}

export async function runDrawing(
  file: File,
  client: CogniteClient,
  options: RunOptions = {},
): Promise<DrawingResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isRasterPdf(bytes)) return { kind: 'raster' };

  const externalId = options.externalId ?? `drawing-${crypto.randomUUID()}`;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const upload = options.upload ?? putPdf;
  const attempts = options.attempts ?? 36;
  options.onStatus?.(`Uploading ${file.name}`);

  await client.instances.upsert(cogniteFileUpsert(externalId, file.name));
  const created = await client.post<{ items?: { uploadUrl?: string }[] }>(
    '/api/v1/projects/{project}/files',
    {
      data: {
        items: [
          {
            name: file.name,
            mimeType: 'application/pdf',
            externalId,
            instanceId: { space: SAMPLE_SPACE, externalId },
          },
        ],
      },
    },
  );
  const uploadUrl = created.data.items?.[0]?.uploadUrl;
  if (!uploadUrl) throw new Error('PDF upload did not return an upload URL.');
  await upload(uploadUrl, bytes);

  options.onStatus?.(`Parsing ${file.name}`);
  const listed = await client.get<{ items?: LibraryItem[] }>(
    '/api/v1/projects/{project}/diagram-parsing/libraries',
    { headers: BETA_HEADER },
  );
  let libraryId = projectLibraryId(listed.data.items ?? []);
  if (!libraryId) {
    const copied = await client.post<{ externalId?: string }>(
      `/api/v1/projects/{project}/diagram-parsing/libraries/${GLOBAL_LIBRARY_ID}/copy`,
      { data: { name: LIBRARY_NAME }, headers: BETA_HEADER },
    );
    libraryId = copied.data.externalId;
  }
  if (!libraryId) throw new Error('Full parsing needs the project copy of NORSOK Z-004.');

  const [session] = await client.sessions.create([{ tokenExchange: true }]);
  await client.post(FULL_PARSE_PATH, {
    data: fullParseBody({ libraryId, externalId, nonce: session.nonce }),
    headers: BETA_HEADER,
  });

  let diagrams: DiagramItem[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const listedDiagrams = await client.get('/api/v1/projects/{project}/diagram-parsing/diagrams', {
      headers: BETA_HEADER,
    });
    diagrams = itemsOf<DiagramItem>(listedDiagrams.data).filter(
      (item) => item.fileId?.externalId === externalId,
    );
    if (diagrams.length > 0 && diagrams.every((item) => !OPEN_STATUSES.has(item.status ?? ''))) break;
    await sleep(5000);
  }

  if (!diagrams.some((item) => item.status === 'Success')) {
    const status = diagrams[0]?.status ?? 'unfinished';
    throw new Error(`Parsing finished with status ${status}.`);
  }

  const queried = await client.instances.query(annotationQuery(externalId));
  const suggestions = suggestionsFromEdges(itemsOf<AnnotationEdge>(queried.items.annotations));
  return { kind: 'parsed', space: SAMPLE_SPACE, externalId, name: file.name, suggestions };
}
