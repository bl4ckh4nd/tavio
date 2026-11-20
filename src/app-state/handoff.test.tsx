import React, { useEffect, useRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const redeem = vi.fn(async () => ({
  token: 'room-token',
  sessionCredential: 'session-token',
  breakoutMode: 'reconnect',
  url: 'wss://livekit.test',
  roomId: 'room-1',
  roomSlug: 'main',
  identity: 'guest-1',
  name: 'Guest One',
  role: 'Participant',
  currentRoomId: 'main',
}))
const presence = vi.fn()
let actionCall = 0
let mutationCall = 0
let queryCall = 0
const mutations = [vi.fn(), vi.fn(), vi.fn(), presence]

vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: true }),
  useQueries: () => ({ result: queryCall++ === 0 ? [] : null }),
  useMutation: () => mutations[mutationCall++] ?? vi.fn(),
  useAction: () => {
    actionCall += 1
    return actionCall === 2 ? redeem : vi.fn()
  },
}))

import { AppStateProvider, useAppState } from './'

const Probe = () => {
  const { handleRedeemHandoff, user } = useAppState()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void handleRedeemHandoff('handoff.secret', { name: 'Changed name', isMuted: true })
  }, [handleRedeemHandoff])
  return <output>{user?.id ?? 'pending'}</output>
}

describe('handoff hydration', () => {
  it('hydrates transferred identity without incrementing presence', async () => {
    actionCall = 0
    mutationCall = 0
    queryCall = 0
    render(<AppStateProvider><Probe /></AppStateProvider>)
    await waitFor(() => expect(screen.getByText('guest-1')).toBeInTheDocument())
    expect(redeem).toHaveBeenCalledWith({ code: 'handoff.secret' })
    expect(presence).not.toHaveBeenCalled()
  })
})
