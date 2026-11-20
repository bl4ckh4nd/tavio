import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeetingSummary } from '../types'

const mocks = vi.hoisted(() => {
  const noop = vi.fn(() => Promise.resolve(undefined))
  const issueToken = vi.fn()
  return {
    rooms: [{ id: 'room-1', slug: 'room' }],
    me: null as any,
    queryCall: 0,
    mutations: [noop, noop, noop, noop, noop],
    mutationCall: 0,
    actions: [issueToken, noop],
    actionCall: 0,
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

const SUMMARY: MeetingSummary = {
  roomName: 'Weekly Sync',
  roomSlug: 'room',
  startedAt: 1_000,
  endedAt: 61_000,
  durationMs: 60_000,
  participantNames: ['Ada', 'Zoe'],
  chatMessageCount: 3,
  hadNotes: true,
  hadRecording: false,
  reason: 'left',
}

describe('AppState meeting summary', () => {
  beforeEach(() => {
    mocks.me = null
    mocks.queryCall = 0
    mocks.mutationCall = 0
    mocks.actionCall = 0
    mocks.issueToken.mockReset().mockResolvedValue({
      token: 'room-token',
      url: 'wss://livekit.test',
      roomId: 'room-1',
      identity: 'guest-1',
      role: 'Participant',
    })
  })

  afterEach(cleanup)

  it('keeps the leave snapshot after the meeting state is wiped', async () => {
    let context = null as ReturnType<typeof useAppState> | null
    const Probe = () => {
      context = useAppState()
      return (
        <>
          <output data-testid="identity">{context.user?.id ?? 'none'}</output>
          <output data-testid="summary">{context.lastMeetingSummary?.roomName ?? 'none'}</output>
        </>
      )
    }

    render(
      <AppStateProvider>
        <Probe />
      </AppStateProvider>,
    )

    if (!context) throw new Error('AppState context was not initialized')
    await act(async () => {
      await context!.handleJoinRoom('room', { name: 'Guest One' })
    })
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('guest-1'))

    await act(async () => {
      context!.handleLeaveRoom(SUMMARY)
    })

    // The endscreen renders after the session state is gone, so the snapshot
    // has to outlive it.
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('none'))
    expect(screen.getByTestId('summary')).toHaveTextContent('Weekly Sync')
    expect(context!.lastMeetingSummary).toEqual(SUMMARY)
  })

  it('clears a stale snapshot when leaving without one', async () => {
    let context: ReturnType<typeof useAppState> | null = null
    const Probe = () => {
      context = useAppState()
      return <output data-testid="summary">{context.lastMeetingSummary?.roomName ?? 'none'}</output>
    }

    render(
      <AppStateProvider>
        <Probe />
      </AppStateProvider>,
    )

    if (!context) throw new Error('AppState context was not initialized')
    await act(async () => {
      context!.handleLeaveRoom(SUMMARY)
    })
    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Weekly Sync'))

    await act(async () => {
      context!.handleLeaveRoom()
    })
    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('none'))
  })
})
