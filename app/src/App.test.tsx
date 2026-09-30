import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostAppAPI, ConnectToHostAppResult } from '@cognite/app-sdk';
import { CogniteClient } from '@cognite/sdk';
import type { ComponentProps } from 'react';

import App from './App';

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

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    render(<App deps={makeLoadingDeps()} />);
    expect(screen.getByText('Loading project...')).toBeInTheDocument();
  });

  it('renders a PDF drop target for cog-brandon', async () => {
    render(<App deps={makeDeps()} />);
    await waitFor(() => expect(screen.getByText('Diagram Daddy')).toBeInTheDocument());
    expect(screen.getByText('Drop a PDF')).toBeInTheDocument();
    expect(screen.getByText('cog-brandon')).toBeInTheDocument();
    expect(screen.getByText('brandon-cardinal-dev')).toBeInTheDocument();
  });

  it('shows the selected PDF and rejects other files', async () => {
    render(<App deps={makeDeps()} />);
    await waitFor(() => expect(screen.getByLabelText(/Drop a PDF/)).toBeInTheDocument());
    const input = screen.getByLabelText(/Drop a PDF/);

    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [notes] } });
    expect(screen.getByText('Choose a PDF.')).toBeInTheDocument();
    expect(screen.queryByText('Selected notes.txt')).not.toBeInTheDocument();

    const drawing = new File(['%PDF'], 'pump-tank.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [drawing] } });
    expect(screen.getByText('Selected pump-tank.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Choose a PDF.')).not.toBeInTheDocument();
  });
});
