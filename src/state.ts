export type Read = 'tone' | 'shape'
export type Direction = 'vertical' | 'horizontal'
export type Style = 'steps' | 'screen'
export type Edges = 'square' | 'sloped'
export type Mode = 'wave' | 'drift' | 'reveal' | 'blobs'

/** Everything the panel controls. Reset puts it back to these, except the canvas size. */
const DEFAULTS = {
  // Canvas: Fit fills the stage; otherwise it's drawn and saved at exactly width × height
  canvasFit: true,
  canvasW: 1080,
  canvasH: 1350,
  // Image: Tone reads dark areas as ink, Shape reads the opaque parts of a transparent PNG
  read: 'tone' as Read,
  invert: false,
  scale: 125,
  contrast: 63,
  // below 50 adds ink everywhere, above takes it away, so blank paper can be a mid tone
  brightness: 49,
  // Soften blurs the image first, so edges become ramps the lines taper along
  soften: 19,
  // Glow draws a rim of ink along every edge of the design, Glow Size wide
  glow: true,
  glowSize: 8,
  // Haze darkens the paper near the design and leaves open space light, so the lines vary over the
  // whole composition
  haze: 0,
  // Gap clears a band around the design (thin lines around heavy shapes), so it stays legible in the haze
  gap: 0,
  // Hollow thins the inside of each shape towards the paper, leaving outlines (beads, with Glow)
  hollow: 0,
  // Halftone: off shows the original image
  halftone: true,
  // Steps: pieces of one width each; Screen: each edge follows the image, like a printer's line screen
  style: 'steps' as Style,
  direction: 'vertical' as Direction,
  lines: 75,
  // the thickest line, and the thinnest, as a share of the space between lines
  weight: 54,
  hairline: 12,
  // how short the steps along each line are
  detail: 55,
  // how many line widths there are (0 = any width)
  levels: 8,
  edges: 'square' as Edges,
  // Motion
  motion: false,
  mode: 'blobs' as Mode,
  speed: 30,
  amount: 40,
  // Colour
  lineColour: '#d6d6d6',
  background: '#080f42',
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
  hollow: [0, 100],
  lines: [8, 300],
  weight: [5, 100],
  hairline: [0, 50],
  detail: [0, 100],
  levels: [0, 8],
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
  state.mode = pick<Mode>(['wave', 'drift', 'reveal', 'blobs'])
  state.amount = between(20, 80)
}
