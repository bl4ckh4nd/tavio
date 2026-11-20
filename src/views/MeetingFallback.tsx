import React from 'react'
import { Trans } from '@lingui/react/macro'
import { Button } from '../components/ui'

interface MeetingFallbackProps {
  onLeave: () => void
}

export const MeetingFallback: React.FC<MeetingFallbackProps> = ({ onLeave }) => {
  return (
    <main className="g-board grid h-[100dvh] w-full place-items-center p-4">
      <div className="dialog stock" style={{ boxShadow: 'var(--cast-board)' }}>
        <h1 className="dialog__title"><Trans>Join a room to start the meeting</Trans></h1>
        <p className="text-sm">
          <Trans>Go to a room URL (e.g., /room/&lt;slug&gt;), join from the lobby, and you'll be issued a LiveKit token.</Trans>
        </p>
        <div className="dialog__actions">
          <Button onClick={onLeave}>
            <Trans>Back to home</Trans>
          </Button>
        </div>
      </div>
    </main>
  )
}
