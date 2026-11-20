import React, { useEffect } from 'react'
import { t } from '@lingui/core/macro'
import { Trans } from '@lingui/react/macro'
import { Router, Route, RootRoute, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { useAction, useQuery } from 'convex/react'
import { Landing } from './views/Landing'
import { Lobby } from './views/Lobby'
import { Meeting } from './views/Meeting'
import { MeetingAccessBoundary } from './views/meeting/MeetingAccessBoundary'
import { Admin } from './views/Admin'
import { Docs } from './views/Docs'
import { Auth } from './views/Auth'
import { PasswordReset } from './views/PasswordReset'
import { Onboarding } from './views/Onboarding'
import { Goodbye } from './views/Goodbye'
import { AppStateProvider, useAppState } from './app-state'
import { api } from '../convex/_generated/api'
import { AppView, MeetingSummary, RoomAccess, UserRole } from './types'
import { AuthGuard } from './components/AuthGuard'
import { useStableAuth } from './hooks/useStableAuth'
import { ToastProvider, toUserFacingError } from './components/ToastProvider'
import { BrandMark } from './components/BrandMark'
import { Button, Modal, Notice } from './components/ui'
import { authClient } from './lib/authClient'

// HMR Route Persistence - saves/restores route across Vite HMR cycles
const ROUTE_STATE_KEY = 'tavio:lastRoute'
const HMR_GRACE_MS = 3000

function isAuthRoute(pathname: string): boolean {
  return pathname.startsWith('/auth')
}

function isProtectedRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/onboarding'
}

function shouldPersistRoute(pathname: string): boolean {
  return pathname !== '/' && !isAuthRoute(pathname) && !pathname.startsWith('/handoff/')
}

function persistRoute(pathname: string): void {
  try {
    sessionStorage.setItem(ROUTE_STATE_KEY, JSON.stringify({
      pathname,
      timestamp: Date.now()
    }))
  } catch { /* ignore storage errors */ }
}

function clearPersistedRoute(): void {
  try {
    sessionStorage.removeItem(ROUTE_STATE_KEY)
  } catch { /* ignore storage errors */ }
}

function getPersistedRoute(): string | null {
  try {
    const stored = sessionStorage.getItem(ROUTE_STATE_KEY)
    if (!stored) return null
    const { pathname, timestamp } = JSON.parse(stored)
    // Only restore if within grace period (HMR just happened)
    if (Date.now() - timestamp < HMR_GRACE_MS) return pathname
    return null
  } catch { return null }
}

const RouteSpinner: React.FC = () => {
  const state = useRouterState({ select: (s) => ({ status: (s as any).status, isLoading: (s as any).isLoading }) })
  const isBusy = state?.status && state.status !== 'idle' ? true : state?.isLoading
  if (!isBusy) return null;
  return <div className="fixed top-0 left-0 right-0 h-0.5 bg-muted z-(--z-tooltip)" />
}

const DeskScreen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <main className="g-desk th">
    <div className="th__top"><BrandMark logoClassName="bar__logo" /></div>
    <div className="grid place-items-center px-(--gutter) pb-[72px]">{children}</div>
  </main>
)

// Every dead end on the desk says what happened and offers a way out.
const DeskError: React.FC<{ children: React.ReactNode; onRetry?: () => void }> = ({ children, onRetry }) => {
  const router = useRouter()
  return (
    <DeskScreen>
      <div className="authsheet stock stock--lift">
        <Notice variant="error">{children}</Notice>
        <div className="flex flex-wrap gap-2">
          {onRetry ? <Button onClick={onRetry}><Trans>Try Again</Trans></Button> : null}
          <Button
            variant="secondary"
            onClick={() => {
              clearPersistedRoute()
              void router.navigate({ to: '/' })
            }}
          >
            <Trans>Go to Home</Trans>
          </Button>
        </div>
      </div>
    </DeskScreen>
  )
}

const RouteDebugLogger: React.FC = () => {
  const state = useRouterState({
    select: (s) => ({
      pathname: s.location.pathname,
      searchStr: s.location.searchStr,
      status: (s as any).status,
    }),
  })
  const router = useRouter()
  const { isLoading: isAuthLoading, isAuthenticated } = useStableAuth()

  // Save route on changes (for HMR recovery)
  React.useEffect(() => {
    // Persist only non-auth app routes for HMR recovery.
    if (state.pathname && shouldPersistRoute(state.pathname)) {
      persistRoute(state.pathname)
    }
  }, [state])

  // HMR recovery - restore route on mount if we were redirected to /
  React.useEffect(() => {
    if (isAuthLoading) return

    const savedRoute = getPersistedRoute()
    if (!savedRoute || state.pathname !== '/') return

    let target = savedRoute
    if (isAuthenticated && isAuthRoute(savedRoute)) {
      target = '/admin'
    } else if (!isAuthenticated && isProtectedRoute(savedRoute)) {
      target = '/auth/login'
    }

    if (target && target !== '/') {
      router.navigate({ to: target as any })
    }
  }, [router, isAuthLoading, isAuthenticated, state.pathname])

  return null
}

const RootLayout: React.FC = () => (
  <ToastProvider>
    <AppStateProvider>
      <RouteSpinner />
      <RouteDebugLogger />
      <Outlet />
    </AppStateProvider>
  </ToastProvider>
)

const rootRoute = new RootRoute({
  component: RootLayout,
})

const landingRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => {
    const { rooms } = useAppState()
    const nav = useNav()
    return <Landing onNavigate={nav} />
  },
})

const authRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/auth/$mode',
  component: () => {
    const nav = useNav()
    const router = useRouter()
    const { isLoading, isAuthenticated } = useStableAuth()
    const { mode: rawMode } = authRoute.useParams()
    const mode = (rawMode === 'register' ? 'register' : 'login') as 'login' | 'register'
    // Someone who is already signed in has no use for the login screen, e.g. after Back.
    useEffect(() => {
      if (mode === 'login' && !isLoading && isAuthenticated) {
        router.navigate({ to: '/admin', replace: true })
      }
    }, [mode, isLoading, isAuthenticated, router])
    return (
      <Auth
        initialMode={mode}
        // replace: the auth screen must not stay in history, or Back lands on it again.
        onLogin={() => {
          clearPersistedRoute()
          router.navigate({ to: '/admin', replace: true })
        }}
        onSignup={() => {
          router.navigate({ to: '/onboarding', replace: true })
        }}
        onNavigate={nav}
      />
    )
  },
})

const passwordResetRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/auth/reset',
  component: () => {
    const nav = useNav()
    return <PasswordReset onNavigate={nav} />
  },
})

const passwordResetTokenRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/auth/reset/$token',
  component: () => {
    const nav = useNav()
    const { token } = passwordResetTokenRoute.useParams()
    return <PasswordReset token={token} onNavigate={nav} />
  },
})

const onboardingRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: () => {
    const nav = useNav()
    return (
      <AuthGuard redirectTo="/auth/login">
        <Onboarding onComplete={() => nav(AppView.ADMIN)} />
      </AuthGuard>
    )
  },
})

const ADMIN_TABS = ['OVERVIEW', 'ROOMS', 'RECORDINGS', 'SETTINGS'] as const
type AdminTabName = (typeof ADMIN_TABS)[number]

// The dashboard, a room's page and a session's page are one screen with the same bar and dialogs.
const AdminScreen: React.FC<{ roomSlug?: string; sessionId?: string; initialTab?: AdminTabName }> = ({ roomSlug, sessionId, initialTab }) => {
  const nav = useNav()
  const router = useRouter()
  const { rooms, createRoom, updateRoom, deleteRoom } = useAppState()
  return (
    <AuthGuard redirectTo="/auth/login">
      <Admin
        onNavigate={nav}
        rooms={rooms}
        onCreateRoom={createRoom}
        onUpdateRoom={updateRoom}
        onDeleteRoom={deleteRoom}
        roomSlug={roomSlug}
        sessionId={sessionId}
        initialTab={initialTab}
        onOpenRoomPage={(slug) => router.navigate({ to: '/admin/room/$slug', params: { slug } as any })}
        onOpenSession={(slug, id) => router.navigate({ to: '/admin/room/$slug/session/$sessionId', params: { slug, sessionId: id } as any })}
        onLeaveRoomPage={(tab) => router.navigate({ to: '/admin', search: { tab: tab.toLowerCase() } as any })}
      />
    </AuthGuard>
  )
}

const adminRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/admin',
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === 'string' ? { tab: search.tab } : {},
  component: () => {
    const { tab } = adminRoute.useSearch()
    const initialTab = ADMIN_TABS.find((name) => name.toLowerCase() === tab)
    return <AdminScreen initialTab={initialTab} />
  },
})

const adminRoomRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/admin/room/$slug',
  component: () => {
    const { slug } = adminRoomRoute.useParams()
    return <AdminScreen roomSlug={slug} />
  },
})

const adminSessionRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/admin/room/$slug/session/$sessionId',
  component: () => {
    const { slug, sessionId } = adminSessionRoute.useParams()
    return <AdminScreen roomSlug={slug} sessionId={sessionId} />
  },
})

const docsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/docs',
  component: () => {
    const nav = useNav()
    return <Docs onNavigate={nav} />
  },
})

const goodbyeRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/goodbye',
  component: () => {
    const router = useRouter()
    const { lastMeetingSummary } = useAppState()
    const handleHome = React.useCallback(() => {
      clearPersistedRoute()
      router.navigate({ to: '/' })
    }, [router])
    const roomSlug = lastMeetingSummary?.roomSlug
    const handleRejoin = React.useCallback(() => {
      if (!roomSlug) return
      clearPersistedRoute()
      router.navigate({ to: '/room/$slug', params: { slug: roomSlug } as any })
    }, [router, roomSlug])
    const sessionId = lastMeetingSummary?.sessionId
    const handleOpenSession = React.useCallback(() => {
      if (!roomSlug || !sessionId) return
      clearPersistedRoute()
      router.navigate({ to: '/admin/room/$slug/session/$sessionId', params: { slug: roomSlug, sessionId } as any })
    }, [router, roomSlug, sessionId])
    return (
      <Goodbye
        onNavigateHome={handleHome}
        summary={lastMeetingSummary}
        onRejoin={roomSlug ? handleRejoin : undefined}
        onOpenSession={roomSlug && sessionId ? handleOpenSession : undefined}
      />
    )
  },
})

const lobbyRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/room/$slug',
  component: () => {
    const nav = useNav()
    const { slug } = lobbyRoute.useParams()
    const { handleJoinRoom, isJoining, joinError, setCurrentRoomSlug } = useAppState()
    React.useEffect(() => setCurrentRoomSlug(slug), [slug, setCurrentRoomSlug])
    const room = useQuery(api.rooms.getBySlug, { slug })
    const { data: session } = authClient.useSession()
    const roomLoading = room === undefined
    const requiresPassword = room?.access === RoomAccess.PASSWORD
    return (
      <Lobby
        roomSlug={slug}
        initialName={session?.user?.name}
        room={room ?? undefined}
        roomLoading={roomLoading}
        onNavigate={nav}
        onJoin={async (info) => {
          if (room?.access === RoomAccess.MEMBERS) {
            // Placeholder: real auth check would go here
          }
          // SECURITY: Never pass password from room object. Only user-entered passwords via onPasswordSubmit.
          const success = await handleJoinRoom(slug, info, undefined)
          if (success) {
            nav(AppView.MEETING, slug)
          }
        }}
        isJoining={isJoining}
        joinError={joinError}
        requirePassword={requiresPassword}
        onPasswordSubmit={async (info, pwd) => {
          const success = await handleJoinRoom(slug, info, pwd)
          if (success) {
            nav(AppView.MEETING, slug)
          }
          return success
        }}
      />
    )
  },
})

const handoffRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/handoff/$code',
  component: () => {
    const nav = useNav()
    const router = useRouter()
    const { code } = handoffRoute.useParams()
    const { handleRedeemHandoff, isJoining, joinError } = useAppState()
    const inspectHandoff = useAction(api.deviceHandoffs.inspect)
    const [details, setDetails] = React.useState<any>(null)
    const [inspectError, setInspectError] = React.useState<string | null>(null)
    const [pending, setPending] = React.useState<any>(null)
    const [redeeming, setRedeeming] = React.useState(false)
    const decodedCode = React.useMemo(() => {
      try { return decodeURIComponent(code) } catch { return code }
    }, [code])

    React.useEffect(() => {
      let cancelled = false
      void inspectHandoff({ code: decodedCode }).then((result: any) => {
        if (!cancelled) setDetails(result)
      }).catch((error: any) => {
        if (!cancelled) setInspectError(error instanceof Error ? toUserFacingError(error.message) : t`This handoff link is invalid or expired.`)
      })
      return () => { cancelled = true }
    }, [decodedCode, inspectHandoff])

    const confirmJoin = async () => {
      if (!pending) return
      setRedeeming(true)
      const result = await handleRedeemHandoff(decodedCode, pending)
      setRedeeming(false)
      if (!result) return
      clearPersistedRoute()
      await router.navigate({ to: '/meeting/$slug', params: { slug: result.roomSlug } as any, replace: true })
    }

    if (inspectError || joinError) return <DeskError>{inspectError || joinError}</DeskError>
    if (!details) return <DeskScreen><p role="status" className="flex items-center gap-2 text-sm text-muted"><span className="spin" aria-hidden="true" /><Trans>Preparing secure device handoff…</Trans></p></DeskScreen>
    const room = details.room
    if (!room) return <DeskError><Trans>Room not found.</Trans></DeskError>
    return <>
      <Lobby
        roomSlug={details.roomSlug}
        initialName={details.name}
        lockName
        room={room}
        roomLoading={false}
        onNavigate={nav}
        onJoin={(payload) => setPending(payload)}
        isJoining={isJoining}
        joinError={null}
        requirePassword={false}
      />
      <Modal isOpen={!!pending} onClose={() => setPending(null)} ariaLabel={t`Confirm device handoff`}>
        <div className="dialog">
          <h2 className="dialog__title"><Trans>Continue on this device?</Trans></h2>
          <p className="text-sm text-ink-2"><Trans>Your meeting identity, selected room, and breakout assignment will move here. The previous device will be disconnected.</Trans></p>
          <div className="dialog__actions">
            <Button variant="secondary" onClick={() => setPending(null)}><Trans>Cancel</Trans></Button>
            <Button onClick={() => void confirmJoin()} disabled={redeeming}>{redeeming ? <Trans>Connecting…</Trans> : <Trans>Confirm and join</Trans>}</Button>
          </div>
        </div>
      </Modal>
    </>
  },
})

const meetingRoute = new Route({
  getParentRoute: () => rootRoute,
  path: '/meeting/$slug',
  component: () => {
    const isE2ESim = import.meta.env.DEV && new URLSearchParams(window.location.search).has('e2eSim')
    const router = useRouter()
    const { slug } = meetingRoute.useParams()
    const {
      user,
      handleLeaveRoom,
      meetingNotes,
      handleUpdateNotes,
      joinOptions,
      livekitToken,
      livekitUrl,
      sessionCredential,
      roomAccessToken,
      livekitRoomName,
      breakoutMode,
      meetingRoomId,
      currentBreakoutRoomId,
      handleTransferred,
      setCurrentRoomSlug,
    } = useAppState()
    React.useEffect(() => setCurrentRoomSlug(slug), [slug, setCurrentRoomSlug])

    // Leaving clears `user`, which re-renders this still-mounted route before
    // the navigation lands; without this flag the "no user" effect below would
    // redirect to the lobby and override the goodbye/home target.
    const leavingRef = React.useRef(false)

    const handleLeaveToHome = React.useCallback((summary?: MeetingSummary) => {
      leavingRef.current = true
      handleLeaveRoom(summary)
      clearPersistedRoute()
      router.navigate({ to: '/goodbye' })
    }, [handleLeaveRoom, router])

    const handleTransferredToHome = React.useCallback(() => {
      leavingRef.current = true
      handleTransferred()
      clearPersistedRoute()
      router.navigate({ to: '/' })
    }, [handleTransferred, router])

    React.useEffect(() => {
      if (!user && !isE2ESim && !leavingRef.current) {
        router.navigate({ to: '/room/$slug', params: { slug } as any })
      }
    }, [user, router, slug, isE2ESim])

    const meetingUser = user ?? (isE2ESim ? {
      id: 'e2e-sim',
      name: 'E2E Sim',
      role: UserRole.PARTICIPANT,
      isMuted: false,
      isCameraOff: false,
      isScreenSharing: false,
      isHandRaised: false,
    } : null)

    if (!meetingUser) return null
    return (
      <MeetingAccessBoundary onRejoin={() => handleLeaveRoom()}>
      <Meeting
        currentUser={meetingUser}
        onLeave={handleLeaveToHome}
        meetingNotes={meetingNotes}
        onUpdateNotes={handleUpdateNotes}
        initialMuted={joinOptions.isMuted}
        initialCameraOff={joinOptions.isCameraOff}
        initialNoiseReductionEnabled={joinOptions.noiseReductionEnabled}
        initialVirtualBackground={joinOptions.virtualBackground}
        initialAudioInputDeviceId={joinOptions.audioInputDeviceId}
        initialVideoInputDeviceId={joinOptions.videoInputDeviceId}
        initialAudioOutputDeviceId={joinOptions.audioOutputDeviceId}
        livekitToken={livekitToken || undefined}
        livekitUrl={livekitUrl || undefined}
        sessionCredential={sessionCredential || undefined}
        roomAccessToken={roomAccessToken || undefined}
        livekitRoomName={livekitRoomName || undefined}
        breakoutMode={breakoutMode || undefined}
        initialCurrentRoomId={currentBreakoutRoomId || undefined}
        onTransferred={handleTransferredToHome}
        roomId={meetingRoomId || undefined}
        roomSlug={slug}
      />
      </MeetingAccessBoundary>
    )
  },
})

const routeTree = rootRoute.addChildren([
  landingRoute,
  authRoute,
  passwordResetRoute,
  passwordResetTokenRoute,
  onboardingRoute,
  adminRoute,
  adminRoomRoute,
  adminSessionRoute,
  docsRoute,
  goodbyeRoute,
  lobbyRoute,
  handoffRoute,
  meetingRoute,
])

export const router = new Router({
  routeTree,
  defaultPreload: 'intent',
  defaultNotFoundComponent: () => <DeskError><Trans>Not Found</Trans></DeskError>,
  defaultErrorComponent: ({ error }) => <DeskError onRetry={() => window.location.reload()}>{toUserFacingError(error instanceof Error ? error.message : String(error))}</DeskError>,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Simple navigation adapter to reuse existing view APIs
const useNav = () => {
  const router = useRouter()
  return (view: AppView, param?: string) => {
    switch (view) {
      case AppView.LANDING:
        clearPersistedRoute()
        router.navigate({ to: '/' })
        break
      case AppView.AUTH:
        router.navigate({
          to: '/auth/$mode',
          params: { mode: param === 'register' ? 'register' : 'login' } as any,
        })
        break
      case AppView.PASSWORD_RESET:
        if (param) {
          router.navigate({ to: '/auth/reset/$token', params: { token: param } as any })
        } else {
          router.navigate({ to: '/auth/reset' })
        }
        break
      case AppView.ONBOARDING:
        router.navigate({ to: '/onboarding' })
        break
      case AppView.ADMIN:
        router.navigate({ to: '/admin' })
        break
      case AppView.DOCS:
        router.navigate({ to: '/docs' })
        break
      case AppView.LOBBY:
        router.navigate({ to: '/room/$slug', params: { slug: param || 'demo-room' } as any })
        break
      case AppView.MEETING:
        router.navigate({ to: '/meeting/$slug', params: { slug: param || 'demo-room' } as any })
        break
      default:
        router.navigate({ to: '/' })
    }
  }
}
