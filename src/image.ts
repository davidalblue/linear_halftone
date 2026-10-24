// The image being halftoned: kept as a canvas to draw (the original view), and as a map of its ink,
// softened and with a glow, haze and gap if asked, which the lines read from.
import type { Read } from './state'

/** Longest side of the copy that's drawn as the original. */
const DRAW_SIZE = 2048
/** Longest side of the ink map the lines are read from. */
const MAP_SIZE = 1200

export const picture = {
  /** the uploaded file's name, or '' for the starting sphere */
  name: '',
  source: sphere(),
}

/** Loads an image file (PNG, JPG, SVG…), replacing the current one. */
export async function loadImage(file: File) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    // an SVG without its own size reports 0 × 0, so it gets a square
    const w = img.naturalWidth || 1000
    const h = img.naturalHeight || 1000
    const fit = Math.min(1, DRAW_SIZE / Math.max(w, h))
    // vectors are drawn at the full size rather than their own (often tiny) one
    const grow = file.type === 'image/svg+xml' ? DRAW_SIZE / Math.max(w, h) : fit
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * grow))
    c.height = Math.max(1, Math.round(h * grow))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    picture.source = c
    picture.name = file.name
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Whether a good part of the image is see-through, as with a logo on a transparent PNG. */
export function isCutOut() {
  const { data } = pixels()
  let clear = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) clear++
  return clear > (data.length / 4) * 0.05
}

/** The image's pixels at the map's size. */
function pixels() {
  const src = picture.source
  const fit = Math.min(1, MAP_SIZE / Math.max(src.width, src.height))
  const w = Math.max(1, Math.round(src.width * fit))
  const h = Math.max(1, Math.round(src.height * fit))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, w, h)
  return { w, h, data: ctx.getImageData(0, 0, w, h).data }
}

/**
 * How the map is made. Soften blurs the ink; Glow (0 = off) draws a rim along every edge of the
 * shapes, as wide as its value; Haze spreads a wide shadow of the design over the paper around it;
 * Gap (0 = off) clears a band around the design, as wide as its value.
 */
export type MapSettings = { read: Read; soften: number; glow: number; haze: boolean; gap: number }

/**
 * The ink, 0 to 1, of each map pixel (`ink`), of the glow's rim (`rim`, or null without Glow) and
 * of the haze (`haze`, or null without it) and of the gap's band (`gap`, or null without it), each
 * with a summed-area table so any box of the map can be averaged at once.
 */
export type InkMap = {
  w: number
  h: number
  ink: Float32Array
  inkSums: Float64Array
  rim: Float32Array | null
  rimSums: Float64Array | null
  haze: Float32Array | null
  hazeSums: Float64Array | null
  gap: Float32Array | null
  gapSums: Float64Array | null
}

let raw = { source: null as HTMLCanvasElement | null, read: '' as Read | '', w: 0, h: 0, ink: new Float32Array(0) }
let map: InkMap | null = null
let mapKey = ''

/** The ink map for these settings; rebuilt only when they or the image change. */
export function inkMap(settings: MapSettings) {
  const { read, soften, glow, haze: hazy, gap: gapSize } = settings
  const key = `${read} ${soften} ${glow} ${hazy} ${gapSize}`
  if (map && raw.source === picture.source && mapKey === key) return map

  // Tone is how dark each pixel is over white paper, Shape is how opaque
  if (raw.source !== picture.source || raw.read !== read) {
    const { w, h, data } = pixels()
    const ink = new Float32Array(w * h)
    for (let i = 0; i < ink.length; i++) {
      const alpha = data[i * 4 + 3] / 255
      const lum = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255
      ink[i] = read === 'shape' ? alpha : alpha * (1 - lum)
    }
    raw = { source: picture.source, read, w, h, ink }
  }

  const { w, h } = raw
  const longest = Math.max(w, h)
  // Soften 100 blurs by 4% of the image's longest side
  const ink = soften ? blur(raw.ink, w, h, Math.round((soften / 100) * 0.04 * longest)) : raw.ink
  let rim: Float32Array | null = null
  if (glow) {
    // the rim is darkest exactly on an edge, where the blurred shape is half ink, and fades either side
    const spread = blur(raw.ink, w, h, Math.max(1, Math.round((0.002 + (glow / 100) * 0.03) * longest)))
    rim = spread.map((b) => 1 - Math.abs(2 * b - 1))
  }
  let haze: Float32Array | null = null
  if (hazy) {
    // a wide blur of the design: heaviest right next to it, fading into open space. It's scaled so
    // the densest part reaches 1, kept off the design itself so that stays clear, and faded out
    // towards the image's sides so they don't show as a frame.
    const reach = Math.round(0.03 * longest)
    const shadow = blur(raw.ink, w, h, reach)
    let most = 0
    for (const v of shadow) most = Math.max(most, v)
    haze = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const side = Math.min(1, Math.min(x, y, w - 1 - x, h - 1 - y) / (reach * 2))
        haze[i] = (most ? shadow[i] / most : 0) * (1 - ink[i]) * side * side * (3 - 2 * side)
      }
    }
  }
  let gap: Float32Array | null = null
  if (gapSize) {
    // a band hugging the outside of the design's true (unsoftened) edges, fading out over its width
    const near = blur(raw.ink, w, h, Math.max(1, Math.round((0.003 + (gapSize / 100) * 0.017) * longest)))
    gap = near.map((v, i) => Math.min(1, v * 2.5) * (1 - raw.ink[i]))
  }
  map = {
    w,
    h,
    ink,
    inkSums: sums(ink, w, h),
    rim,
    rimSums: rim && sums(rim, w, h),
    haze,
    hazeSums: haze && sums(haze, w, h),
    gap,
    gapSums: gap && sums(gap, w, h),
  }
  mapKey = key
  return map
}

/** A summed-area table: entry (x, y) of the (w+1)-wide table is the total above and left of (x, y). */
function sums(values: Float32Array, w: number, h: number) {
  const table = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += values[y * w + x]
      table[(y + 1) * (w + 1) + x + 1] = table[y * (w + 1) + x + 1] + row
    }
  }
  return table
}

/** A blur close to a Gaussian of about `r` px: three box blurs each way. Outside counts as paper. */
function blur(values: Float32Array, w: number, h: number, r: number) {
  if (r < 1) return values
  const out = Float32Array.from(values)
  const tmp = new Float32Array(values.length)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) box(out, tmp, y * w, 1, w, r)
    for (let x = 0; x < w; x++) box(tmp, out, x, w, h, r)
  }
  return out
}

/** Averages `length` values from `start`, `step` apart, over a window of r either side. */
function box(src: Float32Array, dst: Float32Array, start: number, step: number, length: number, r: number) {
  const size = 2 * r + 1
  let sum = 0
  for (let i = 0; i <= Math.min(r, length - 1); i++) sum += src[start + i * step]
  for (let i = 0; i < length; i++) {
    dst[start + i * step] = sum / size
    if (i + r + 1 < length) sum += src[start + (i + r + 1) * step]
    if (i - r >= 0) sum -= src[start + (i - r) * step]
  }
}

/** The starting image: a lit sphere, which shows the whole range of tones. */
function sphere() {
  const size = 1200
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const r = size * 0.46
  const light = ctx.createRadialGradient(size * 0.36, size * 0.32, 0, size * 0.42, size * 0.42, r * 1.25)
  light.addColorStop(0, '#ffffff')
  light.addColorStop(0.45, '#8a8a8a')
  light.addColorStop(1, '#000000')
  ctx.fillStyle = light
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2)
  ctx.fill()
  return c
}
