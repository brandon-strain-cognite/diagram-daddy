import type { ComponentProps } from 'react';
import { useState } from 'react';
import { CogniteSdkProvider, useCogniteSdk } from '@cognite/app-sdk/react';
import { Alert, AlertDescription } from '@cognite/aura/components/alert';
import { Badge } from '@cognite/aura/components/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cognite/aura/components/card';
import { Loader } from '@cognite/aura/components/loader';

import appConfig from '../app.json';

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

function DropTarget() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  function take(file: File | undefined) {
    if (!file || !isPdf(file)) {
      setFileName(null);
      setRejected(Boolean(file));
      return;
    }
    setRejected(false);
    setFileName(file.name);
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <span className="text-lg">Drop a PDF</span>
        <span className="text-muted-foreground">Engineering drawing, one sheet to start.</span>
        <input
          className="sr-only"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => take(event.target.files?.[0])}
        />
      </label>
      {fileName ? <p>Selected {fileName}</p> : null}
      {rejected ? <p>Choose a PDF.</p> : null}
    </div>
  );
}

function AppContent() {
  const client = useCogniteSdk();
  const deployment = appConfig.deployments?.[0];
  const orgLabel = deployment?.org ?? '';
  const projectLabel = deployment?.project ?? client.project ?? '';

  return (
    <main className="min-h-screen bg-muted/50 text-foreground">
      <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center p-4 sm:p-8">
        <Card>
          <CardHeader>
            <CardTitle as="h1">Diagram Daddy</CardTitle>
            <CardDescription>Drop a drawing. Parsing starts in the next step.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-6">
              <p className="flex flex-wrap items-center gap-2">
                <span>Connected to</span>
                {orgLabel ? <Badge variant="nordic">{orgLabel}</Badge> : null}
                <Badge variant="nordic">{projectLabel}</Badge>
              </p>
              <DropTarget />
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

type AppProps = {
  deps?: ComponentProps<typeof CogniteSdkProvider>['deps'];
};

function App({ deps }: AppProps) {
  return (
    <CogniteSdkProvider loadingFallback={loadingFallback} errorFallback={errorFallback} deps={deps}>
      <AppContent />
    </CogniteSdkProvider>
  );
}

export default App;
