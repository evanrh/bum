// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AlbumFilters } from '../../src/components/islands/AlbumFilters.tsx';

const SUBMITTERS = [
  { id: 1, name: 'bob' },
  { id: 2, name: 'carol' },
];

let assignMock: ReturnType<typeof vi.fn>;

const stubLocation = (search: string): void => {
  assignMock = vi.fn();
  vi.stubGlobal('location', {
    href: `http://localhost:4321/albums${search}`,
    search,
    assign: assignMock,
    replace: vi.fn(),
  });
};

beforeEach(() => {
  stubLocation('');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<AlbumFilters> submitter dropdown (issue #62 — sorting moved out to the AlbumGrid island)', () => {
  it('labels itself from the applied by= prop; without one it says everyone', () => {
    stubLocation('?by=1');
    render(<AlbumFilters submitters={SUBMITTERS} by={1} />);
    expect(screen.getByText('by: bob')).toBeTruthy();
    cleanup();
    render(<AlbumFilters submitters={SUBMITTERS} />);
    expect(screen.getByText('by: everyone')).toBeTruthy();
  });

  it('lists everyone + all submitters and navigates by URL on pick', () => {
    render(<AlbumFilters submitters={SUBMITTERS} by={2} />);
    fireEvent.click(screen.getByText('everyone'));
    expect(assignMock).toHaveBeenCalledWith('/albums');
    fireEvent.click(screen.getByText('bob'));
    expect(assignMock).toHaveBeenCalledWith('/albums?by=1');
  });

  it('a filter change drops the page param', () => {
    stubLocation('?by=1&page=2');
    render(<AlbumFilters submitters={SUBMITTERS} />);
    fireEvent.click(screen.getByText('carol'));
    expect(assignMock).toHaveBeenCalledWith('/albums?by=2');
  });

  it('an unknown by= still reads as everyone (deactivated picker)', () => {
    render(<AlbumFilters submitters={SUBMITTERS} by={99} />);
    expect(screen.getByText('by: everyone')).toBeTruthy();
  });
});
