import { CogniteSdkProvider, useCogniteSdk } from '@cognite/app-sdk/react';
import { Alert, AlertDescription } from '@cognite/aura/components/alert';
import { Badge } from '@cognite/aura/components/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cognite/aura/components/card';
import { Loader } from '@cognite/aura/components/loader';
import { useEffect, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';

import appConfig from '../app.json';

import {
  CANDIDATE_SPACE,
  finishReview,
  loadDrawings,
  loadReviewStatus,
  stageCandidates,
  type FinishPlan,
  type ProjectDrawing,
  type ReviewStatus,
} from './review';

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

function visibleError(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed.';
}

type Client = ReturnType<typeof useCogniteSdk>;

export type ReviewActions = {
  drawings: (client: Client) => Promise<ProjectDrawing[]>;
  status: (client: Client, drawing: ProjectDrawing) => Promise<ReviewStatus>;
  stage: (client: Client, drawing: ProjectDrawing) => Promise<number>;
  finish: (client: Client, drawing: ProjectDrawing) => Promise<FinishPlan>;
};

const defaultActions: ReviewActions = {
  drawings: loadDrawings,
  status: loadReviewStatus,
  stage: stageCandidates,
  finish: finishReview,
};

const stepClass = 'rounded-lg border border-border bg-background p-4';
const buttonClass = 'rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50';

function DrawingReview({ actions }: { actions: ReviewActions }) {
  const client = useCogniteSdk();
  const [library, setLibrary] = useState<ProjectDrawing[] | null>(null);
  const [drawing, setDrawing] = useState<ProjectDrawing | null>(null);
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [finished, setFinished] = useState<FinishPlan | null>(null);
  const [busy, setBusy] = useState<string | null>('Loading drawings');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    actions
      .drawings(client)
      .then((items) => {
        if (!cancelled) setLibrary(items);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(visibleError(caught));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [actions, client]);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(visibleError(caught));
    } finally {
      setBusy(null);
    }
  }

  function open(next: ProjectDrawing) {
    setDrawing(next);
    setStatus(null);
    setFinished(null);
    void run('Checking review status', async () => setStatus(await actions.status(client, next)));
  }

  function stage(current: ProjectDrawing) {
    void run('Staging OCR candidates', async () => {
      const staged = await actions.stage(client, current);
      const next = await actions.status(client, current);
      setStatus({ ...next, staged: Math.max(next.staged, staged) });
    });
  }

  function refresh(current: ProjectDrawing) {
    void run('Checking review status', async () => setStatus(await actions.status(client, current)));
  }

  function finish(current: ProjectDrawing) {
    void run('Cleaning up unverified candidates', async () => {
      setFinished(await actions.finish(client, current));
      setStatus(await actions.status(client, current));
    });
  }

  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
      <aside className={stepClass}>
        <h2 className="mb-3 font-semibold">Drawings</h2>
        {library && library.length === 0 ? <p className="text-sm text-muted-foreground">No drawings found.</p> : null}
        <ul aria-label="Drawings" className="flex max-h-[70vh] flex-col gap-1 overflow-auto">
          {(library ?? []).map((item) => (
            <li key={`${item.space}:${item.externalId}`}>
              <button
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  drawing?.externalId === item.externalId ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
                type="button"
                onClick={() => open(item)}
              >
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex flex-col gap-4">
        {!drawing ? <p className="text-muted-foreground">Select a drawing.</p> : null}
        {drawing ? (
          <>
            <h2 className="text-lg font-semibold">{drawing.name}</h2>

            <div className={stepClass}>
              <h3 className="font-semibold">1. Stage OCR candidates</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Creates one provisional asset per tag-like OCR word in <code>{CANDIDATE_SPACE}</code> and{' '}
                <code>cardinal_samples</code>, tagged <code>ocr-candidate</code>. Diagram parsing only searches the
                drawing&apos;s space, so the copy in <code>cardinal_samples</code> is the one it can match.
              </p>
              <p className="mt-2 text-sm">{status ? `${status.staged} candidates staged for this drawing.` : null}</p>
              <button className={`${buttonClass} mt-3`} disabled={Boolean(busy)} type="button" onClick={() => stage(drawing)}>
                {status && status.staged > 0 ? 'Restage candidates' : 'Stage candidates'}
              </button>
            </div>

            <div className={stepClass}>
              <h3 className="font-semibold">2. Review in Diagram parsing</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                In Fusion, open Diagram parsing and rerun Tag detection on this drawing. Then open the drawing and
                verify the real equipment tags and reject the rest. Comments and research belong in Canvas.
              </p>
              {status ? (
                <p className="mt-2 text-sm" aria-label="Review counts">
                  {status.suggested} suggested · {status.approved} verified · {status.rejected} rejected
                </p>
              ) : null}
              <button
                className="mt-3 rounded-md border border-border px-4 py-2 font-medium disabled:opacity-50"
                disabled={Boolean(busy)}
                type="button"
                onClick={() => refresh(drawing)}
              >
                Refresh counts
              </button>
            </div>

            <div className={stepClass}>
              <h3 className="font-semibold">3. Finish review</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Keeps candidates you verified, tagged <code>verified</code>. Deletes every other candidate from this
                drawing unless another drawing still uses it.
              </p>
              {status && status.suggested > 0 ? (
                <p className="mt-2 text-sm font-medium text-amber-700">
                  {status.suggested} boxes are still unreviewed and will be treated as rejected.
                </p>
              ) : null}
              <button
                className={`${buttonClass} mt-3`}
                disabled={Boolean(busy) || !status || status.staged === 0}
                type="button"
                onClick={() => finish(drawing)}
              >
                Finish review
              </button>
              {finished ? (
                <p className="mt-2 text-sm">
                  Kept {finished.verified} verified · removed {finished.remove.length} candidates.
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {busy ? (
          <p className="inline-flex items-center gap-2 text-muted-foreground" aria-live="polite">
            <Loader size={16} />
            <span>{busy}</span>
          </p>
        ) : null}
        {error ? (
          <Alert>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </section>
    </div>
  );
}

function AppContent({ actions }: { actions: ReviewActions }) {
  const client = useCogniteSdk();
  const deployment = appConfig.deployments?.[0];
  const orgLabel = deployment?.org ?? '';
  const projectLabel = deployment?.project ?? client.project ?? '';

  return (
    <main className="min-h-screen bg-muted/50 text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle as="h1">Diagram Daddy</CardTitle>
            <CardDescription>
              Turn OCR text into reviewable tags for Diagram parsing, then clean up what you rejected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-6">
              <p className="flex flex-wrap items-center gap-2">
                <span>Connected to</span>
                {orgLabel ? <Badge variant="nordic">{orgLabel}</Badge> : null}
                <Badge variant="nordic">{projectLabel}</Badge>
              </p>
              <DrawingReview actions={actions} />
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

type AppProps = {
  deps?: ComponentProps<typeof CogniteSdkProvider>['deps'];
  actions?: Partial<ReviewActions>;
};

function App({ deps, actions }: AppProps) {
  const merged = useMemo(() => ({ ...defaultActions, ...actions }), [actions]);
  return (
    <CogniteSdkProvider loadingFallback={loadingFallback} errorFallback={errorFallback} deps={deps}>
      <AppContent actions={merged} />
    </CogniteSdkProvider>
  );
}

export default App;
