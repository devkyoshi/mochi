# Mascot

`<Mascot state="idle" size={96} badge={false} />` (`src/components/mascot/`). Currently drawn with SVG + CSS; it can be replaced by a Rive file without changing callers.

## States

| State | When | Look |
|---|---|---|
| `idle` | default | slow breathing, blinking |
| `curious` | cursor near | pupils follow the cursor (disabled with reduced motion) |
| `thinking` | a Claude request is running | blue bubble with pulsing dots |
| `happy` | a save succeeded | squish, closed smiling eyes, cheeks, sparkles |
| `alert` | stale VM / drift / secret / inbox stub | shake + amber glow |
| `sleepy` | idle for N minutes | half-closed eyes, dimmed, "z" |
| `new-change` | a file changed externally | hop + orange badge |

Callers only pass `state`. The dev switcher (`MascotDevPanel`, shown on the Home tab in dev builds) previews all states.

## Accessibility
- Root has `role="img"` and an `aria-label` per state.
- `prefers-reduced-motion`: all animation is disabled and eye tracking is off (`data-reduced-motion="true"`).

## Rive contract (for the future `.riv` file)

Create at rive.app one artboard `Mochi` with a state machine named `Mood` and these inputs:

| Input | Type | Meaning |
|---|---|---|
| `state` | Number | 0 idle, 1 curious, 2 thinking, 3 happy, 4 alert, 5 sleepy, 6 new-change |
| `lookX`, `lookY` | Number (-1..1) | pupil target, used in `curious` |
| `badge` | Boolean | show badge |
| `celebrate` | Trigger | one-shot happy burst |

Swap-in plan: keep `Mascot`'s props; replace the SVG body with `@rive-app/react-canvas` `useRive({ stateMachines: "Mood" })`, map `state` to the number input (order above = `MASCOT_STATES` order), and keep the SVG version as a fallback when the file fails to load.
