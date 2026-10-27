# Termwise design system — neo-brutalism, light & dark

Loud structure, calm content. Thick ink borders, hard offset shadows, flat saturated color blocks,
chunky type — but every screen shows only what matters today. Students open this app stressed;
the style is bold, the information density is low.

All tokens live in `src/theme/` and are read through `useTheme()`. Screens never hard-code colors,
fonts, border widths, or shadows. Mode follows the system setting, with an in-app override
(System / Light / Dark) in Settings, persisted locally.

## Color tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FFF4DE` (warm paper) | `#141414` | Screen background |
| `surface` | `#FFFFFF` | `#1F1F1F` | Cards, inputs, sheets |
| `surfaceAlt` | `#FFE9B8` | `#2A2A2A` | Inset panels, selected rows |
| `ink` | `#111111` | `#F4F1EA` | Text, borders, hard shadows |
| `inkMuted` | `#4A4A4A` | `#B9B4A9` | Secondary text |
| `inkInverse` | `#FFFFFF` | `#111111` | Text on `ink` fills |
| `border` | `#111111` | `#F4F1EA` | All borders |
| `shadow` | `#111111` | `#000000` | Hard shadow color (dark mode pairs it with a light border) |
| `primary` | `#5B5BD6` | `#8B8BFF` | Primary buttons, active tab, links |
| `onPrimary` | `#FFFFFF` | `#111111` | Text on primary |
| `yellow` | `#FFD23F` | `#FFD23F` | Highlights, "busy" |
| `pink` | `#FF6B9D` | `#FF7EAA` | Accents |
| `blue` | `#4D96FF` | `#6AA8FF` | Info |
| `green` | `#3DDC97` | `#46E3A0` | Success, "calm" |
| `orange` | `#FF8A3D` | `#FF9A55` | Warnings, "heavy" |
| `red` | `#FF4747` | `#FF5C5C` | Danger, red zone |
| `purple` | `#9B5DE5` | `#B07CFF` | Accents |

Accent fills always carry `ink` text (`#111111`) in **both** modes. Bright fills with dark text keep
contrast ≥ 4.5:1, and that is the look.

**Stress levels:** calm = `green`, busy = `yellow`, heavy = `orange`, red = `red`. A red-zone surface
also gets a diagonal-stripe or ⚠ badge so color is never the only signal.

**Course colors:** `courseColors = [blue, pink, yellow, green, orange, purple, '#00C2C7', '#C6F432']`,
assigned in order when a course is created; the student can change one.

## Shape & depth

- Border width: `2` hairline (dividers, chips), `3` standard (cards, buttons, inputs).
- Radius: `0` for tags/date stamps, `8` buttons/inputs, `12` cards, `999` pills.
- Hard shadow (no blur): offsets `sm = 2`, `md = 4`, `lg = 6`. Use the RN `boxShadow` style
  (`'4px 4px 0px 0px <shadow>'`). In dark mode keep the black shadow; the light `border` carries the edge.
- **Press:** a pressable with a shadow translates by its shadow offset (x and y) and drops the shadow
  while pressed, so it "clicks into" the page. Plus a light haptic (`expo-haptics`) on primary actions.
- Disabled: 45% opacity, no shadow, no press motion.

## Type

- Display / headings: **Archivo Black** (`@expo-google-fonts/archivo-black`), uppercase allowed for small labels.
- Body / UI: **Space Grotesk** 400 / 500 / 700 (`@expo-google-fonts/space-grotesk`).
- Numbers that matter (stress score, grade %, minutes) use Archivo Black at large size.
- Scale (size/line-height): `display 34/38`, `h1 28/32`, `h2 22/26`, `h3 18/22`, `body 16/22`, `small 14/20`, `tiny 12/16`.
- Respect Dynamic Type: allow font scaling (`maxFontSizeMultiplier` 1.4 on dense rows).

## Spacing

4-pt grid: `xs 4`, `sm 8`, `md 12`, `lg 16`, `xl 24`, `xxl 32`. Screen gutters 16. Cards pad 16.
Generous gaps between cards (16) so the shadows read.

## Components (`src/components/ui/`)

`Screen` (safe area + bg + optional large title header), `NBText` (variants above), `Card`
(surface, 3px border, md shadow, optional `color` fill, optional `onPress` with press motion),
`Button` (variants: primary, secondary = surface, danger, ghost; sizes sm/md/lg; loading state),
`IconButton`, `TextField` (label, error, multiline), `Chip`/`Tag` (toggleable), `Badge`,
`StressPill` (level + score), `CourseDot`/`CourseTag`, `ProgressBar` (bordered, chunky fill),
`SegmentedControl`, `Toggle`, `ListRow` (title, subtitle, right accessory, chevron),
`SectionHeader`, `EmptyState` (big emoji-free illustration block + message + action),
`LoadingBlock` (bordered skeleton), `ErrorBanner`, `Sheet` (modal card), `DateField` / `TimeField`
(wrap `@react-native-community/datetimepicker`), `Stepper` (− value +), `Toast` (top, bordered).
Icons: `expo-symbols` (SF Symbols) on iOS with a text fallback.

## Motion

Short and mechanical: 120 ms press, 180 ms enter. No springs or blur. Honor Reduce Motion (skip the press translate).

## Accessibility

Every pressable has `accessibilityRole` and a label; targets ≥ 44×44; never color-only state; dark
mode passes contrast for `inkMuted` on `bg` and `surface`; VoiceOver reads stress as "Stress 82, red zone".
