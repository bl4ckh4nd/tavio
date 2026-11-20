# Design: Tavio

The locked system. Every Hallmark run reads this first and pages share it. Change it on purpose; the file is the rule.

**Status: in use.** Every screen is built on it. The system comes from the Coral landing page and extends it to Login, Lobby, Dashboard and Meeting.

## System
- Genre: modern-minimal
- Shape of the first page: app screen
- Theme: Coral
- Axes: light/grotesk-sans/warm · posture: restrained

## Grounds
Every screen sits on one of three grounds. The ground sets the control size.

| Ground | Token | Used for | Controls |
|---|---|---|---|
| Desk | `--color-desk` + `--tex-desk` | Login, Lobby, end of call | 48px |
| Paper | `--color-paper` | Dashboard, settings | 40px, 32px in rows |
| Board | `--color-board` | Meeting, watching a recording | 56px labelled tools |

- The Board stays dark in both modes, so faces read the same. Sheets on it (notes, chat) follow the mode.
- The whiteboard stays light in both modes (`--color-whiteboard`).
- Records are cotton sheets lit from the left (`--edge-stock`, `--cast-stock`). In dark mode textures and cast shadows drop out, and cards read lighter than the ground.

## Rules
- **Coral means saved.** It is spent on the pressed stamp "Saved in this room", link underlines and focus. Never as a fill, band or heading.
- **A running recording is not coral.** It is an outline tag on the Board with `circle-dot` and the word.
- **Status is an ink outline with a word.** No amber, violet, sky or emerald. Failed work is a status too.
- **Errors are not status.** Form and load errors use `--color-error` (hue 22), colder and darker than the stamp, and offer a next step.
- **One ink action per screen** (`--color-action`). Everything else is a card or ghost control. "New room" is a card in the top bar on every tab, so "Join" stays the ink action.
- **Room branding is bounded.** A room sets its logo, `--room-primary` on the join action, and a background image that replaces the desk. The stamp stays coral.
- **The record is the signature.** The room's record sits on the desk at the end of a call and appears as index cards in the Dashboard.

## Tokens
`src/styles/tokens.css` is the source of truth. The roles:
```css
:root {
  --color-paper: oklch(97% 0.006 55);  --color-desk: oklch(94.3% 0.008 64);  --color-cotton: oklch(98.8% 0.0045 80);
  --color-board: oklch(22% 0.011 40);  --color-board-type: oklch(96.5% 0.006 70);
  --color-ink: oklch(21% 0.012 38);  --color-print: oklch(23% 0.012 38);  --color-muted: oklch(47% 0.013 45);
  --color-rule: oklch(87% 0.009 55);  --color-action: oklch(21.6% 0.011 40);
  --color-paid: oklch(55.5% 0.15 33);  --color-accent-2: oklch(54% 0.165 29);  --color-focus: oklch(54% 0.17 30);
  --color-error: oklch(47% 0.18 22);  --color-success: oklch(50% 0.12 150);
  --font-display: "General Sans", ui-sans-serif, system-ui, sans-serif;  --font-outlier: "Geist Mono", ui-monospace, monospace;
  --radius-stock: 8px;  --radius-input: 6px;  --radius-tag: 4px;  --radius-groove: 10px;
}
```
The app scale runs at ratio 1.2 from 16px, with `--text-threshold` (2.986rem) for threshold screens only. The landing page keeps its fluid scale in the `.landing` block of `tokens.css`. Spacing, durations and layers live there too.

## Controls
- Primary: `--color-action` fill · 8px radius · height from the ground
- Secondary: letterpress card (`--color-cotton`, `--edge-stock`) · same radius and height
- Ghost: no fill · only for quiet row actions
- Danger: `--color-error-fill` · only inside a confirmation
- Inputs: 1px `--color-muted` border · 6px radius · `--color-focus` focus ring
- Selection: a card sitting in a groove (`--press-groove`)
- Coarse pointers: every hit area at least `--hit-target` (44px)

## Motion
- Character: still. Motion reports state and never decorates; under reduced motion everything ends at once.
- One exception: the landing page. It tells the page's idea, the record that stays, in five moves: the hero's records land on the desk and the head arrives word by word until the stamp presses; scrolling away, the call goes dark while the summary stays lit; the pile shifts a few pixels under a fine pointer; each proof is laid down as it comes into view; the deploy sheet types its commands.
- The rules for it: each move runs once and nothing loops; nothing blocks or takes over scrolling; only `transform`, `opacity` and `filter` animate; the full text is in the page from the start and nothing shifts the layout; content is never hidden unless a script is there to show it; under reduced motion everything is at its end state at once, and the pointer depth is off for touch.
- The app stays still. Nothing outside the landing page does any of this.

## Colour mode
- Light is the default. People choose in Profile with the Appearance groove; `src/hooks/useColorMode.ts` stores the choice, and `public/color-mode.js` sets `.dark` on `<html>` before the first paint.
- A room with `branding.theme: dark` puts `.dark` on the Lobby root only.
- The landing page stays light in both modes. So does the whiteboard, and the Board stays dark.

## Where it lives
`src/styles/tokens.css` is written for Tailwind v4. It uses `@theme static`, so every colour, font, radius and shadow is a utility (`bg-paper`, `text-ink`, `rounded-stock`) and still a CSS variable. `cotton.svg` and `felt.svg` sit next to it. The dark values hang on `.dark`.

`src/styles/system.css` holds the shared classes, and `src/components/ui.tsx` the React controls on top of them. `landing.css`, `dashboard.css`, `meeting.css` and `meeting-panels.css` add what one surface needs. All of these are imported into `layer(components)`, so a utility on the same element wins. `tokens.css` is not layered: token values, including media-query overrides, belong there, because an unlayered `:root` beats any layered rule.

## Fonts
- **Geist Mono** (OFL) is in the repo: `public/fonts/GeistMono-Regular.woff2` with its licence next to it.
- **General Sans** is not in the repo and must stay out. Its licence (ITF FFL 2.0) allows self-hosting for your own sites and apps, but not distribution through a repository or public server, and not subsetting or format conversion.
- `scripts/fetch-fonts.mjs` downloads the official kit into `public/fonts/`, which ignores those files. `npm run dev` and `npm run build` run it. If the download fails it warns, and the app falls back to the system stack.
- A built image contains the font. Keep images private, or fetch the font when the container starts, before making the image or the repository's packages public.
