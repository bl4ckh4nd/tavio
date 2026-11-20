# End-to-end tests

## Cloud/public layout

With the normal Convex environment from `.env.local`, run the public layout
suite (no account or local containers required):

```sh
npm run e2e -- --project=layout
```

The authenticated Chromium project additionally needs `E2E_EMAIL` and
`E2E_PASSWORD` for a test account. Playwright starts Vite on `E2E_PORT`
(default `3333`).

Lobby and meeting specs expect a password room named `meeting` with password
`123456`, unless `E2E_ROOM_SLUG` and `E2E_ROOM_PASSWORD` are set.

## Local self-hosted stack

Rootless Podman Compose or Docker Compose is required. Run setup first, then
run the layout project against the local services:

```sh
npm run e2e:local:up && npm run e2e:local
```

Setup starts Convex and LiveKit, waits for `http://127.0.0.1:3210/`, deploys the
functions, and seeds the password-protected `meeting` room (`123456`). The
local test command uses Vite port `3334` and maps Convex URLs to the browser.
The first setup run writes `.env.e2e-local` (self-hosted URL and admin key); it
is ignored by git and reused on subsequent runs.

Stop the containers with:

```sh
npm run e2e:local:down
```

## Landing page shots

The product shots in `public/landing/`, `public/landing/de/` and
`public/threshold/board-canvas.webp` are taken from the running app. After a
visible change to the lobby, the meeting, the whiteboard or the end of a call,
take them again on an empty local stack. ImageMagick is required.

```sh
npm run e2e:local:down
podman volume rm "$(basename "$PWD")_convex-data"  # the room must not exist yet
npm run e2e:local:up && npm run shots:landing
```

The script runs one call with seven people and refuses a non-local Convex URL.
The raw screenshots and `report.json` (revision, sizes, hashes) land in
`test-results/landing-shots/`. If a picture changes shape, update its `width`
and `height` in `src/views/Landing.tsx`; `tests/e2e/landing.spec.ts` checks them.
The call's length is written into the picture as 18:42 and the link's host as
`tavio.app`.

## Environment knobs

| Variable | Purpose |
| --- | --- |
| `E2E_PORT` | Playwright/Vite port; defaults to `3333` (local script uses `3334`). |
| `E2E_CONVEX_URL` | Web-server `VITE_CONVEX_URL` override. |
| `E2E_CONVEX_SITE_URL` | Web-server `VITE_CONVEX_SITE_URL` override. |
| `E2E_EMAIL`, `E2E_PASSWORD` | Credentials for the authenticated Chromium project. |
| `E2E_ROOM_SLUG` | Room slug for lobby/meeting tests; defaults to `meeting`. |
| `E2E_ROOM_PASSWORD` | Password for that room; defaults to `123456`. |

Convex rate limits stay enabled in E2E. In particular, all guests of a room
share one LiveKit token allowance of 30 requests per minute, so repeated runs
against the same room may need to wait for the limiter window. Room creation is
limited to five per hour per signed-in user.

The chat journey in `media.spec.ts` (`two people chat`) uploads one image as a
guest. All guests of a room share one image allowance (five at once, then one
every six minutes), so more than about five runs in a row against the same room
fail at the upload with "Too many images for now". It needs the chat functions
on the target deployment; screenshots and `report.json` land in
`test-results/chat/`.

The whiteboard's browser test is the Playwright project `board`
(`tests/e2e/whiteboard.spec.ts`, local stack, command at the head of the file).
Repeat it only with `--workers=1`: parallel runs draw over each other in the
same room. It pastes an image, which counts against the room's guest upload
limit; reset it locally with
`npx convex run --component rateLimiter lib:resetRateLimit '{"name":"chatUploadGuests","key":"guests:<roomId>"}' --env-file .env.e2e-local`.

The meeting assistant's browser test is the Playwright project `assistant`
(`tests/e2e/assistant.spec.ts`). It needs the local stack and a running worker;
see the head of that file.
