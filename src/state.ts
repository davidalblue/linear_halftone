export type Read = 'tone' | 'shape'
export type Style = 'steps' | 'screen'
export type Edges = 'square' | 'sloped'
export type CurveFrom = 'margins' | 'even' | 'middle'
export type Mode = 'wave' | 'drift' | 'reveal' | 'blobs' | 'fall'

/** Everything the panel controls. Reset puts it back to these, except the canvas size. */
const DEFAULTS = {
  // Canvas: Fit fills the stage; otherwise it's drawn and saved at exactly width × height
  canvasFit: false,
  canvasW: 700,
  canvasH: 1000,
  // Image: Tone reads dark areas as ink, Shape reads the opaque parts of a transparent PNG
  read: 'tone' as Read,
  invert: false,
  scale: 100,
  contrast: 80,
  // below 50 adds ink everywhere, above takes it away, so blank paper can be a mid tone
  brightness: 85,
  // Soften blurs the image first, so edges become ramps the lines taper along
  soften: 13,
  // Glow draws a rim of ink along every edge of the design, Glow Size wide
  glow: true,
  glowSize: 10,
  // Haze darkens the paper near the design and leaves open space light, so the lines vary over the
  // whole composition
  haze: 0,
  // Gap clears a band around the design (thin lines around heavy shapes), so it stays legible in the haze
  gap: 100,
  // Halftone: off shows the original image
  halftone: true,
  // Steps: pieces of one width each; Screen: each edge follows the image, like a printer's line screen
  style: 'screen' as Style,
  // Angle: the lines turn all the way round, upright at 0 and flat at 90; the image stays put
  angle: 105,
  // Curve bends the lines (not the image), either way; Curve From sets where along them the bend is
  curve: -83,
  curveFrom: 'even' as CurveFrom,
  // Fragment breaks up and removes lines in random patches, wherever they're clear of the design;
  // a new seed moves the patches
  fragment: 30,
  fragmentSeed: 1,
  // Bloat swells and puckers the lines where they're clear of the design, in random shapes across the
  // canvas, easing back to normal where they meet it; a new seed reshapes them
  bloat: 88,
  bloatSeed: 1,
  lines: 123,
  // the thickest line, and the thinnest, as a share of the space between lines
  weight: 100,
  hairline: 9,
  // how short the steps along each line are
  detail: 96,
  // how many line widths there are (0 = any width)
  levels: 8,
  // Screen only: how much each line's edges are smoothed, so its pinches and joins flow
  liquid: 100,
  edges: 'square' as Edges,
  // Motion
  motion: false,
  mode: 'fall' as Mode,
  speed: 30,
  amount: 40,
  // Colour
  lineColour: '#000000',
  background: '#ffffff',
}

export type State = typeof DEFAULTS
export type NumberKey = { [K in keyof State]: State[K] extends number ? K : never }[keyof State]

/** Each number's range: the slider's ends. */
export const RANGES: Record<NumberKey, [number, number]> = {
  canvasW: [100, 6000],
  canvasH: [100, 6000],
  scale: [10, 200],
  contrast: [0, 100],
  brightness: [0, 100],
  soften: [0, 100],
  glowSize: [0, 100],
  haze: [0, 100],
  gap: [0, 100],
  lines: [8, 300],
  weight: [5, 100],
  hairline: [0, 50],
  detail: [0, 100],
  levels: [0, 8],
  angle: [0, 360],
  curve: [-100, 100],
  fragment: [0, 100],
  fragmentSeed: [0, 1e9],
  bloat: [0, 100],
  bloatSeed: [0, 1e9],
  liquid: [0, 100],
  speed: [0, 100],
  amount: [0, 100],
}

export const state: State = { ...DEFAULTS }

/** Whether time is running. Kept out of the state so Reset doesn't change it. */
export const clock = { playing: true, time: 0 }

/** Ready-made canvas sizes, in px. */
export const CANVAS_PRESETS: Record<string, [number, number]> = {
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
}

/**
 * Saved looks: every setting at once, canvas size included. Preset 1 is the starting look; Preset 2
 * is the one before it (grey background, straight upright lines, no Bloat).
 */
export const PRESETS: State[] = [
  { ...DEFAULTS },
  {
    ...DEFAULTS,
    brightness: 54,
    soften: 39,
    glowSize: 9,
    angle: 0,
    curve: 0,
    bloat: 0,
    lines: 125,
    hairline: 24,
    background: '#606060',
  },
]

/** Switches every setting to preset `i`. */
export function usePreset(i: number) {
  Object.assign(state, PRESETS[i])
}

/** Whether every setting matches preset `i`. */
export const isPreset = (i: number) => (Object.keys(PRESETS[i]) as (keyof State)[]).every((key) => state[key] === PRESETS[i][key])

/** Puts the controls back, keeping the canvas size and how the image is read. */
export function reset() {
  const { canvasFit, canvasW, canvasH, read } = state
  Object.assign(state, DEFAULTS, { canvasFit, canvasW, canvasH, read })
}

/** A new random line screen and motion; the image, canvas and colours stay. */
export function randomize() {
  const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]
  const between = (min: number, max: number) => Math.round(min + Math.random() * (max - min))
  state.lines = between(30, 160)
  state.weight = between(60, 100)
  state.hairline = Math.random() < 0.2 ? 0 : between(5, 25)
  state.detail = between(20, 90)
  state.levels = Math.random() < 0.25 ? 0 : between(2, 6)
  state.edges = pick<Edges>(['square', 'sloped'])
  state.mode = pick<Mode>(['wave', 'drift', 'reveal', 'blobs', 'fall'])
  state.amount = between(20, 80)
}
