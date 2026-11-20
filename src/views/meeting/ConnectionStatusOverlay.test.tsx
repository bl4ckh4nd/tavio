import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionState, DisconnectReason, RoomEvent } from 'livekit-client'

const state = vi.hoisted(() => ({ value: 'disconnected' as ConnectionState }))
const room = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  connect: vi.fn(),
}))

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@livekit/components-react', () => ({
  useConnectionState: () => state.value,
  useRoomContext: () => room,
}))
vi.mock('convex/react', () => ({ useAction: () => vi.fn() }))
vi.mock('../../components/ui', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}))

import { ConnectionStatusOverlay } from './ConnectionStatusOverlay'

describe('connection terminal transfer state', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    state.value = ConnectionState.Disconnected
  })

  it('offers a real reconnect for an ordinary terminal disconnect', () => {
    render(<ConnectionStatusOverlay darkMode={false} onLeave={vi.fn()} />)
    expect(screen.getByText('Reconnect')).toBeInTheDocument()
  })

  describe('reconnects', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('shows nothing for a reconnect that ends quickly', () => {
      state.value = ConnectionState.Reconnecting
      const { rerender } = render(<ConnectionStatusOverlay darkMode={false} onLeave={vi.fn()} />)
      act(() => vi.advanceTimersByTime(1000))
      state.value = ConnectionState.Connected
      rerender(<ConnectionStatusOverlay darkMode={false} onLeave={vi.fn()} />)
      act(() => vi.advanceTimersByTime(2000))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('keeps the call usable during a signal reconnect and only shows a toast', () => {
      state.value = ConnectionState.SignalReconnecting
      render(<ConnectionStatusOverlay darkMode={false} onLeave={vi.fn()} />)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1500))
      expect(screen.getByRole('status')).toHaveTextContent('Reconnecting...')
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('blocks the call with the dialog once a media reconnect lasts', () => {
      state.value = ConnectionState.Reconnecting
      render(<ConnectionStatusOverlay darkMode={false} onLeave={vi.fn()} />)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1500))
      expect(screen.getByRole('alertdialog')).toHaveTextContent('Attempting to reconnect...')
    })
  })

  it('shows a terminal transferred overlay for duplicate identity without reconnect', () => {
    const onTransferred = vi.fn()
    render(<ConnectionStatusOverlay darkMode={false} onLeave={vi.fn()} onTransferred={onTransferred} />)
    const disconnectHandler = room.on.mock.calls.find(([event]) => event === RoomEvent.Disconnected)?.[1]
    act(() => disconnectHandler(DisconnectReason.DUPLICATE_IDENTITY))
    expect(screen.getByText('Meeting moved to another device')).toBeInTheDocument()
    expect(screen.queryByText('Reconnect')).not.toBeInTheDocument()
    screen.getByText('Close').click()
    expect(onTransferred).toHaveBeenCalledOnce()
  })
})
