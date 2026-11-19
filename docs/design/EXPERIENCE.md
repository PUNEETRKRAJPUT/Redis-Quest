# Redis Quest experience brief: "Night match"

The game is a fantasy cricket app that two roommates built in a hostel room, and every incident happens on a
match night. The interface is that night: a dark stadium under floodlights, read through a developer's tools.
It should feel like a game you are inside, never like an admin dashboard.

## Principles
1. **You feel your code.** State changes are shown, heard and animated the moment they happen: a key appears,
   a check turns green, the scoreboard flips.
2. **Clarity before flavour.** Instructions use plain words. Cricket is the costume, not the vocabulary: no
   instruction may need cricket knowledge to be understood. Flavour lives in secondary text, art and sound.
3. **One loud thing per screen.** Each screen has one focal element (the next match, the verdict, the terminal).
   Everything else is quiet.
4. **Fast hands.** Everything is reachable from the keyboard. Motion never blocks input.
5. **Honest state.** When the stack is down the UI says so in the fiction ("rain delay") and keeps working.

## Palette (dark only for now; `data-theme` is reserved for a later day theme)
| Token | Value | Use |
|---|---|---|
| `night-950` | `#070A12` | page background |
| `night-900` | `#0B1020` | base surface |
| `night-800` | `#111833` | raised surface, cards |
| `night-700` | `#1A2344` | hover, strong border |
| `night-600` | `#27325C` | hairlines, dividers |
| `chalk` | `#EEF2FA` | primary text |
| `chalk-dim` | `#A9B4CC` | secondary text |
| `chalk-faint` | `#6F7B97` | tertiary text, disabled |
| `flood-400` / `flood-500` / `flood-600` | `#FFB347` / `#FF9A1F` / `#E67E00` | the accent: floodlight amber. Primary actions, focus, XP |
| `on-flood` | `#1A1206` | text on the accent |
| `turf` | `#2EE281` | success, passed, live |
| `wicket` | `#FF5468` | failure, danger |
| `sky` | `#5CC8FF` | information, links, selection |
| `cap-purple` | `#B58CFF` | rare things: badges, streaks |
Never use Redis's own red or logo: the project must not imitate Redis's visual identity.
Backgrounds may carry soft radial "floodlight" glows (accent at 6 to 10 percent opacity) and a faint pitch grain.
Body text contrast is at least 4.5:1.

## Type
- **Display:** Barlow Condensed 600/700. Screen titles, scoreboard labels (uppercase, tracked), big numerals
  (tabular).
- **Body:** Inter Variable. Lesson text 16px/1.6, UI 14px.
- **Mono:** JetBrains Mono Variable. Terminal, code, keys, commands.
- Scale: 12, 13, 14, 16, 18, 22, 28, 40, 64. All fonts are self-hosted from npm packages; no font CDN.

## Motion
- Durations: `instant` 90ms, `fast` 150ms, `base` 220ms, `slow` 400ms, `celebrate` 900ms.
- Easing: `out` = `cubic-bezier(0.16, 1, 0.3, 1)`; springs for scoreboard flips and cards.
- Animate transform and opacity only. Lists stagger by 30ms, capped at 10 items.
- `prefers-reduced-motion` (or the in-game setting): no translate, scale, flip or confetti; fades of 150ms at most.

## Sound (synthesised with WebAudio, no audio files)
Off until the player turns it on (onboarding asks once; the HUD has a toggle). Cues: `tick` (tab or palette
move), `msg` (chat message arrives), `tock` (bat on ball: a level passes), `out` (a check fails), `flip`
(scoreboard digit), `roar` (chapter complete), `pager` (incident or dangerous command). Every cue is under
1.5 seconds and quiet by default.

## Signature moments
- **Scoreboard HUD.** The top bar is a scoreboard: player, rank, XP in flip digits, a stack-status light.
- **Rain delay.** When the engine or the socket is gone: a calm "Rain delay" strip with the exact command that
  brings the stack back, and "Play resumes" when it returns. Navigation keeps working.
- **Season map.** The home screen is the league season on a night campus: each chapter is a match-night
  fixture with its incident headline; each level is a ball in an over, marked by how it went.
- **Caps shelf.** Badges are collectible enamel caps with generated emblems, not a wall of text.
- **Live thread.** Chapter threads arrive like a real chat: avatars, typing dots, one message at a time, skippable.
- **Match view.** A level is one focused workbench: the brief, the workspace (terminal or editor), and the
  scoreboard of checks, in resizable panes.
- **Decision pending.** Checking your work plays like a third-umpire review: "Decision pending", then the
  verdict on the big screen. Plain words stay on the button ("Check my work").
- **Celebration.** A pass sweeps the floodlights, bursts confetti, flips the XP and plays `tock`.
- **Helpful terminal.** Command completion with argument hints read from the running Redis's own command docs;
  commands in lesson text are clickable chips.
- **Hands-on panels.** After a level is passed, and in the practice gallery, show-me panels can be manipulated
  directly and show the exact command they ran.

## Hard rules
- No emojis as icons. SVG icons only (lucide-react or `src/icons.tsx`).
- Visible focus rings (2px `sky`), hover and active states on every control, `cursor: pointer` on clickables.
- Every existing `data-testid`, role and label used by the tests keeps working.
- No request leaves the origin. No analytics, no CDN.
- Works at 1280x800 and up; nothing overflows at 1024 wide.
