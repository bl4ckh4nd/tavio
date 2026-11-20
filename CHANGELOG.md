# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com), and versions follow [Semantic Versioning](https://semver.org).

## Unreleased

## 0.1.0 - 2026-11-20

First public release: video meetings with lobby and access control, shared notes, a collaborative whiteboard with facilitation tools, chat, breakout rooms, recording with transcripts, an optional voice assistant, and an admin area. Licensed under the FSL-1.1-ALv2. The [README](README.md) lists the features. The entries below are the last changes before this release.

- A REST API under `/v1/` with workspace API keys (Settings → API): rooms (create, list, get, delete), a room's sessions, and recordings with signed download links and transcripts. Keys are stored only as hashes, limited to 120 requests a minute per key, and documented at `/docs`.

- Cleared the interface review blockers with accessible control names and target sizes, stronger action contrast, responsive meeting and docs layouts, a confirmed breakout-session ending flow, keyboard-safe onboarding, locale-aware bootstrap feedback, and a working meeting invite action.

### Security & room access
- Password rooms now protect all room data, not just the LiveKit token: chat, notes, whiteboard, presence, breakouts, and recordings require a join grant (`roomAccessGrants`) or membership. Changing the password or switching a room to password access revokes existing grants.
- Presence can no longer be faked or deleted for another user, and `rooms.validatePassword` and `memberships.ensureHostForFirstMemberAtomic` are no longer public.
- Signed-in users outside a workspace join its open and password rooms as guests instead of being rejected, and never become host.
- "End for all" now keeps non-hosts out for 15 minutes unless a host rejoins, and invalidates session credentials, device handoffs, and grants from before the end.

- Each session after "End for all" runs under a new LiveKit room name, so tokens from the ended session cannot reach it.
- Guests now need a join grant in open rooms too, chat senders are always taken from the server, and only room managers can change the host count.
- Guests whose access is revoked during a meeting see a notice with a way back to the lobby instead of an error page.
- Join errors reach the lobby in production instead of being redacted.
- The Docker media stack (`docker-compose.deploy.yml`) runs LiveKit 1.13.11, which refuses TCP relays over TURN and relays to its own host only on media ports. Redis requires `REDIS_PASSWORD`, and `TURN_PEER_CIDR` has no default any more, because everyone in a call can relay to that network.
- The meeting assistant leaves on its own after 20 minutes without a command and after 2 hours at most (`ASSISTANT_IDLE_MINUTES`, `ASSISTANT_MAX_MINUTES`), so a room left open does not keep paying for speech-to-text.
- Guests count against a LiveKit token allowance of their room (30 a minute) instead of one allowance shared by every guest of the deployment, so a busy room no longer turns away guests elsewhere. Guest chat messages, reactions and board comments, signed in or not, also count against their room together (120 a minute), not only per guest.
- The assistant refuses an addition, and undo a restore, that would push a board past 10,000 elements.
- HTML pages someone stores but never puts on a board make room after an hour once a room's 50 pages are full, so they cannot block new pages.

### Dependencies
- Updated all dependencies to their latest versions, including React 19.3, Vite 8, TypeScript 7, Lingui 6, and Vitest 5, and moved Docker and CI to Node 24. Better Auth moved to 1.7 with `@convex-dev/better-auth` 0.13, which closes the 1.6 advisories (none of them reached Tavio, which does not use the affected plugins). The TypeScript check now runs with `strictNullChecks`, which Better Auth 1.7's types need.

### Meetings & local stack
- Participants who disconnect without leaving disappear from presence after 90 seconds instead of 5 minutes.
- The German catalog now uses formal address throughout.
- The local stack exposes LiveKit to the Convex container, so "End for all" works locally.

### Accessibility & interaction
- Replaced the clickable `div` navigation and checklist controls in `views/Auth.tsx`, `views/Lobby.tsx`, and `components/OnboardingChecklist.tsx` with native buttons, so keyboard activation, `aria-expanded`, and focus indicators come from the platform instead of custom handlers.
- Enlarged primary icon controls to a 44x44 hit area while keeping the glyphs visually small: meeting header buttons, whiteboard toolbar, drawer close, room actions menu, toast dismiss, panel close, chat send, participant actions, and the onboarding checklist header.
- Gave whiteboard toolbar buttons `aria-label`/`aria-pressed` and one `ToolbarButton`/`SwatchButton` implementation instead of repeated inline class strings.

### Motion
- Shipped an explicit entry-motion system in `index.css` (`entry-fade`, `entry-rise`, `entry-rise-sm`, `entry-drift-right`, `entry-pop`, `entry-pop-check`, `entry-drawer`) backed by the `ease-standard` token. The `animate-in` / `fade-in` / `slide-in-*` / `zoom-in-*` classes used across the views were never installed, so those entrances previously did not animate at all.
- Removed every `transition-all` declaration from active UI (54 at audit time) in favour of explicit property lists, and disabled those transitions under `prefers-reduced-motion: reduce`.
- Removed endless decorative and status looping: the landing hero ring no longer floats, recording/live/breakout status dots keep a static colour and label, the route spinner no longer pulses, and the connection overlay icon no longer pulses. The goodbye view's glow, shimmer, and particle motion now run once instead of forever.
- Moved the onboarding spotlight to a single transform-based transition; width and height are static, so stepping through the tour no longer animates layout or paint.
- Guarded the LiveKit grid, carousel, FAQ accordion, and skeleton shimmer under reduced motion, and replaced constant-click `active:scale` with pointer-only press feedback so keyboard activation is not animated.
- Replaced `active:scale-95`/`hover:scale-105` on the lobby device toggles with the shared 0.97 press response and reduced-motion-safe hover scaling.

### Feedback
- Reworked `components/ToastProvider.tsx`: expiry pauses while the document is hidden or the toast is hovered/focused and resumes with the remaining time, entry and exit are interruptible transform/opacity states with a faster exit, errors announce as `role="alert"` and everything else as `role="status"`, and dismissal is a real 44x44 button.
- Standardised press feedback on one-off controls (checklist rows, toast dismiss, meeting header, whiteboard tool, panel close, chat send, participant actions) to the same 0.97 press response used by the shared `Button`.

### Meetings
- Made microphone, camera, and screen-share toggles optimistic and guarded in `views/meeting/LKControls.tsx`: local state flips immediately so the tap is acknowledged, the control locks until the provider call settles, repeat taps during flight are dropped, and a rejection restores the LiveKit-reported track state and surfaces an alert. Double-clicks no longer issue a second provider call through the stale mirrored value.
- Added `disabled` support to the shared `ControlBtn`.

### Onboarding tour
- The tour now scrolls the target into view, waits for scrolling to settle, and re-measures, instead of measuring before scrolling and then following stale coordinates.
- Tooltip placement is computed from the measured tooltip bounds with flip-and-clamp fallbacks, so it can no longer leave the viewport; the entrance is transform/opacity based and anchored to the highlighted target.

### Copy
- Named the results of the landing CTAs: "Get Started" is now "Create a workspace" and "Explore the product" is now "See the meeting workspace". Catalogs extracted and compiled for en, de, es, and fr.
