// The image being halftoned: kept as a canvas to draw (the original view), and as a summed-area
// table of its ink so any box of it can be averaged in constant time.
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

let map = { w: 0, h: 0, sum: new Float64Array(0), read: '' as Read | '', source: null as HTMLCanvasElement | null }

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
  const { data } = ink()
  let clear = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) clear++
  return clear > (data.length / 4) * 0.05
}

/** The image's pixels at the map's size. */
function ink() {
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
 * The ink map for `read`: Tone is how dark each pixel is over white paper, Shape is how opaque.
 * Rebuilt only when the image or the reading changes.
 */
export function inkMap(read: Read) {
  if (map.source === picture.source && map.read === read) return map
  const { w, h, data } = ink()
  // sum[(y)(w+1) + x] is the total ink above and left of pixel (x, y)
  const sum = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const alpha = data[i + 3] / 255
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
      row += read === 'shape' ? alpha : alpha * (1 - lum)
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row
    }
  }
  map = { w, h, sum, read, source: picture.source }
  return map
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
