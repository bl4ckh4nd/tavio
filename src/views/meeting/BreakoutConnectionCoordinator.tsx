import { useCallback, useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { withoutError } from '../../hooks/useQueryResult'
import { useMeetingQuery } from './useMeetingQuery'
import { DisconnectReason, RoomEvent } from 'livekit-client'
import { useLocalParticipant, useRoomContext } from '@livekit/components-react'
import { api } from '../../../convex/_generated/api'
import type { BreakoutMode, BreakoutSession } from '../../types'

export interface BreakoutConnectionCoordinatorProps {
  roomId?: string
  parentLivekitRoomName: string
  identity: string
  sessionCredential?: string
  roomAccessToken?: string
  breakoutMode?: BreakoutMode
  initialCurrentRoomId?: string
  isManager: boolean
  requestedRoomId?: string | null
  onRequestHandled?: () => void
  onRoomChanged?: (roomId: string) => void
  onNotice?: (message: string) => void
  onError?: (message: string) => void
}

/** Keeps Convex assignment state and the current LiveKit room in sync. */
export const BreakoutConnectionCoordinator = ({
  roomId,
  parentLivekitRoomName,
  identity,
  sessionCredential,
  roomAccessToken,
  breakoutMode,
  initialCurrentRoomId = 'main',
  isManager,
  requestedRoomId,
  onRequestHandled,
  onRoomChanged,
  onNotice,
  onError,
}: BreakoutConnectionCoordinatorProps) => {
  const room = useRoomContext()
  const { localParticipant } = useLocalParticipant()
  const session = withoutError(useMeetingQuery(
    api.breakouts.getForRoom,
    roomId ? { roomId: roomId as any, accessToken: roomAccessToken } : 'skip',
  )) as BreakoutSession | null | undefined
  const switchRoom = useAction(api.breakoutActions.switchRoom)
  const issueReconnectToken = useAction(api.breakoutActions.issueReconnectToken)
  const [currentRoomId, setCurrentRoomId] = useState(initialCurrentRoomId)
  const [moveVersion, setMoveVersion] = useState(0)
  const inFlight = useRef<string | null>(null)
  // Once the host closed the meeting, every reconnect would recreate the room
  // that was just deleted, so all room syncing has to stop.
  const meetingClosedRef = useRef(false)
  const requestedRoomRef = useRef<string | null>(null)
  requestedRoomRef.current = requestedRoomId ?? null

  const setRoom = useCallback((next: string) => {
    setCurrentRoomId(next)
    onRoomChanged?.(next)
  }, [onRoomChanged])

  const stopScreenShare = useCallback(async () => {
    if (!localParticipant?.isScreenShareEnabled) return
    await localParticipant.setScreenShareEnabled(false)
    onNotice?.('Screen sharing stopped while changing rooms.')
  }, [localParticipant, onNotice])

  const reconnect = useCallback(async (token: string, url: string) => {
    await stopScreenShare()
    // Keep LocalTracks alive so microphone/camera selection survives a reconnect.
    await room.disconnect(false)
    await room.connect(url, token)
  }, [room, stopScreenShare])

  const moveTo = useCallback(async (targetRoomId: string, generation = session?.generation ?? 0) => {
    if (meetingClosedRef.current) return
    const targetLivekitRoomName = targetRoomId === 'main'
      ? parentLivekitRoomName
      : session?.rooms.find(entry => entry.id === targetRoomId)?.livekitRoomName
    if (!roomId || !sessionCredential || !targetRoomId || (targetRoomId === currentRoomId && room.name === targetLivekitRoomName)) return
    const key = `${generation}:${currentRoomId}->${targetRoomId}`
    if (inFlight.current) return
    inFlight.current = key
    try {
      await stopScreenShare()
      const result: any = await switchRoom({
        credential: sessionCredential,
        roomId: roomId as any,
        sourceRoomId: currentRoomId,
        currentLivekitRoomName: room.name,
        targetRoomId,
      })
      if (result?.mode === 'reconnect' && result.token && result.url) {
        await reconnect(result.token, result.url)
      }
      if (result?.mode === 'reconnect' || breakoutMode === 'reconnect') setRoom(targetRoomId)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Unable to change breakout room.')
    } finally {
      inFlight.current = null
      if (requestedRoomRef.current && requestedRoomRef.current !== targetRoomId) {
        setMoveVersion(version => version + 1)
      }
    }
  }, [breakoutMode, currentRoomId, parentLivekitRoomName, reconnect, room, roomId, session?.generation, session?.rooms, sessionCredential, setRoom, stopScreenShare, switchRoom, onError])

  useEffect(() => {
    const onDisconnected = (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.ROOM_DELETED) meetingClosedRef.current = true
    }
    room.on(RoomEvent.Disconnected, onDisconnected)
    return () => { room.off(RoomEvent.Disconnected, onDisconnected) }
  }, [room])

  useEffect(() => {
    const moved = (roomName: string) => {
      const destination = session?.rooms.find(entry => entry.livekitRoomName === roomName)
      setRoom(destination?.id ?? 'main')
    }
    const handleMoved = (...args: unknown[]) => {
      if (typeof args[0] === 'string') moved(args[0])
    }
    room.on(RoomEvent.Moved, handleMoved as any)
    return () => { room.off(RoomEvent.Moved, handleMoved as any) }
  }, [room, session?.rooms, setRoom])

  useEffect(() => {
    if (meetingClosedRef.current) return
    if (!sessionCredential || !roomId) return
    if (session === undefined) return
    if (session?.status === 'ended') {
      void moveTo('main', session.generation)
      return
    }
    if (!session) {
      if (currentRoomId === 'main' || inFlight.current) return
      const key = `end:${currentRoomId}`
      if (inFlight.current === key) return
      inFlight.current = key
      void issueReconnectToken({
        credential: sessionCredential,
        roomId: roomId as any,
        currentRoomId,
      }).then((result: any) => {
        if (result?.token && result.url) return reconnect(result.token, result.url)
      }).then(() => setRoom('main')).catch(error => {
        onError?.(error instanceof Error ? error.message : 'Unable to return to the main room.')
      }).finally(() => { inFlight.current = null })
      return
    }
    if (isManager) return
    const assignment = session.assignments.find(entry => entry.identity === identity)
    void moveTo(assignment?.roomId ?? 'main', session.generation)
  }, [currentRoomId, identity, isManager, issueReconnectToken, moveTo, moveVersion, onError, reconnect, roomId, session, sessionCredential, setRoom])

  useEffect(() => {
    if (meetingClosedRef.current) return
    if (!isManager || !requestedRoomId || !session || sessionCredential === undefined || inFlight.current) return
    const requestedAtStart = requestedRoomId
    void moveTo(requestedAtStart, session.generation).finally(() => {
      if (requestedAtStart === requestedRoomId) onRequestHandled?.()
    })
  }, [isManager, moveTo, moveVersion, onRequestHandled, requestedRoomId, session, sessionCredential])

  return null
}
