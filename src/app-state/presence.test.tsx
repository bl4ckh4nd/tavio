import React, { useRef, useEffect } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const createRoom = vi.fn()
  const updateRoom = vi.fn()
  const deleteRoom = vi.fn()
  const updatePresence = vi.fn()
  const leavePresence = vi.fn()
  const issueToken = vi.fn()
  const redeemHandoff = vi.fn()

  return {
    rooms: [{ id: 'room-1', slug: 'room' }],
    me: null as any,
    queryCall: 0,
    mutationCall: 0,
    actionCall: 0,
    mutations: [createRoom, updateRoom, deleteRoom, updatePresence, leavePresence],
    actions: [issueToken, redeemHandoff],
    updatePresence,
    issueToken,
  }
})

vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useQueries: () => {
    const call = mocks.queryCall++
    return { result: call % 2 === 0 ? mocks.rooms : mocks.me }
  },
  useMutation: () => mocks.mutations[mocks.mutationCall++ % mocks.mutations.length],
  useAction: () => mocks.actions[mocks.actionCall++ % mocks.actions.length],
}))

import { AppStateProvider, useAppState } from './'

const JoinProbe = () => {
  const { handleJoinRoom, user } = useAppState()
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void handleJoinRoom('room', { name: 'Guest One' })
  }, [handleJoinRoom])

  return <output data-testid="identity">{user?.id ?? 'pending'}</output>
}

describe('AppState presence', () => {
  beforeEach(() => {
    mocks.me = null
    mocks.queryCall = 0
    mocks.mutationCall = 0
    mocks.actionCall = 0
    mocks.updatePresence.mockReset().mockResolvedValue(undefined)
    mocks.mutations[4].mockReset().mockResolvedValue(undefined)
    mocks.issueToken.mockReset().mockResolvedValue({
      token: 'room-token',
      url: 'wss://livekit.test',
      roomId: 'room-1',
      identity: 'guest-1',
      role: 'Participant',
    })
  })

  afterEach(cleanup)

  it('does not call the auth-protected presence mutation for an anonymous guest join', async () => {
    render(
      <AppStateProvider>
        <JoinProbe />
      </AppStateProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('guest-1'))
    expect(mocks.updatePresence).not.toHaveBeenCalled()
  })

  it('handles rejected fire-and-forget presence updates for join and leave', async () => {
    const joinPresenceError = new Error('join presence failed')
    const leavePresenceError = new Error('leave presence failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.me = { id: 'convex-user-1' }
    mocks.issueToken.mockResolvedValue({
      token: 'room-token',
      url: 'wss://livekit.test',
      roomId: 'room-1',
      identity: 'user-1',
      role: 'Participant',
    })
    mocks.updatePresence
      .mockRejectedValueOnce(joinPresenceError)
      .mockRejectedValueOnce(leavePresenceError)

    let context: ReturnType<typeof useAppState> | null = null
    const Probe = () => {
      context = useAppState()
      return <output data-testid="identity">{context.user?.id ?? 'pending'}</output>
    }

    render(
      <AppStateProvider>
        <Probe />
      </AppStateProvider>,
    )

    if (!context) throw new Error('AppState context was not initialized')
    await act(async () => {
      await context!.handleJoinRoom('room', { name: 'Signed-in User' })
    })
    await waitFor(() => expect(mocks.updatePresence).toHaveBeenCalledTimes(1))
    expect(consoleError).toHaveBeenCalledWith(
      '[AppState] Failed to update presence after joining room',
      joinPresenceError,
    )

    await act(async () => {
      context!.handleLeaveRoom()
    })
    await waitFor(() => expect(mocks.updatePresence).toHaveBeenCalledTimes(2))
    expect(consoleError).toHaveBeenCalledWith(
      '[AppState] Failed to update presence after leaving room',
      leavePresenceError,
    )
    consoleError.mockRestore()
  })
})
