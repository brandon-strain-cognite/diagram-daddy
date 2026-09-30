import type { ComponentProps } from 'react';
import { lazy, Suspense, useState } from 'react';
import { CogniteSdkProvider, useCogniteSdk } from '@cognite/app-sdk/react';
import { Alert, AlertDescription } from '@cognite/aura/components/alert';
import { Badge } from '@cognite/aura/components/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cognite/aura/components/card';
import { Loader } from '@cognite/aura/components/loader';

import appConfig from '../app.json';
import { DocumentAnnotationOverlay } from './cognite-file-viewer/DocumentAnnotationOverlay';
import type { DocumentAnnotation } from './cognite-file-viewer/types';
import {
  runDrawing,
  SAMPLE_SPACE,
  type DrawingPipeline,
  type DrawingResult,
  type Suggestion,
} from './diagram';

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

function overlayAnnotations(suggestions: Suggestion[]): DocumentAnnotation[] {
  return suggestions.map((suggestion) => ({
    id: suggestion.id,
    x: suggestion.x,
    y: suggestion.y,
    width: suggestion.width,
    height: suggestion.height,
    page: suggestion.page,
    resourceType: 'asset',
    text: `${suggestion.text} · ${suggestion.label}`,
    annotationType: 'diagrams.AssetLink',
    linkedResource: suggestion.end
      ? { space: SAMPLE_SPACE, externalId: suggestion.end }
      : undefined,
  }));
}

function DrawingReview({ pipeline }: { pipeline: DrawingPipeline }) {
  const client = useCogniteSdk();
  const [rejected, setRejected] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DrawingResult | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="flex flex-col gap-4">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <span className="text-lg">Drop a PDF</span>
        <span className="text-muted-foreground">Engineering drawing, one sheet to start.</span>
        <input
          className="sr-only"
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(event) => {
            void take(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
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
      {parsed ? (
        <div className="flex flex-col gap-4">
          <p>Suggested links only.</p>
          <ul aria-label="Suggested tags">
            {parsed.suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                {suggestion.text} · {suggestion.label} · Suggested
              </li>
            ))}
          </ul>
          <div className="h-[640px] w-full">
            <Suspense fallback={<p>Loading drawing...</p>}>
              <CogniteFileViewer
                source={{ type: 'instanceId', space: parsed.space, externalId: parsed.externalId }}
                client={client}
                showAnnotations={false}
                fitMode="width"
                style={{ width: '100%', height: '640px' }}
                renderOverlay={({ width, height }) => (
                  <DocumentAnnotationOverlay
                    annotations={overlayAnnotations(parsed.suggestions)}
                    containerWidth={width}
                    containerHeight={height}
                  />
                )}
              />
            </Suspense>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AppContent({ pipeline }: { pipeline: DrawingPipeline }) {
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
              <DrawingReview pipeline={pipeline} />
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
};

function App({ deps, pipeline = runDrawing }: AppProps) {
  return (
    <CogniteSdkProvider loadingFallback={loadingFallback} errorFallback={errorFallback} deps={deps}>
      <AppContent pipeline={pipeline} />
    </CogniteSdkProvider>
  );
}

export default App;
