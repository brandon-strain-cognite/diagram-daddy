import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostAppAPI, ConnectToHostAppResult } from '@cognite/app-sdk';
import { CogniteClient } from '@cognite/sdk';
import type { ComponentProps, ReactNode } from 'react';

import App from './App';
import type { DrawingResult, Suggestion } from './diagram';

vi.mock('./cognite-file-viewer/CogniteFileViewer', () => ({
  CogniteFileViewer: ({
    source,
    renderOverlay,
  }: {
    source: { externalId: string };
    renderOverlay?: (info: { width: number; height: number; pageNumber: number }) => ReactNode;
  }) => (
    <div>
      <div>Preview {source.externalId}</div>
      {renderOverlay?.({ width: 1000, height: 800, pageNumber: 1 })}
    </div>
  ),
}));

type AppDeps = NonNullable<ComponentProps<typeof App>['deps']>;

function makeDeps(): AppDeps {
  return {
    connectToHostApp: vi.fn<AppDeps['connectToHostApp']>(() =>
      Promise.resolve({
        api: {
          getProject: vi.fn<HostAppAPI['getProject']>(() => Promise.resolve('brandon-cardinal-dev')),
          getBaseUrl: vi.fn<HostAppAPI['getBaseUrl']>(() => Promise.resolve('https://orangefield.cognitedata.com')),
          getAccessToken: vi.fn<HostAppAPI['getAccessToken']>(() => Promise.resolve('test-token')),
          getAppId: vi.fn<HostAppAPI['getAppId']>(() => Promise.resolve('diagram-daddy')),
        } as Partial<HostAppAPI> as HostAppAPI,
      })
    ),
    createClient: vi.fn<AppDeps['createClient']>((config) => new CogniteClient(config)),
  };
}

function makeLoadingDeps(): AppDeps {
  return {
    connectToHostApp: vi.fn<AppDeps['connectToHostApp']>(() => new Promise<ConnectToHostAppResult>(() => undefined)),
    createClient: vi.fn<AppDeps['createClient']>((config) => new CogniteClient(config)),
  };
}

const emptyLibrary = () => Promise.resolve([]);

function suggestion(id: string, text: string): Suggestion {
  return {
    id,
    text,
    end: text,
    label: 'String match 1.00',
    page: 1,
    x: 0.1,
    y: 0.2,
    width: 0.04,
    height: 0.02,
  };
}

const parsed: DrawingResult = {
  kind: 'parsed',
  space: 'cardinal_samples',
  externalId: 'drop-1',
  name: 'pump-tank.pdf',
  suggestions: [
    suggestion('a', 'T001'),
    suggestion('b', 'T001'),
    suggestion('c', 'P001'),
    suggestion('d', 'P001'),
  ],
};

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    render(<App deps={makeLoadingDeps()} />);
    expect(screen.getByText('Loading project...')).toBeInTheDocument();
  });

  it('renders a PDF drop target for cog-brandon', async () => {
    render(<App deps={makeDeps()} library={emptyLibrary} />);
    await waitFor(() => expect(screen.getByText('Diagram Daddy')).toBeInTheDocument());
    expect(screen.getByText('Drop another PDF')).toBeInTheDocument();
    expect(screen.getByText('cog-brandon')).toBeInTheDocument();
    expect(screen.getByText('brandon-cardinal-dev')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /parse again/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('rejects other files and does not parse a scan with full parsing', async () => {
    const pipeline = vi.fn(() => Promise.resolve({ kind: 'raster' } as const));
    render(<App deps={makeDeps()} pipeline={pipeline} library={emptyLibrary} />);
    await waitFor(() => expect(screen.getByLabelText(/Drop a PDF/)).toBeInTheDocument());
    const input = screen.getByLabelText(/Drop a PDF/);

    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [notes] } });
    expect(screen.getByText('Choose a PDF.')).toBeInTheDocument();
    expect(pipeline).not.toHaveBeenCalled();

    const scan = new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [scan] } });
    expect(await screen.findByText('This scan is not sent to full parsing.')).toBeInTheDocument();
    expect(pipeline).toHaveBeenCalledOnce();

    const zone = screen.getByText('Drop another PDF').closest('label');
    expect(zone).not.toBeNull();
    const dropped = new File(['%PDF'], 'dropped.pdf', { type: 'application/pdf' });
    fireEvent.drop(zone as HTMLElement, { dataTransfer: { files: [dropped] } });
    expect(await screen.findAllByText('This scan is not sent to full parsing.')).toHaveLength(1);
    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it('shows two suggested boxes for T001 and P001', async () => {
    const pipeline = vi.fn(() => Promise.resolve(parsed));
    render(<App deps={makeDeps()} pipeline={pipeline} library={emptyLibrary} />);
    await waitFor(() => expect(screen.getByLabelText(/Drop a PDF/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Drop a PDF/), {
      target: { files: [new File(['%PDF'], 'pump-tank.pdf', { type: 'application/pdf' })] },
    });

    expect(await screen.findByText('4 suggested boxes. Review them on the drawing.')).toBeInTheDocument();
    expect(screen.queryByText('T001 · String match 1.00 · Suggested')).not.toBeInTheDocument();
    expect(screen.queryByText('P001 · String match 1.00 · Suggested')).not.toBeInTheDocument();
    expect(screen.queryByText(/STORAGE TANK/)).not.toBeInTheDocument();
    expect(screen.queryByText(/FEED PUMP/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /parse again/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(await screen.findByText('Preview drop-1')).toBeInTheDocument();
  });

  it('opens a staged drawing without offering approval', async () => {
    const library = vi.fn(() =>
      Promise.resolve([
        {
          space: 'cardinal_samples',
          externalId: 'cdp_1_coc_5007_5',
          name: 'Sheet 5007',
          mimeType: 'application/pdf',
          canvasSheets: [],
          candidates: [
            {
              externalId: 'c001',
              fileSpace: 'cardinal_samples',
              fileExternalId: 'cdp_1_coc_5007_5',
              page: 1,
              text: 'PT-101',
              xMin: 0.2,
              yMin: 0.3,
              xMax: 0.28,
              yMax: 0.34,
              confidence: 1,
              source: 'cdf-pattern' as const,
              decision: 'pending' as const,
            },
          ],
        },
      ]),
    );
    render(<App deps={makeDeps()} library={library} />);
    expect(await screen.findByRole('button', { name: 'Sheet 5007 · 1 pending' })).toBeInTheDocument();
    expect(screen.getByText('Review on the drawing')).toBeInTheDocument();
    expect(screen.getByText('Purple boxes are pending. Select a box to inspect it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(await screen.findByText('Preview cdp_1_coc_5007_5')).toBeInTheDocument();
  });

  it('opens a TIFF through its Canvas PNG and keeps the boxes clickable', async () => {
    const library = vi.fn(() =>
      Promise.resolve([
        {
          space: 'cardinal_samples',
          externalId: 'cdp_1-2_aep_5006_16',
          name: 'Sheet 5006',
          mimeType: 'image/tiff',
          canvasSheets: [
            {
              page: 1,
              space: 'cardinal_samples',
              externalId: 'cdp_1-2_aep_5006_16__canvas_p1',
            },
          ],
          candidates: [
            {
              externalId: 'c010',
              fileSpace: 'cardinal_samples',
              fileExternalId: 'cdp_1-2_aep_5006_16',
              page: 1,
              text: 'FV-101',
              xMin: 0.1,
              yMin: 0.2,
              xMax: 0.2,
              yMax: 0.3,
              confidence: 1,
              source: 'cdf-pattern' as const,
              decision: 'pending' as const,
            },
          ],
        },
      ]),
    );
    render(<App deps={makeDeps()} library={library} />);
    expect(await screen.findByText('Preview cdp_1-2_aep_5006_16__canvas_p1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review FV-101' }));
    expect(screen.getByText('FV-101')).toBeInTheDocument();
    expect(screen.queryByText(/waiting for its Canvas PNG/)).not.toBeInTheDocument();
  });
});
