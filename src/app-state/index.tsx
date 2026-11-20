import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAction, useConvexAuth, useMutation } from 'convex/react'
import { useQueryResult, withoutError } from '../hooks/useQueryResult'
import { api } from '../../convex/_generated/api'
import { AppView, MeetingSummary, Room, RoomAccess, User, UserRole } from '../types'
import { normalizeJoinError } from './joinErrors'

export type JoinOptions = {
  isMuted?: boolean
  isCameraOff?: boolean
  noiseReductionEnabled?: boolean
  virtualBackground?: string
  audioInputDeviceId?: string
  videoInputDeviceId?: string
  audioOutputDeviceId?: string
}

type AppStateValue = {
  rooms: Room[]
  user: User | null
  meetingNotes: string
  livekitToken: string | null
  livekitUrl: string | null
  sessionCredential: string | null
  roomAccessToken: string | null
  livekitRoomName: string | null
  breakoutMode: 'native' | 'reconnect' | null
  currentBreakoutRoomId: string | null
  isJoining: boolean
  joinError: string | null
  joinOptions: JoinOptions
  meetingRoomId: string | null
  currentRoomSlug: string | null
  lastMeetingSummary: MeetingSummary | null
  setCurrentRoomSlug: (slug: string | null) => void
  handleJoinRoom: (slug: string, userInfo: Partial<User> & JoinOptions, password?: string) => Promise<boolean>
  handleRedeemHandoff: (code: string, userInfo: Partial<User> & JoinOptions) => Promise<any>
  handleLeaveRoom: (summary?: MeetingSummary) => void
  handleTransferred: () => void
  handleUpdateNotes: (html: string) => void
  createRoom: (room: Room) => Promise<void>
  updateRoom: (room: Room) => Promise<void>
  deleteRoom: (id: string) => Promise<void>
}

const AppStateContext = createContext<AppStateValue | null>(null)

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [joinOptions, setJoinOptions] = useState<JoinOptions>({})
  const [livekitToken, setLivekitToken] = useState<string | null>(null)
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null)
  const [sessionCredential, setSessionCredential] = useState<string | null>(null)
  const [roomAccessToken, setRoomAccessToken] = useState<string | null>(null)
  const [livekitRoomName, setLivekitRoomName] = useState<string | null>(null)
  const [breakoutMode, setBreakoutMode] = useState<'native' | 'reconnect' | null>(null)
  const [meetingNotes, setMeetingNotes] = useState<string>('')
  const [isJoining, setIsJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [meetingRoomId, setMeetingRoomId] = useState<string | null>(null)
  const [currentRoomSlug, setCurrentRoomSlug] = useState<string | null>(null)
  const [lastMeetingSummary, setLastMeetingSummary] = useState<MeetingSummary | null>(null)

  // This provider sits above every page and a running call, so a failed query must not throw here.
  const rooms = withoutError(useQueryResult(api.rooms.list, {})) || []
  // Optional: once Convex auth is wired, this will surface the current user/role from the backend.
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth()
  const me = withoutError(useQueryResult(api.users.me, isConvexAuthenticated ? {} : 'skip')) as any
  const createRoomMutation = useMutation(api.rooms.create)
  const updateRoomMutation = useMutation(api.rooms.update)
  const deleteRoomMutation = useMutation(api.rooms.remove)
  const updatePresence = useMutation(api.rooms.updatePresence)
  const leavePresence = useMutation(api.presence.leave)
  const issueToken = useAction(api.livekit.issueToken)
  const redeemHandoff = useAction(api.deviceHandoffs.redeem)
  const [currentBreakoutRoomId, setCurrentBreakoutRoomId] = useState<string | null>(null)

  useEffect(() => {
    // User auth state updated (sensitive data not logged for security)
  }, [me])

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[AppState] local user state changed', user)
  }, [user])

  useEffect(() => {
    if (currentRoomSlug) {
      const match = rooms.find(r => r.slug === currentRoomSlug)
      if (match?.id) setMeetingRoomId(match.id as string)
    }
  }, [currentRoomSlug, rooms])

  useEffect(() => {
    if (me && !user) {
      const serverRole = me.role as UserRole | undefined
      const resolvedRole =
        serverRole === UserRole.HOST
          ? UserRole.HOST
          : serverRole === UserRole.ADMIN
            ? UserRole.ADMIN
            : UserRole.PARTICIPANT
      const serverUser: User = {
        id: me.externalId ?? me.id,
        name: me.name ?? 'Anonymous',
        avatar: me.avatarUrl,
        role: resolvedRole,
        isMuted: false,
        isCameraOff: false,
        isScreenSharing: false,
        isHandRaised: false,
      }
      setUser(serverUser)
    }
  }, [me, user])

  const handleJoinRoom = async (slug: string, userInfo: Partial<User> & JoinOptions, password?: string): Promise<boolean> => {
    // eslint-disable-next-line no-console
    console.log('[AppState] handleJoinRoom called', { slug, hasPassword: !!password })
    setJoinError(null)
    setIsJoining(true)
    const room = rooms.find(r => r.slug === slug)
    // eslint-disable-next-line no-console
    console.log('[AppState] room lookup for join', { slug, room })

    // Identity is now generated server-side to prevent spoofing
    const displayName = userInfo.name || user?.name || 'Anonymous'
    setJoinOptions({
      isMuted: userInfo.isMuted,
      isCameraOff: userInfo.isCameraOff,
      noiseReductionEnabled: userInfo.noiseReductionEnabled,
      virtualBackground: userInfo.virtualBackground,
      audioInputDeviceId: userInfo.audioInputDeviceId,
      videoInputDeviceId: userInfo.videoInputDeviceId,
      audioOutputDeviceId: userInfo.audioOutputDeviceId,
    })
    setCurrentRoomSlug(slug)

    try {
      const tokenResponse = await issueToken({ roomSlug: slug, name: displayName, password })
      if (tokenResponse) {
        setLivekitToken(tokenResponse.token)
        setLivekitUrl(tokenResponse.url)
        setSessionCredential((tokenResponse as any).sessionCredential ?? null)
        setRoomAccessToken((tokenResponse as any).roomAccessToken ?? null)
        setLivekitRoomName((tokenResponse as any).livekitRoomName ?? null)
        setBreakoutMode((tokenResponse as any).breakoutMode ?? null)
        setCurrentBreakoutRoomId(null)
        if ((tokenResponse as any).roomId) {
          setMeetingRoomId((tokenResponse as any).roomId)
        }

        // Extract server-generated identity
        const identity = (tokenResponse as any).identity;
        const serverRole = (tokenResponse as any).role as UserRole | undefined
        const resolvedRole = serverRole === UserRole.HOST ? UserRole.HOST : serverRole === UserRole.ADMIN ? UserRole.ADMIN : UserRole.PARTICIPANT
        const newUser: User = {
          id: identity,
          name: displayName,
          avatar: undefined,
          role: resolvedRole,
          isMuted: userInfo.isMuted ?? false,
          isCameraOff: userInfo.isCameraOff ?? false,
          isScreenSharing: false,
          isHandRaised: false,
        }
        setUser(newUser)
        // Room aggregate presence is auth-backed; anonymous LiveKit guests must not call it.
        // The room the token is for, as on leaving: a room need not be in this person's list of rooms to host it.
        const joinedRoomId = (tokenResponse as any).roomId ?? room?.id
        if (joinedRoomId && me) {
          const isPrivileged = resolvedRole === UserRole.HOST || resolvedRole === UserRole.ADMIN
          // Fire and forget; presence is best-effort.
          void updatePresence({
            roomId: joinedRoomId as any,
            deltaParticipants: 1,
            deltaHosts: isPrivileged ? 1 : 0,
            accessToken: (tokenResponse as any).roomAccessToken
          }).catch((error) => console.error('[AppState] Failed to update presence after joining room', error))
        }
        setIsJoining(false)
        return true
      }
    } catch (err: any) {
      console.error('Failed to issue LiveKit token', err)
      setJoinError(normalizeJoinError(err))
    }
    setIsJoining(false)
    return false
  }

  const handleRedeemHandoff = async (code: string, userInfo: Partial<User> & JoinOptions): Promise<any> => {
    setJoinError(null)
    setIsJoining(true)
    try {
      const result: any = await redeemHandoff({ code })
      setLivekitToken(result.token)
      setLivekitUrl(result.url)
      setSessionCredential(result.sessionCredential ?? null)
      setRoomAccessToken(result.roomAccessToken ?? null)
      setLivekitRoomName(result.livekitRoomName ?? null)
      setBreakoutMode(result.breakoutMode ?? null)
      setMeetingRoomId(result.roomId ?? null)
      setCurrentRoomSlug(result.roomSlug ?? null)
      setCurrentBreakoutRoomId(result.currentRoomId && result.currentRoomId !== 'main' ? result.currentRoomId : null)
      setJoinOptions({
        isMuted: userInfo.isMuted,
        isCameraOff: userInfo.isCameraOff,
        noiseReductionEnabled: userInfo.noiseReductionEnabled,
        virtualBackground: userInfo.virtualBackground,
        audioInputDeviceId: userInfo.audioInputDeviceId,
        videoInputDeviceId: userInfo.videoInputDeviceId,
        audioOutputDeviceId: userInfo.audioOutputDeviceId,
      })
      const resolvedRole = result.role === UserRole.HOST ? UserRole.HOST : result.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.PARTICIPANT
      setUser({
        id: result.identity,
        name: result.name ?? userInfo.name ?? 'Anonymous',
        avatar: undefined,
        role: resolvedRole,
        isMuted: userInfo.isMuted ?? false,
        isCameraOff: userInfo.isCameraOff ?? false,
        isScreenSharing: false,
        isHandRaised: false,
      })
      setIsJoining(false)
      return result
    } catch (err: any) {
      setJoinError(normalizeJoinError(err))
      setIsJoining(false)
      return null
    }
  }

  const handleLeaveRoom = (summary?: MeetingSummary) => {
    // eslint-disable-next-line no-console
    console.log('[AppState] handleLeaveRoom called, clearing meeting state')
    // The endscreen reads this after the meeting state below is wiped, so it
    // has to be captured first.
    setLastMeetingSummary(summary ?? null)
    if (meetingRoomId && user) {
      void leavePresence({ roomId: meetingRoomId as any, userId: user.id, accessToken: roomAccessToken ?? undefined }).catch((error) => {
        console.error('[AppState] Failed to clear presence after leaving room', error)
      })
    }
    // Room aggregate presence is auth-backed; anonymous LiveKit guests must not call it.
    if (meetingRoomId && user && me) {
      const isPrivileged = user.role === UserRole.HOST || user.role === UserRole.ADMIN
      // Fire and forget; failures just mean stale counters.
      void updatePresence({
        roomId: meetingRoomId as any,
        deltaParticipants: -1,
        deltaHosts: isPrivileged ? -1 : 0,
        accessToken: roomAccessToken ?? undefined
      }).catch((error) => console.error('[AppState] Failed to update presence after leaving room', error))
    }
    setUser(null)
    setCurrentRoomSlug(null)
    setLivekitToken(null)
    setLivekitUrl(null)
    setSessionCredential(null)
    setRoomAccessToken(null)
    setLivekitRoomName(null)
    setBreakoutMode(null)
    setCurrentBreakoutRoomId(null)
    setJoinError(null)
    setMeetingRoomId(null)
  }

  const handleTransferred = () => {
    setUser(null)
    setCurrentRoomSlug(null)
    setLivekitToken(null)
    setLivekitUrl(null)
    setSessionCredential(null)
    setRoomAccessToken(null)
    setLivekitRoomName(null)
    setBreakoutMode(null)
    setCurrentBreakoutRoomId(null)
    setJoinError(null)
    setMeetingRoomId(null)
  }

  const handleUpdateNotes = (html: string) => {
    setMeetingNotes(html)
  }

  const createRoom = async (room: Room) => {
    await createRoomMutation({
      name: room.name,
      slug: room.slug,
      type: room.type,
      access: room.access,
      password: room.password,
      activeParticipants: room.activeParticipants,
      maxParticipants: room.maxParticipants,
      locked: room.locked,
      recording: room.recording,
      branding: room.branding
    })
  }

  const updateRoom = async (room: Room) => {
    await updateRoomMutation({
      id: room.id as any,
      name: room.name,
      slug: room.slug,
      type: room.type,
      access: room.access,
      password: room.password,
      activeParticipants: room.activeParticipants,
      maxParticipants: room.maxParticipants,
      locked: room.locked,
      recording: room.recording,
      branding: room.branding
    })
  }

  const deleteRoom = async (id: string) => {
    await deleteRoomMutation({ id: id as any })
  }

  const value: AppStateValue = useMemo(
    () => ({
      rooms,
      user,
      meetingNotes,
      livekitToken,
      livekitUrl,
      sessionCredential,
      roomAccessToken,
      livekitRoomName,
      breakoutMode,
      currentBreakoutRoomId,
      isJoining,
      joinError,
      joinOptions,
      meetingRoomId,
      currentRoomSlug,
      lastMeetingSummary,
      setCurrentRoomSlug,
      handleJoinRoom,
      handleRedeemHandoff,
      handleLeaveRoom,
      handleTransferred,
      handleUpdateNotes,
      createRoom,
      updateRoom,
      deleteRoom
    }),
    [
      rooms,
      user,
      meetingNotes,
      livekitToken,
      livekitUrl,
      sessionCredential,
      roomAccessToken,
      livekitRoomName,
      breakoutMode,
      currentBreakoutRoomId,
      isJoining,
      joinError,
      joinOptions,
      meetingRoomId,
      currentRoomSlug,
      lastMeetingSummary
    ]
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export const useAppState = () => {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
