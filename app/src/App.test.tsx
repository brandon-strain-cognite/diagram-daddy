import type { HostAppAPI, ConnectToHostAppResult } from '@cognite/app-sdk';
import { CogniteClient } from '@cognite/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App, { type ReviewActions } from './App';
import type { ProjectDrawing, ReviewStatus } from './review';

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

const drawings: ProjectDrawing[] = [
  { id: 1, space: 'cardinal_samples', externalId: 'sheet-1', name: 'Sheet 1.pdf' },
  { id: 2, space: 'cardinal_samples', externalId: 'sheet-2', name: 'Sheet 2.tif' },
];

function makeActions(initial: ReviewStatus): Partial<ReviewActions> & { current: ReviewStatus } {
  const state = { current: initial };
  return {
    current: initial,
    drawings: () => Promise.resolve(drawings),
    status: () => Promise.resolve(state.current),
    stage: vi.fn(() => {
      state.current = { ...state.current, staged: 42 };
      return Promise.resolve(42);
    }),
    finish: vi.fn(() => {
      state.current = { staged: 3, suggested: 0, approved: 3, rejected: 0 };
      return Promise.resolve({ keep: [], remove: ['a', 'b'], verified: 3, discarded: 39 });
    }),
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

  it('lists drawings for cog-brandon', async () => {
    render(<App deps={makeDeps()} actions={makeActions({ staged: 0, suggested: 0, approved: 0, rejected: 0 })} />);
    expect(await screen.findByRole('button', { name: 'Sheet 1.pdf' })).toBeInTheDocument();
    expect(screen.getByText('cog-brandon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sheet 2.tif' })).toBeInTheDocument();
  });

  it('stages candidates, shows review counts, and finishes the review', async () => {
    const actions = makeActions({ staged: 0, suggested: 0, approved: 0, rejected: 0 });
    render(<App deps={makeDeps()} actions={actions} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sheet 1.pdf' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stage candidates' }));
    await waitFor(() => expect(actions.stage).toHaveBeenCalledOnce());
    expect(await screen.findByText('42 candidates staged for this drawing.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    await waitFor(() => expect(actions.finish).toHaveBeenCalledOnce());
    expect(await screen.findByText('Kept 3 verified · removed 2 candidates.')).toBeInTheDocument();
  });

  it('warns that unreviewed boxes will be treated as rejected', async () => {
    render(<App deps={makeDeps()} actions={makeActions({ staged: 10, suggested: 4, approved: 2, rejected: 4 })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sheet 1.pdf' }));
    expect(await screen.findByText(/4 boxes are still unreviewed/)).toBeInTheDocument();
    expect(screen.getByLabelText('Review counts')).toHaveTextContent('4 suggested · 2 verified · 4 rejected');
  });
});
