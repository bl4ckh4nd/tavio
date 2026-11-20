# Tavio

Tavio is a browser meeting product where rooms combine LiveKit media with Convex-owned collaboration, presence, access, and administration state.

## Language

**Room**:
A persisted Convex room that people can discover, join, configure, and use for collaboration.
_Avoid_: meeting room when referring to the durable record

**Room ID**:
The Convex `Id<"rooms">` that identifies a **Room** in durable state.
_Avoid_: string room id, slug id

**Room Slug**:
The mutable public URL segment used to find a **Room**.
_Avoid_: room id

**LiveKit Room Name**:
The identifier used by LiveKit for the realtime media room.
_Avoid_: assuming it is always the **Room Slug**

**Room Identity Contract**:
The resolved binding of **Room ID**, **Room Slug**, **LiveKit Room Name**, access mode, workspace, and caller role.
_Avoid_: ad hoc slug-to-id lookup

**Room Access Mode**:
The join mode of a **Room**: open, password-protected, or members-only.
_Avoid_: access string

**Room Access Policy**:
The server-side decision model for room discovery, token issuance, collaboration access, and management rights.
_Avoid_: local auth helper

**Workspace Membership**:
An organization-level relationship that grants workspace roles such as owner, admin, or member.
_Avoid_: room membership

**Room Membership**:
A room-level relationship that grants room roles such as host, admin, or participant.
_Avoid_: workspace membership

**Meeting Participant**:
Someone who has passed the room join flow and received a LiveKit identity for a meeting session.
_Avoid_: user when guest participants are included

**Presence Session**:
A single participant's live meeting session with freshness and ephemeral meeting signals.
_Avoid_: user presence

**Room Aggregate Presence**:
Derived room-level counts such as active participants and active hosts.
_Avoid_: source-of-truth attendance

**Host Presence Gate**:
The rule that an open room requires an active host or member before guests can join.
_Avoid_: activeHosts counter

**Shared Notes**:
A room-scoped HTML document shared by meeting participants.
_Avoid_: local notes

**Notes Lock**:
A host/admin-controlled edit gate for **Shared Notes**.
_Avoid_: client-only lock

**Whiteboard Snapshot**:
A room-scoped collection of drawable whiteboard elements.
_Avoid_: collaborative whiteboard state when no operation merge exists

**Whiteboard Commit**:
A completed local whiteboard gesture that should be persisted.
_Avoid_: every pointer move

**Collaboration Revision**:
A monotonic version for preventing stale full-state overwrites in shared collaboration data.
_Avoid_: timestamp as conflict control

**Chat Message Stream**:
Append-only room-scoped messages ordered by server timestamp.
_Avoid_: chat document

**Recording Lifecycle**:
The lifecycle of a room recording: starting, recording, completed, or failed.
_Avoid_: recording boolean

**Meeting Media Intent**:
The participant's selected media preferences for mute, camera, noise reduction, virtual background, and devices.
_Avoid_: LiveKit state

**Join Media Publish Policy**:
The one-time policy deciding which media tracks and constraints are sent to LiveKit on connect.
_Avoid_: runtime media command

**Runtime Media Command**:
An in-meeting command against LiveKit publication state, such as mute, camera toggle, screen share, audio restart, or device switch.
_Avoid_: media preference

**Virtual Background Intent**:
The selected background mode or value, independent of the processor engine that applies it.
_Avoid_: background processor

**Background Processor Engine**:
A concrete adapter that applies a virtual background, such as RVM, LiveKit MediaPipe, or canvas fallback.
_Avoid_: virtual background

**Room Configuration**:
Admin-owned room settings persisted in Convex.
_Avoid_: room form

**Room Config Draft**:
Client-side editable room configuration before Convex validates and persists it.
_Avoid_: room

**Room Branding**:
Partner-facing visual configuration for lobby and meeting surfaces.
_Avoid_: theme when referring to logo/background/source status

**Branding Asset**:
A stored or external image used by **Room Branding**.
_Avoid_: upload

**Logo Discovery**:
An asynchronous backend workflow that finds, stores, and applies a partner logo from a website.
_Avoid_: logo fetch

**Room Plan Limit**:
The billing-derived maximum number of rooms a workspace may create.
_Avoid_: modal limit

## Relationships

- A **Room** has exactly one **Room ID** and one current **Room Slug**.
- A **Room Identity Contract** binds one **Room** to one **LiveKit Room Name**.
- A **Room Access Policy** evaluates **Room Access Mode**, **Workspace Membership**, **Room Membership**, and **Presence Session** facts.
- A **Meeting Participant** has one or more **Presence Sessions** over time.
- **Room Aggregate Presence** is derived from active **Presence Sessions**.
- **Shared Notes**, **Whiteboard Snapshot**, **Chat Message Stream**, and **Recording Lifecycle** belong to exactly one **Room**.
- **Room Configuration** produces a server-persisted **Room** after a **Room Config Draft** is validated.
- **Room Branding** may reference zero or more **Branding Assets**.

## Example dialogue

> **Dev:** "Can a password-room guest use chat if they passed the join flow?"
> **Domain expert:** "Yes. Once they are a **Meeting Participant**, the **Room Access Policy** should grant the same collaboration access as other participants unless a separate room rule says otherwise."

## Flagged ambiguities

- `roomId` is currently used for both **Room ID** and arbitrary strings. Resolved language: **Room ID** means Convex `Id<"rooms">`; **Room Slug** means the public URL segment.
- `activeHosts` is currently both display state and access-control state. Resolved language: the access rule is the **Host Presence Gate**; counters are only **Room Aggregate Presence**.
- `user presence` currently mixes user identity and session freshness. Resolved language: freshness belongs to a **Presence Session**.
