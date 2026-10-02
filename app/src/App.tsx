import type { ComponentProps } from 'react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { CogniteSdkProvider, useCogniteSdk } from '@cognite/app-sdk/react';
import { Alert, AlertDescription } from '@cognite/aura/components/alert';
import { Badge } from '@cognite/aura/components/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cognite/aura/components/card';
import { Loader } from '@cognite/aura/components/loader';

import type { CogniteClient } from '@cognite/sdk';

import appConfig from '../app.json';
import { runDrawing, type DrawingPipeline, type DrawingResult } from './diagram';
import {
  REVIEW_INSTANCE_SPACE,
  REVIEW_VIEW,
  isTiffMime,
  stagedDrawingsFromNodes,
  type StagedDrawing,
} from './review-candidate';

const CogniteFileViewer = lazy(() =>
  import('./cognite-file-viewer/CogniteFileViewer').then((module) => ({
    default: module.CogniteFileViewer,
  })),
);

const loadingFallback = (
  <main className="min-h-screen bg-muted/50 text-foreground">
    <section className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center p-4 sm:p-8">
      <Card aria-label="Loading project" aria-live="polite">
        <CardContent>
          <div className="inline-flex items-center gap-3 text-muted-foreground">
            <Loader size={20} />
            <span>Loading project...</span>
          </div>
        </CardContent>
      </Card>
    </section>
  </main>
);

const errorFallback = (
  <main className="min-h-screen bg-muted/50 text-foreground">
    <section className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center p-4 sm:p-8">
      <Alert>
        <AlertDescription>Failed to connect to Fusion host</AlertDescription>
      </Alert>
    </section>
  </main>
);

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function visibleError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The drawing could not be parsed.';
  return message.replace(/"nonce"\s*:\s*"[^"]*"/g, '"nonce":"…"');
}

const FILE_VIEW = {
  type: 'view' as const,
  space: 'cdf_cdm',
  externalId: 'CogniteFile',
  version: 'v1',
};

export async function listStagedDrawings(client: CogniteClient): Promise<StagedDrawing[]> {
  const [candidates, files] = await Promise.all([
    client.instances.list({
      instanceType: 'node',
      sources: [{ source: REVIEW_VIEW }],
      filter: { equals: { property: ['node', 'space'], value: REVIEW_INSTANCE_SPACE } },
      limit: 1000,
    }),
    client.instances.list({
      instanceType: 'node',
      sources: [{ source: FILE_VIEW }],
      filter: { equals: { property: ['node', 'space'], value: 'cardinal_samples' } },
      limit: 1000,
    }),
  ]);
  return stagedDrawingsFromNodes(candidates.items, files.items);
}

function CandidateBoxes({
  drawing,
  info,
  page,
  selectedId,
  onSelect,
}: {
  drawing: StagedDrawing;
  info: { width: number; height: number; pageNumber: number };
  page?: number;
  selectedId: string | null;
  onSelect: (externalId: string) => void;
}) {
  const shownPage = page ?? info.pageNumber;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {drawing.candidates
        .filter((candidate) => candidate.page === shownPage)
        .map((candidate) => (
          <button
            key={candidate.externalId}
            type="button"
            aria-label={`Review ${candidate.text}`}
            title={candidate.text}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(candidate.externalId);
            }}
            style={{
              position: 'absolute',
              left: candidate.xMin * info.width,
              top: candidate.yMin * info.height,
              width: (candidate.xMax - candidate.xMin) * info.width,
              height: (candidate.yMax - candidate.yMin) * info.height,
              minWidth: 8,
              minHeight: 8,
              border: selectedId === candidate.externalId
                ? '3px solid rgb(76, 175, 80)'
                : '2px solid rgb(212, 106, 226)',
              background: selectedId === candidate.externalId
                ? 'rgba(76, 175, 80, 0.12)'
                : 'rgba(212, 106, 226, 0.06)',
              pointerEvents: 'auto',
              cursor: 'pointer',
            }}
          />
        ))}
    </div>
  );
}

function DrawingReview({
  pipeline,
  library,
}: {
  pipeline: DrawingPipeline;
  library: (client: CogniteClient) => Promise<StagedDrawing[]>;
}) {
  const client = useCogniteSdk();
  const [rejected, setRejected] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DrawingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<StagedDrawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [sheetPage, setSheetPage] = useState<number | null>(null);
  const [stagedError, setStagedError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void library(client)
      .then((drawings) => {
        if (!active) return;
        setStaged(drawings);
        setSelectedId(drawings[0]?.externalId ?? null);
        setSelectedCandidateId(null);
      })
      .catch((caught: unknown) => {
        if (active) setStagedError(visibleError(caught));
      });
    return () => {
      active = false;
    };
  }, [client, library]);

  async function take(file: File | undefined) {
    if (!file || !isPdf(file)) {
      setRejected(Boolean(file));
      return;
    }
    setRejected(false);
    setError(null);
    setResult(null);
    setBusy(true);
    setStatus(`Uploading ${file.name}`);
    try {
      const next = await pipeline(file, client, { onStatus: setStatus });
      setResult(next);
      setStatus(null);
    } catch (caught) {
      setStatus(null);
      setError(visibleError(caught));
    } finally {
      setBusy(false);
    }
  }

  const parsed = result?.kind === 'parsed' ? result : null;
  const selected = staged.find((drawing) => drawing.externalId === selectedId) ?? null;
  const activeSheet = selected?.canvasSheets.find((sheet) => sheet.page === sheetPage)
    ?? selected?.canvasSheets[0]
    ?? null;
  const viewTarget = activeSheet
    ? { space: activeSheet.space, externalId: activeSheet.externalId }
    : selected && !isTiffMime(selected.mimeType)
      ? { space: selected.space, externalId: selected.externalId }
      : null;
  const selectedCandidate = selected?.candidates.find(
    (candidate) => candidate.externalId === selectedCandidateId,
  ) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {status ? (
        <p className="inline-flex items-center gap-3 text-muted-foreground" aria-live="polite">
          <Loader size={18} />
          <span>{status}</span>
        </p>
      ) : null}
      {rejected ? <p>Choose a PDF.</p> : null}
      {error ? (
        <Alert>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {result?.kind === 'raster' ? <p>This scan is not sent to full parsing.</p> : null}
      {stagedError ? (
        <Alert>
          <AlertDescription>{stagedError}</AlertDescription>
        </Alert>
      ) : null}
      {staged.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">Review on the drawing</p>
              <p className="text-sm text-muted-foreground">
                Purple boxes are pending. Select a box to inspect it.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Staged drawings">
            {staged.map((drawing) => (
              <button
                key={drawing.externalId}
                type="button"
                aria-pressed={drawing.externalId === selectedId}
                className="rounded-md border border-border px-3 py-2 text-sm aria-pressed:bg-muted"
                onClick={() => {
                  setSelectedId(drawing.externalId);
                  setSelectedCandidateId(null);
                  setSheetPage(null);
                }}
              >
                {drawing.name} · {drawing.candidates.length} pending
              </button>
            ))}
            </div>
          </div>
          {selected ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="flex h-[75vh] min-h-[640px] flex-col overflow-hidden rounded-lg border border-border bg-background">
                {selected.canvasSheets.length > 1 ? (
                  <div className="flex flex-wrap gap-2 border-b border-border p-2" aria-label="Drawing pages">
                    {selected.canvasSheets.map((sheet) => (
                      <button
                        key={sheet.externalId}
                        type="button"
                        aria-pressed={sheet.externalId === activeSheet?.externalId}
                        className="rounded-md border border-border px-3 py-1 text-sm aria-pressed:bg-muted"
                        onClick={() => {
                          setSheetPage(sheet.page);
                          setSelectedCandidateId(null);
                        }}
                      >
                        Page {sheet.page}
                      </button>
                    ))}
                  </div>
                ) : null}
                {viewTarget ? (
                  <div className="min-h-0 flex-1">
                    <Suspense fallback={<p>Loading drawing...</p>}>
                      <CogniteFileViewer
                        source={{ type: 'instanceId', space: viewTarget.space, externalId: viewTarget.externalId }}
                        client={client}
                        fitMode="width"
                        showAnnotations={false}
                        renderOverlay={(info) => (
                          <CandidateBoxes
                            drawing={selected}
                            info={info}
                            page={activeSheet?.page}
                            selectedId={selectedCandidateId}
                            onSelect={setSelectedCandidateId}
                          />
                        )}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </Suspense>
                  </div>
                ) : (
                  <p className="p-4 text-muted-foreground">
                    This TIFF is waiting for its Canvas PNG. Boxes stay on the drawing once that file is ready.
                  </p>
                )}
              </div>
              <aside className="rounded-lg border border-border p-4">
                {selectedCandidate ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-muted-foreground">Selected candidate</p>
                    <p className="text-xl font-medium">{selectedCandidate.text}</p>
                    <p>Page {selectedCandidate.page}</p>
                    <p>Source: {selectedCandidate.source}</p>
                    <p>Status: pending</p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    Select a purple box on the diagram to inspect its candidate.
                  </p>
                )}
              </aside>
            </div>
          ) : null}
        </div>
      ) : null}
      {parsed ? (
        <div className="flex flex-col gap-4">
          <p>{parsed.suggestions.length} suggested boxes. Review them on the drawing.</p>
          <div className="h-[640px] w-full">
            <Suspense fallback={<p>Loading drawing...</p>}>
              <CogniteFileViewer
                source={{ type: 'instanceId', space: parsed.space, externalId: parsed.externalId }}
                client={client}
                fitMode="width"
                style={{ width: '100%', height: '640px' }}
              />
            </Suspense>
          </div>
        </div>
      ) : null}
      <label
        className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-4 text-center"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          void take(event.dataTransfer.files?.[0]);
        }}
      >
        <span>Drop another PDF</span>
        <input
          className="sr-only"
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          aria-label="Drop a PDF"
          onChange={(event) => {
            void take(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

function AppContent({
  pipeline,
  library,
}: {
  pipeline: DrawingPipeline;
  library: (client: CogniteClient) => Promise<StagedDrawing[]>;
}) {
  const client = useCogniteSdk();
  const deployment = appConfig.deployments?.[0];
  const orgLabel = deployment?.org ?? '';
  const projectLabel = deployment?.project ?? client.project ?? '';

  return (
    <main className="min-h-screen bg-muted/50 text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center p-4 sm:p-8">
        <Card>
          <CardHeader>
            <CardTitle as="h1">Diagram Daddy</CardTitle>
            <CardDescription>Drop a drawing. Suggested tag boxes appear on the sheet.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-6">
              <p className="flex flex-wrap items-center gap-2">
                <span>Connected to</span>
                {orgLabel ? <Badge variant="nordic">{orgLabel}</Badge> : null}
                <Badge variant="nordic">{projectLabel}</Badge>
              </p>
              <DrawingReview pipeline={pipeline} library={library} />
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

type AppProps = {
  deps?: ComponentProps<typeof CogniteSdkProvider>['deps'];
  pipeline?: DrawingPipeline;
  library?: (client: CogniteClient) => Promise<StagedDrawing[]>;
};

function App({ deps, pipeline = runDrawing, library = listStagedDrawings }: AppProps) {
  return (
    <CogniteSdkProvider loadingFallback={loadingFallback} errorFallback={errorFallback} deps={deps}>
      <AppContent pipeline={pipeline} library={library} />
    </CogniteSdkProvider>
  );
}

export default App;
