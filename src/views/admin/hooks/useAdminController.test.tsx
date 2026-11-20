import { act, renderHook, waitFor } from '@testing-library/react';
import { useQueries } from 'convex/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRoom } from '../../../../tests/helpers/fixtures';
import { useAdminController } from './useAdminController';

const {
  ensureUserMock,
  updateMeMock,
  checkoutMock,
  toastSuccess,
  toastError,
  writeTextMock,
  signOutMock,
} = vi.hoisted(() => ({
  ensureUserMock: vi.fn(async (_args?: unknown) => ({})),
  updateMeMock: vi.fn(async (_args?: unknown) => ({})),
  checkoutMock: vi.fn(async () => ({ url: undefined })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  writeTextMock: vi.fn(async () => undefined),
  signOutMock: vi.fn(async (): Promise<{ error?: unknown }> => ({})),
}));

vi.mock('../../../lib/authClient', () => ({ authClient: { signOut: signOutMock } }));

vi.mock('@lingui/core/macro', () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, part, idx) => `${acc}${part}${values[idx] ?? ''}`, ''),
}));

vi.mock('convex/react', () => ({
  useQueries: vi.fn(() => ({ result: [] })),
  useQuery: vi.fn((_ref: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    if (args && typeof args === 'object' && 'roomIds' in (args as any)) return {};
    if (args && typeof args === 'object' && 'roomId' in (args as any)) return { contentHtml: '<p>Doc</p>' };
    return [];
  }),
  useMutation: vi.fn(() => async (args: any) => {
    if (args && (Object.prototype.hasOwnProperty.call(args, 'name') || Object.prototype.hasOwnProperty.call(args, 'avatarUrl'))) {
      return updateMeMock(args);
    }
    return ensureUserMock(args);
  }),
  useAction: vi.fn(() => checkoutMock),
}));

vi.mock('../../../components/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
  }),
}));

describe('useAdminController', () => {
  beforeEach(() => {
    ensureUserMock.mockClear();
    updateMeMock.mockClear();
    checkoutMock.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
    window.localStorage.clear();
  });

  it('reports failed metrics and recordings queries instead of throwing', () => {
    vi.mocked(useQueries).mockReturnValue({ result: new Error('query failed') });
    const { result } = renderHook(() =>
      useAdminController({ rooms: [], onCreate: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() } as any),
    );
    vi.mocked(useQueries).mockReturnValue({ result: [] });

    expect(result.current.analyticsFailed).toBe(true);
    expect(result.current.analytics).toBeUndefined();
    expect(result.current.recordingsFailed).toBe(true);
    expect(result.current.recordings).toBeUndefined();
  });

  it('reports a failed room list instead of throwing, and still-loading apart from it', () => {
    vi.mocked(useQueries).mockReturnValue({});
    const loading = renderHook(() =>
      useAdminController({ rooms: [], onCreate: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() } as any),
    );
    expect(loading.result.current.roomsLoading).toBe(true);
    expect(loading.result.current.roomsFailed).toBe(false);

    vi.mocked(useQueries).mockReturnValue({ result: new Error('query failed') });
    const failed = renderHook(() =>
      useAdminController({ rooms: [], onCreate: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() } as any),
    );
    vi.mocked(useQueries).mockReturnValue({ result: [] });

    expect(failed.result.current.roomsLoading).toBe(false);
    expect(failed.result.current.roomsFailed).toBe(true);
  });

  describe('signing out', () => {
    const assign = vi.fn();
    const render = () => renderHook(() =>
      useAdminController({ rooms: [], onCreate: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() } as any),
    );

    beforeEach(() => {
      assign.mockClear();
      signOutMock.mockReset();
      signOutMock.mockResolvedValue({});
      vi.stubGlobal('location', { ...window.location, assign });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('loads the home page anew, so nothing of the account carries over', async () => {
      const { result } = render();

      await act(async () => {
        await result.current.handleSignOut();
      });

      expect(assign).toHaveBeenCalledWith('/');
      expect(toastError).not.toHaveBeenCalled();
    });

    it.each([
      ['the server refuses', async () => ({ error: { message: 'no' } })],
      ['the request fails', async () => { throw new Error('offline'); }],
    ])('stays on the page and says so when %s', async (_case, outcome) => {
      signOutMock.mockImplementationOnce(outcome);
      const { result } = render();

      await act(async () => {
        await result.current.handleSignOut();
      });

      expect(assign).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith('Could not sign out. Please try again.');
      expect(result.current.signingOut).toBe(false);
    });
  });

  it('creates a room and shows success toast', async () => {
    const onCreateRoom = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useAdminController({ rooms: [], onCreateRoom, onUpdateRoom: vi.fn(), onDeleteRoom: vi.fn() })
    );

    await waitFor(() => {
      expect(ensureUserMock).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.handleSaveRoom({ name: 'New Room', slug: 'new-room' } as any);
    });

    expect(onCreateRoom).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Room', slug: 'new-room' })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Room created');
  });

  it('updates an existing room and shows success toast', async () => {
    const room = makeRoom({ id: 'room-1', name: 'Alpha', slug: 'alpha' });
    const onUpdateRoom = vi.fn(async () => {});

    const { result } = renderHook(() =>
      useAdminController({ rooms: [room], onCreateRoom: vi.fn(), onUpdateRoom, onDeleteRoom: vi.fn() })
    );

    act(() => {
      result.current.handleOpenEdit(room);
    });

    await act(async () => {
      await result.current.handleSaveRoom({ name: 'Alpha Updated' } as any);
    });

    expect(onUpdateRoom).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'room-1', name: 'Alpha Updated', slug: 'alpha' })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Room updated');
  });

  it('copies room link to clipboard and shows success toast', async () => {
    const room = makeRoom({ slug: 'team-room' });
    const { result } = renderHook(() =>
      useAdminController({ rooms: [room], onCreateRoom: vi.fn(), onUpdateRoom: vi.fn(), onDeleteRoom: vi.fn() })
    );

    await act(async () => {
      await result.current.handleCopyRoomLink(room);
    });

    expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/room/team-room`);
    expect(toastSuccess).toHaveBeenCalledWith('Copied /room/team-room');
  });

  it('shows error toast when clipboard copy fails', async () => {
    const room = makeRoom({ slug: 'team-room' });
    writeTextMock.mockRejectedValueOnce(new Error('clipboard denied'));

    const { result } = renderHook(() =>
      useAdminController({ rooms: [room], onCreateRoom: vi.fn(), onUpdateRoom: vi.fn(), onDeleteRoom: vi.fn() })
    );

    await act(async () => {
      await result.current.handleCopyRoomLink(room);
    });

    expect(toastError).toHaveBeenCalledWith('Could not copy room link');
  });

  it('saves trimmed profile fields through updateMe', async () => {
    const { result } = renderHook(() =>
      useAdminController({ rooms: [], onCreateRoom: vi.fn(), onUpdateRoom: vi.fn(), onDeleteRoom: vi.fn() })
    );

    act(() => {
      result.current.setProfileName('  Jane Doe  ');
      result.current.setProfileAvatarUrl('  https://img.test/avatar.png  ');
    });

    await act(async () => {
      await result.current.handleSaveProfile();
    });

    expect(updateMeMock).toHaveBeenCalledWith({
      name: 'Jane Doe',
      avatarUrl: 'https://img.test/avatar.png',
    });
    expect(toastSuccess).toHaveBeenCalledWith('Profile updated');
  });
});
