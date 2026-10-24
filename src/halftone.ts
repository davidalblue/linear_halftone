// The linear halftone: evenly spaced lines whose width follows the ink of the image underneath.
// Steps cuts each line into short pieces of one width each; Screen follows the image pixel by
// pixel, each edge of a line on its own, like a printer's line screen. Each line is one filled
// outline, so the canvas and the SVG draw the same shapes.
import { inkMap, picture, type InkMap } from './image'
import { state } from './state'

/** Where outlines are drawn: a canvas context, or the SVG writer below. */
type Pen = { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void }

/** Where the image sits on a w × h canvas: fitted inside it, centred, at the Scale. */
export function placement(w: number, h: number) {
  const src = picture.source
  const fit = Math.min(w / src.width, h / src.height) * (state.scale / 100)
  const iw = src.width * fit
  const ih = src.height * fit
  return { x: (w - iw) / 2, y: (h - ih) / 2, w: iw, h: ih }
}

/** Draws the image as it is, for comparing with the halftone. */
export function drawOriginal(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const at = placement(w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(picture.source, at.x, at.y, at.w, at.h)
}

export function drawHalftone(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  ctx.fillStyle = state.lineColour
  ctx.beginPath()
  trace(ctx, w, h, time)
  ctx.fill()
}

/** The halftone as an SVG: a background and one path per line. */
export function halftoneSvg(w: number, h: number, time: number) {
  const paths: string[] = []
  const n = (v: number) => String(Math.round(v * 100) / 100)
  trace(
    {
      moveTo: (x, y) => paths.push(`M${n(x)} ${n(y)}`),
      lineTo: (x, y) => (paths[paths.length - 1] += `L${n(x)} ${n(y)}`),
      closePath: () => (paths[paths.length - 1] += 'Z'),
    },
    w,
    h,
    time,
  )
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect id="background" width="${w}" height="${h}" fill="${state.background}"/>`,
    `<g id="lines" fill="${state.lineColour}">`,
    ...paths.map((d) => `<path d="${d}"/>`),
    '</g>',
    '</svg>',
  ].join('\n')
}

/** Traces every line's outline with `pen`. */
function trace(pen: Pen, w: number, h: number, time: number) {
  const vertical = state.direction === 'vertical'
  // lines run along one side of the canvas and are spaced out across the other
  const across = vertical ? w : h
  const along = vertical ? h : w
  const count = state.lines
  const space = across / count
  const widest = space * (state.weight / 100)
  const thinnest = Math.min(widest, space * (state.hairline / 100))
  const contrast = 2 ** ((state.contrast - 50) / 20)
  const brightness = (50 - state.brightness) / 50
  const amount = state.motion ? state.amount / 100 : 0
  const map = inkMap({ read: state.read, soften: state.soften, glow: state.glow ? state.glowSize : 0, haze: state.haze > 0, gap: state.gap, hollow: state.hollow > 0 })
  const haziness = state.haze / 100
  const hollowness = state.hollow / 100
  // u is across the lines, v along them
  const start = vertical ? (u: number, v: number) => pen.moveTo(u, v) : (u: number, v: number) => pen.moveTo(v, u)
  const point = vertical ? (u: number, v: number) => pen.lineTo(u, v) : (u: number, v: number) => pen.lineTo(v, u)

  /** The tone of blank paper (no ink), before any haze, worked out as `shade` does below. */
  const blank = clamp(0.5 - 0.5 * contrast)
  const paper = clamp((state.invert ? 1 - blank : blank) + brightness)
  /**
   * The tone, 0 to 1, where the image has `ink` (and `rim` from the glow, `haze` and `gap` from those,
   * and `inside` the inside of a shape, for Hollow).
   */
  const shade = (ink: number, rim: number, haze: number, gap: number, inside: number) => {
    let t = clamp((ink - 0.5) * contrast + 0.5)
    if (state.invert) t = 1 - t
    t = clamp(t + brightness)
    // the haze and the glow's rim are always ink, even inverted
    t += haziness * haze * (1 - t)
    // Hollow: the inside of each shape turns towards blank paper (clearing any haze that reached it),
    // leaving an outline at its edge
    t += hollowness * inside * (paper - t)
    t += rim * (1 - t)
    // the Gap pushes the band around the design to the opposite of the design (thin lines around heavy
    // shapes, heavy around inverted ones), so the shapes stand clear of the haze and the rim's outer half
    return t + gap * ((state.invert ? 1 : 0) - t)
  }
  // Screen reads the tone at every point, so it's worked out once for the whole map
  const tones = state.style === 'screen' ? toneMap(map, `${contrast} ${brightness} ${haziness} ${hollowness} ${state.invert}`, shade) : null
  const look = reader(map, placement(w, h), vertical, tones)
  /** A line's width where the tone is `t`. */
  const width = (t: number, swell: number, shown: number) => {
    // Wave and Blobs: heavier ink where they pass, mostly over the design so it stays legible
    if (swell) t = clamp(t + swell * (0.3 + 0.7 * t))
    t *= shown
    if (state.levels) t = Math.round(t * state.levels) / state.levels
    return thinnest + (widest - thinnest) * t
  }
  const blobs = state.mode === 'blobs' && amount ? blobsAt(time, w, h) : null
  /** How much Wave or Blobs thicken (or thin) the line at `centre` where it passes `v`. */
  const swellAt = (centre: number, v: number) => {
    if (!amount) return 0
    if (state.mode === 'wave') return amount * 0.5 * Math.sin(Math.PI * 2 * (time - (1.2 * centre) / across - (0.4 * v) / along))
    if (!blobs) return 0
    // inside a blob the lines swell; between blobs they're left as they are
    const x = vertical ? centre : v
    const y = vertical ? v : centre
    let field = 0
    for (const b of blobs) {
      const dx = x - b.x
      const dy = y - b.y
      field += Math.exp(-(dx * dx + dy * dy) * b.fade)
    }
    return amount * 0.8 * Math.min(1, field)
  }

  const shape = state.style === 'screen' ? screenLine : stepLine
  for (let i = 0; i < count; i++) {
    const centre = (i + 0.5) * space
    // Drift slides what each line shows up and down, each line a little behind its neighbour
    const drift =
      state.mode === 'drift' && amount
        ? amount * along * 0.05 * (0.7 * Math.sin(Math.PI * 2 * time + i * 0.5) + 0.3 * Math.sin(Math.PI * 1.2 * time - i * 0.17))
        : 0
    const shown = state.mode === 'reveal' && state.motion ? reveal(time, count > 1 ? i / (count - 1) : 0, amount) : 1
    shape({ centre, drift, shown, space, along, look, shade, width, swellAt, start, point, pen })
  }
}

type Line = {
  centre: number
  drift: number
  shown: number
  space: number
  along: number
  look: ReturnType<typeof reader>
  shade(ink: number, rim: number, haze: number, gap: number, inside: number): number
  width(t: number, swell: number, shown: number): number
  swellAt(centre: number, v: number): number
  start(u: number, v: number): void
  point(u: number, v: number): void
  pen: Pen
}

/** Steps: the line in pieces, each as wide as the average ink over it. */
function stepLine({ centre, drift, shown, space, along, look, shade, width, swellAt, start, point, pen }: Line) {
  // Detail 0 makes steps longer than the gap between lines; 100 makes them a tenth of it
  const step = Math.max(1, space * (1.6 - 1.5 * (state.detail / 100)))
  const steps = Math.ceil(along / step)
  const widths = new Float32Array(steps)
  let any = false
  for (let j = 0; j < steps; j++) {
    const v = j * step + drift
    const ink = look.box(centre - space / 2, centre + space / 2, v, v + step)
    widths[j] = width(shade(ink, look.rim, look.haze, look.gap, look.inside), swellAt(centre, j * step), shown)
    if (widths[j] > 0) any = true
  }
  if (!any) return

  // down the left side of the line, then back up the right
  const first = widths[0]
  const last = widths[steps - 1]
  start(centre - first / 2, 0)
  if (state.edges === 'square') {
    for (let j = 1; j < steps; j++) {
      if (widths[j] === widths[j - 1]) continue
      point(centre - widths[j - 1] / 2, j * step)
      point(centre - widths[j] / 2, j * step)
    }
    point(centre - last / 2, along)
    point(centre + last / 2, along)
    for (let j = steps - 1; j > 0; j--) {
      if (widths[j] === widths[j - 1]) continue
      point(centre + widths[j] / 2, j * step)
      point(centre + widths[j - 1] / 2, j * step)
    }
  } else {
    // Sloped: each step's width is reached at its middle, so changes ramp over one step
    const corner = (j: number) => j === 0 || j === steps - 1 || widths[j] !== widths[j - 1] || widths[j] !== widths[j + 1]
    for (let j = 0; j < steps; j++) if (corner(j)) point(centre - widths[j] / 2, (j + 0.5) * step)
    point(centre - last / 2, along)
    point(centre + last / 2, along)
    for (let j = steps - 1; j >= 0; j--) if (corner(j)) point(centre + widths[j] / 2, (j + 0.5) * step)
  }
  point(centre + first / 2, 0)
  pen.closePath()
}

/**
 * Screen: like a printer's line screen. Every row across the line, each point is ink if it's
 * nearer the line's middle than half the width the image asks for right there. The line runs from
 * the first such point to the last, so each edge follows the image on its own: an edge of the
 * design can cut through a line, and lines taper to points as they thin out.
 */
function screenLine({ centre, drift, shown, space, along, look, width, swellAt, start, point, pen }: Line) {
  // points across the line, an odd number so one sits on its middle; the edge between two points is
  // found by interpolating, so they can be over a pixel apart
  const across = Math.max(5, Math.min(17, Math.ceil(space / 1.2))) | 1
  const offsets = new Float32Array(across)
  for (let k = 0; k < across; k++) offsets[k] = -space / 2 + (k * space) / (across - 1)
  const room = new Float32Array(across)
  // a row every pixel and a half; the edges are drawn straight between rows
  const rowStep = Math.max(1.5, along / 3000)
  const rows = Math.ceil(along / rowStep) + 1
  const left = new Float32Array(rows)
  const right = new Float32Array(rows)
  // where the edge crosses between two points across
  const edge = (a: number, b: number) => offsets[a] + ((offsets[b] - offsets[a]) * room[a]) / (room[a] - room[b])
  let any = false

  for (let r = 0; r < rows; r++) {
    const v = Math.min(along, r * rowStep)
    const swell = swellAt(centre, v)
    let first = -1
    let last = -1
    for (let k = 0; k < across; k++) {
      // how far inside the line this point is (negative: outside)
      room[k] = width(look.tone(centre + offsets[k], v + drift), swell, shown) / 2 - Math.abs(offsets[k])
      if (room[k] >= 0) {
        if (first < 0) first = k
        last = k
      }
    }
    if (first < 0) {
      // no ink: the line closes to nothing at its middle
      left[r] = right[r] = 0
      continue
    }
    left[r] = first > 0 ? edge(first - 1, first) : offsets[0]
    right[r] = last < across - 1 ? edge(last + 1, last) : offsets[across - 1]
    if (right[r] > left[r]) any = true
  }
  if (!any) return

  // down the left side of the line, then back up the right, skipping points along straight runs
  const at = (r: number) => Math.min(along, r * rowStep)
  const bend = (edges: Float32Array, r: number) => r === 0 || r === rows - 1 || edges[r] !== edges[r - 1] || edges[r] !== edges[r + 1]
  start(centre + left[0], 0)
  for (let r = 1; r < rows; r++) if (bend(left, r)) point(centre + left[r], at(r))
  for (let r = rows - 1; r >= 0; r--) if (bend(right, r)) point(centre + right[r], at(r))
  pen.closePath()
}

/**
 * Blobs: soft round patches, each wandering the canvas on its own path, two sine waves each way
 * with frequencies and phases picked at random when the page opens.
 */
const BLOB_PATHS = Array.from({ length: 5 }, () => {
  const r = () => Math.random()
  return {
    x: [1.2 + r() * 1.8, 0.5 + r() * 1.2, r() * Math.PI * 2, r() * Math.PI * 2],
    y: [1.2 + r() * 1.8, 0.5 + r() * 1.2, r() * Math.PI * 2, r() * Math.PI * 2],
    // each blob's size, as a share of the canvas's shorter side, and how fast it breathes
    size: 0.1 + r() * 0.12,
    pulse: [0.8 + r() * 1.2, r() * Math.PI * 2],
  }
})

/** Where each blob is at `time` on a w × h canvas, and how quickly it fades from its middle. */
function blobsAt(time: number, w: number, h: number) {
  const wander = ([f1, f2, p1, p2]: number[]) => 0.5 + 0.48 * (0.65 * Math.sin(time * f1 + p1) + 0.35 * Math.sin(time * f2 + p2))
  return BLOB_PATHS.map((b) => {
    const radius = b.size * Math.min(w, h) * (1 + 0.25 * Math.sin(time * b.pulse[0] + b.pulse[1]))
    return { x: wander(b.x) * w, y: wander(b.y) * h, fade: 1 / (2 * radius * radius) }
  })
}

/**
 * Reveal: the lines fill in one after another, hold, empty out in the same order, and rest.
 * `at` is the line's place from first (0) to last (1); Amount staggers them.
 */
function reveal(time: number, at: number, amount: number) {
  const phase = (((time / 2) % 1) + 1) % 1
  const grow = (x: number) => {
    const stagger = amount * 0.8
    return smooth(clamp((x - at * stagger) / (1 - stagger)))
  }
  if (phase < 0.35) return grow(phase / 0.35)
  if (phase < 0.5) return 1
  if (phase < 0.85) return 1 - grow((phase - 0.5) / 0.35)
  return 0
}

/**
 * Reads the ink map at places on the canvas, given across and along the lines: `box` averages a
 * box, leaving the glow's rim there in `rim`, the haze in `haze`, the gap in `gap` and the
 * inside of shapes in `inside`; `tone` blends the nearest
 * pixels of the tone map. Outside the
 * image counts as blank paper.
 */
function reader(map: InkMap, at: { x: number; y: number; w: number; h: number }, vertical: boolean, tones: Tones | null) {
  const sx = map.w / at.w
  const sy = map.h / at.h
  const row = map.w + 1
  const look = {
    rim: 0,
    haze: 0,
    gap: 0,
    inside: 0,
    box(u0: number, u1: number, v0: number, v1: number) {
      const [x0, x1, y0, y1] = vertical ? [u0, u1, v0, v1] : [v0, v1, u0, u1]
      // the box in map pixels, at least one pixel each way
      let a = Math.round((x0 - at.x) * sx)
      let b = Math.round((x1 - at.x) * sx)
      let c = Math.round((y0 - at.y) * sy)
      let d = Math.round((y1 - at.y) * sy)
      if (b <= a) b = a + 1
      if (d <= c) d = c + 1
      const area = (b - a) * (d - c)
      a = Math.max(0, Math.min(map.w, a))
      b = Math.max(0, Math.min(map.w, b))
      c = Math.max(0, Math.min(map.h, c))
      d = Math.max(0, Math.min(map.h, d))
      look.rim = 0
      look.haze = 0
      look.gap = 0
      look.inside = 0
      if (a === b || c === d) return 0
      const total = (s: Float64Array) => (s[d * row + b] - s[c * row + b] - s[d * row + a] + s[c * row + a]) / area
      if (map.rimSums) look.rim = total(map.rimSums)
      if (map.hazeSums) look.haze = total(map.hazeSums)
      if (map.gapSums) look.gap = total(map.gapSums)
      if (map.insideSums) look.inside = total(map.insideSums)
      return total(map.inkSums)
    },
    tone(u: number, v: number) {
      if (!tones) return 0
      const mx = ((vertical ? u : v) - at.x) * sx - 0.5
      const my = ((vertical ? v : u) - at.y) * sy - 0.5
      const x = Math.floor(mx)
      const y = Math.floor(my)
      const fx = mx - x
      const fy = my - y
      const t = tones.values
      // inside the map, the four pixels around the point are blended directly
      if (x >= 0 && y >= 0 && x + 1 < map.w && y + 1 < map.h) {
        const i = y * map.w + x
        return (t[i] * (1 - fx) + t[i + 1] * fx) * (1 - fy) + (t[i + map.w] * (1 - fx) + t[i + map.w + 1] * fx) * fy
      }
      const get = (px: number, py: number) => (px < 0 || py < 0 || px >= map.w || py >= map.h ? tones.outside : t[py * map.w + px])
      return (get(x, y) * (1 - fx) + get(x + 1, y) * fx) * (1 - fy) + (get(x, y + 1) * (1 - fx) + get(x + 1, y + 1) * fx) * fy
    },
  }
  return look
}

/** The tone at every pixel of the ink map, and of the paper outside it. */
type Tones = { map: InkMap | null; key: string; values: Float32Array; outside: number }
let tones: Tones = { map: null, key: '', values: new Float32Array(0), outside: 0 }

/** The tone map for `map` shaded with `shade`; rebuilt only when the map or the shading (`key`) changes. */
function toneMap(map: InkMap, key: string, shade: (ink: number, rim: number, haze: number, gap: number, inside: number) => number) {
  if (tones.map === map && tones.key === key) return tones
  const values = new Float32Array(map.w * map.h)
  for (let i = 0; i < values.length; i++) values[i] = shade(map.ink[i], map.rim ? map.rim[i] : 0, map.haze ? map.haze[i] : 0, map.gap ? map.gap[i] : 0, map.inside ? map.inside[i] : 0)
  tones = { map, key, values, outside: shade(0, 0, 0, 0, 0) }
  return tones
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (x: number) => x * x * (3 - 2 * x)
