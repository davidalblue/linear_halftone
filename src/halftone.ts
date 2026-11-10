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

type Frame = ReturnType<typeof turn>

/**
 * The lines' frame for a w × h canvas at `angle` degrees (0–360): lines run along (sin, cos) and
 * are spaced out along (cos, −sin), centred on the canvas. `across` × `along` is the turned area
 * that just covers the canvas, and `x`, `y` place a point (u across, v along) on the canvas.
 */
function turn(angle: number, w: number, h: number) {
  // exact at the quarter turns, so 0 (and 360) is the canvas's own x and y
  const quarter = { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] }[angle % 360]
  const sin = quarter ? quarter[0] : Math.sin((angle * Math.PI) / 180)
  const cos = quarter ? quarter[1] : Math.cos((angle * Math.PI) / 180)
  const upright = sin === 0 && cos === 1
  const across = w * Math.abs(cos) + h * Math.abs(sin)
  const along = w * Math.abs(sin) + h * Math.abs(cos)
  const u0 = across / 2
  const v0 = along / 2
  return {
    sin,
    cos,
    upright,
    across,
    along,
    x: (u: number, v: number) => (upright ? u : w / 2 + (u - u0) * cos + (v - v0) * sin),
    y: (u: number, v: number) => (upright ? v : h / 2 - (u - u0) * sin + (v - v0) * cos),
  }
}

/**
 * Bends `frame`'s lines by the Curve: every line shifts sideways by the same amount at each point
 * along it, so they stay evenly spaced. Where the bend happens is set by Margins (straight through
 * the middle, bending towards the ends), Even (one arc) or Middle (straight ends, a bulge in the
 * middle). At Curve 100 the most a line moves is a quarter of its length. `shift` is that most.
 */
function curve(frame: ReturnType<typeof turn>) {
  const most = (state.curve / 100) * frame.along * 0.25
  if (!most) return { ...frame, shift: 0 }
  const profile = {
    margins: (t: number) => Math.max(0, (Math.abs(2 * t - 1) - 0.3) / 0.7) ** 2,
    even: (t: number) => 4 * t * (1 - t),
    middle: (t: number) => (1 - Math.cos(Math.PI * 2 * t)) / 2,
  }[state.curveFrom]
  const sideways = (v: number) => most * profile(clamp(v / frame.along))
  return {
    ...frame,
    upright: false,
    shift: Math.abs(most),
    x: (u: number, v: number) => frame.x(u + sideways(v), v),
    y: (u: number, v: number) => frame.y(u + sideways(v), v),
  }
}

/** Traces every line's outline with `pen`. */
function trace(pen: Pen, w: number, h: number, time: number) {
  // u is across the lines and v along them. At Angle 0 they're the canvas's x and y; turning the
  // Angle turns the lines, and the u × v area grows to keep the whole canvas covered.
  const frame = curve(turn(state.angle, w, h))
  const { across, along } = frame
  const count = state.lines
  const space = across / count
  // curved lines shift sideways, so extra lines on each side keep the canvas's edges covered
  const extra = frame.shift ? Math.ceil(frame.shift / space) + 1 : 0
  const widest = space * (state.weight / 100)
  const thinnest = Math.min(widest, space * (state.hairline / 100))
  const contrast = 2 ** ((state.contrast - 50) / 20)
  const brightness = (50 - state.brightness) / 50
  const amount = state.motion ? state.amount / 100 : 0
  const map = inkMap({ read: state.read, soften: state.soften, glow: state.glow ? state.glowSize : 0, haze: state.haze > 0, gap: state.gap, subject: state.fragment > 0 || state.bloat > 0 })
  const haziness = state.haze / 100
  const start = (u: number, v: number) => pen.moveTo(frame.x(u, v), frame.y(u, v))
  const point = (u: number, v: number) => pen.lineTo(frame.x(u, v), frame.y(u, v))

  /** The tone, 0 to 1, where the image has `ink` (and `rim` from the glow, `haze` and `gap` from those). */
  const shade = (ink: number, rim: number, haze: number, gap: number) => {
    let t = clamp((ink - 0.5) * contrast + 0.5)
    if (state.invert) t = 1 - t
    t = clamp(t + brightness)
    // the haze and the glow's rim are always ink, even inverted
    t += haziness * haze * (1 - t)
    t += rim * (1 - t)
    // the Gap pushes the band around the design to the opposite of the design (thin lines around heavy
    // shapes, heavy around inverted ones), so the shapes stand clear of the haze and the rim's outer half
    return t + gap * ((state.invert ? 1 : 0) - t)
  }
  const look = reader(map, placement(w, h), frame)
  /** A line's width where the tone is `t`. */
  const width = (t: number, swell: number, shown: number, fade = 1, bulge = 0) => {
    // Wave and Blobs: heavier ink where they pass, mostly over the design so it stays legible
    if (swell) t = clamp(t + swell * (0.3 + 0.7 * t))
    t *= shown
    if (state.levels) t = Math.round(t * state.levels) / state.levels
    const base = thinnest + (widest - thinnest) * t
    // Bloat comes after the Levels so its shapes stay smooth instead of banding across neighbouring
    // lines. Swelling stops at 80% of the way to full weight, so slits remain and the lines still read
    // as lines; puckering pinches the line down, all the way at −1.
    const bloated = bulge >= 0 ? base + (widest - base) * 0.8 * bulge : base * (1 + bulge)
    // Fall's and Fragment's fade takes the whole line away, hairline too
    return bloated * fade
  }
  const blobs = state.mode === 'blobs' && amount ? blobsAt(time, w, h) : null
  /** How much Wave or Blobs thicken (or thin) the line at `centre` where it passes `v`. */
  const swellAt = (centre: number, v: number) => {
    if (!amount) return 0
    if (state.mode === 'wave') return amount * 0.5 * Math.sin(Math.PI * 2 * (time - (1.2 * centre) / across - (0.4 * v) / along))
    if (!blobs) return 0
    // inside a blob the lines swell; between blobs they're left as they are
    const x = frame.x(centre, v)
    const y = frame.y(centre, v)
    let field = 0
    for (const b of blobs) {
      const dx = x - b.x
      const dy = y - b.y
      field += Math.exp(-(dx * dx + dy * dy) * b.fade)
    }
    return amount * 0.8 * Math.min(1, field)
  }

  const cut = state.fragment ? fragments(state.fragment / 100, state.fragmentSeed, frame, space, Math.min(w, h)) : null
  const bloat = state.bloat / 100
  // how often Bloat looks along a line for where the design starts and stops
  const grain = Math.max(2, along / 1500)
  const reach = Math.min(w, h)
  /**
   * Bloat for the line at `centre`: along each stretch clear of the design, the line swells in some
   * places and puckers (pinches thinner) in others, following soft random shapes laid over the whole
   * canvas, so neighbouring lines swell and pinch together into forms. The shapes are sized by the
   * canvas, not the gap between lines, so they hold up with any number of lines. Near the design and
   * the canvas's edges each stretch eases back to its normal width, and stretches shorter than 14
   * gaps between lines change less, so small spaces like the holes in letters stay open. Returns, for
   * each point along the line, how far it's pushed: towards full weight (up to 1) or thinner (down to
   * −1, a full pinch).
   */
  const bulges = (centre: number, drift: number) => {
    const count = Math.ceil(along / grain) + 1
    const clear = new Uint8Array(count)
    const form = new Float32Array(count)
    for (let k = 0; k < count; k++) {
      const v = k * grain
      const x = frame.x(centre, v)
      const y = frame.y(centre, v)
      look.box(centre - space / 2, centre + space / 2, v + drift - grain / 2, v + drift + grain / 2)
      clear[k] = x >= 0 && x <= w && y >= 0 && y <= h && look.subject < 0.15 ? 1 : 0
      // swelling and pinching, −1 to 1, leaning a little towards swelling
      const hill = 0.65 * hills((x / reach) * 4, (y / reach) * 4, state.bloatSeed) + 0.35 * hills((x / reach) * 10, (y / reach) * 10, state.bloatSeed + 1)
      form[k] = Math.max(-1, Math.min(1, 0.15 + 2.6 * (hill - 0.5)))
    }
    // how far from a stretch's ends the line takes to ease into the shapes
    const ease = (reach * 0.06) / grain
    const push = new Float32Array(count)
    for (let a = 0; a < count; a++) {
      if (!clear[a]) continue
      let b = a
      while (b < count && clear[b]) b++
      const size = Math.min(1, ((b - a) * grain) / (space * 14))
      const easing = Math.min(ease, (b - a) / 2)
      for (let k = a; k < b; k++) push[k] = bloat * size * smooth(clamp(Math.min(k - a + 0.5, b - k - 0.5) / easing)) * form[k]
      a = b
    }
    return (v: number) => {
      const at = Math.min(count - 1, Math.max(0, v / grain))
      const k = Math.min(count - 2, Math.floor(at))
      return k < 0 ? push[0] : push[k] + (push[k + 1] - push[k]) * (at - k)
    }
  }

  const shape = state.style === 'screen' ? screenLine : stepLine
  for (let i = -extra; i < count + extra; i++) {
    const centre = (i + 0.5) * space
    // Drift slides what each line shows up and down, each line a little behind its neighbour
    const drift =
      state.mode === 'drift' && amount
        ? amount * along * 0.05 * (0.7 * Math.sin(Math.PI * 2 * time + i * 0.5) + 0.3 * Math.sin(Math.PI * 1.2 * time - i * 0.17))
        : 0
    const shown = state.mode === 'reveal' && state.motion ? reveal(time, count > 1 ? clamp(i / (count - 1)) : 0, amount) : 1
    const fadeAt = state.mode === 'fall' && state.motion ? fall(time, i, along, amount) : null
    const cutAt = cut ? (v: number) => cut(i, centre, v) : null
    const bulgeAt = bloat ? bulges(centre, drift) : null
    shape({ centre, drift, shown, fadeAt, cutAt, bulgeAt, curved: frame.shift > 0, space, along, look, shade, width, swellAt, start, point, pen })
  }
}

type Line = {
  centre: number
  drift: number
  shown: number
  /** Fall: how much of the line is left at `v` along it (1 = all of it), or null when not falling */
  fadeAt: ((v: number) => number) | null
  /** Fragment: how much of the line is cut away at `v` along it, wherever it's clear of the design */
  cutAt: ((v: number) => number) | null
  /** Bloat: how far the line swells (towards 1) or puckers (towards −1) at `v`, before Gap's band */
  bulgeAt: ((v: number) => number) | null
  /** whether the lines bend, so straight runs along them can't be drawn as one segment */
  curved: boolean
  space: number
  along: number
  look: ReturnType<typeof reader>
  shade(ink: number, rim: number, haze: number, gap: number): number
  width(t: number, swell: number, shown: number, fade?: number, bulge?: number): number
  swellAt(centre: number, v: number): number
  start(u: number, v: number): void
  point(u: number, v: number): void
  pen: Pen
}

/** Steps: the line in pieces, each as wide as the average ink over it. */
function stepLine({ centre, drift, shown, fadeAt, cutAt, bulgeAt, curved, space, along, look, shade, width, swellAt, start, point, pen }: Line) {
  // Detail 0 makes steps longer than the gap between lines; 100 makes them a tenth of it
  const step = Math.max(1, space * (1.6 - 1.5 * (state.detail / 100)))
  const steps = Math.ceil(along / step)
  const widths = new Float32Array(steps)
  let any = false
  for (let j = 0; j < steps; j++) {
    const v = j * step + drift
    const ink = look.box(centre - space / 2, centre + space / 2, v, v + step)
    let fade = fadeAt ? fadeAt((j + 0.5) * step) : 1
    if (cutAt) fade *= 1 - cutAt((j + 0.5) * step) * (1 - look.subject)
    // Bloat stays out of Gap's clear band around the design
    const bulge = bulgeAt ? bulgeAt((j + 0.5) * step) * (1 - look.gap) : 0
    widths[j] = width(shade(ink, look.rim, look.haze, look.gap), swellAt(centre, j * step), shown, fade, bulge)
    if (widths[j] > 0) any = true
  }
  if (!any) return

  // down the left side of the line, then back up the right
  const first = widths[0]
  const last = widths[steps - 1]
  start(centre - first / 2, 0)
  if (state.edges === 'square') {
    for (let j = 1; j < steps; j++) {
      if (widths[j] === widths[j - 1] && !curved) continue
      point(centre - widths[j - 1] / 2, j * step)
      point(centre - widths[j] / 2, j * step)
    }
    point(centre - last / 2, along)
    point(centre + last / 2, along)
    for (let j = steps - 1; j > 0; j--) {
      if (widths[j] === widths[j - 1] && !curved) continue
      point(centre + widths[j] / 2, j * step)
      point(centre + widths[j - 1] / 2, j * step)
    }
  } else {
    // Sloped: each step's width is reached at its middle, so changes ramp over one step
    const corner = (j: number) => curved || j === 0 || j === steps - 1 || widths[j] !== widths[j - 1] || widths[j] !== widths[j + 1]
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
function screenLine({ centre, drift, shown, fadeAt, cutAt, bulgeAt, curved, space, along, look, shade, width, swellAt, start, point, pen }: Line) {
  // points across the line, an odd number so one sits on its middle
  const across = Math.max(5, Math.min(25, Math.ceil(space / 0.75))) | 1
  const offsets = new Float32Array(across)
  for (let k = 0; k < across; k++) offsets[k] = -space / 2 + (k * space) / (across - 1)
  const room = new Float32Array(across)
  // a row every pixel or so
  const rowStep = Math.max(1, along / 3000)
  const rows = Math.ceil(along / rowStep) + 1
  const left = new Float32Array(rows)
  const right = new Float32Array(rows)
  // where the edge crosses between two points across
  const edge = (a: number, b: number) => offsets[a] + ((offsets[b] - offsets[a]) * room[a]) / (room[a] - room[b])
  let any = false

  for (let r = 0; r < rows; r++) {
    const v = Math.min(along, r * rowStep)
    const swell = swellAt(centre, v)
    const fade = fadeAt ? fadeAt(v) : 1
    const removed = cutAt ? cutAt(v) : 0
    const bulge = bulgeAt ? bulgeAt(v) : 0
    let first = -1
    let last = -1
    for (let k = 0; k < across; k++) {
      const ink = look.point(centre + offsets[k], v + drift)
      // how far inside the line this point is (negative: outside)
      const kept = removed ? fade * (1 - removed * (1 - look.subject)) : fade
      // Bloat stays out of Gap's clear band around the design
      room[k] = width(shade(ink, look.rim, look.haze, look.gap), swell, shown, kept, bulge * (1 - look.gap)) / 2 - Math.abs(offsets[k])
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
  // Liquid: each edge is smoothed along the line, up to a third of the gap between lines, so
  // pinches and joins flow in curves instead of stepping pixel by pixel while the design stays sharp
  const reach = Math.round(((state.liquid / 100) * space * 0.35) / rowStep)
  if (reach > 0) {
    smoothRun(left, reach)
    smoothRun(right, reach)
  }

  // down the left side of the line, then back up the right, skipping points along straight runs
  const at = (r: number) => Math.min(along, r * rowStep)
  const bend = (edges: Float32Array, r: number) => curved || r === 0 || r === rows - 1 || edges[r] !== edges[r - 1] || edges[r] !== edges[r + 1]
  start(centre + left[0], 0)
  for (let r = 1; r < rows; r++) if (bend(left, r)) point(centre + left[r], at(r))
  for (let r = rows - 1; r >= 0; r--) if (bend(right, r)) point(centre + right[r], at(r))
  pen.closePath()
}

/** Smooths `values` in place: two box blurs `r` either side, the ends held at their own value. */
function smoothRun(values: Float32Array, r: number) {
  const n = values.length
  const tmp = new Float32Array(n)
  const at = (src: Float32Array, i: number) => src[Math.min(n - 1, Math.max(0, i))]
  for (const [src, dst] of [
    [values, tmp],
    [tmp, values],
  ]) {
    let sum = 0
    for (let j = -r; j <= r; j++) sum += at(src, j)
    for (let i = 0; i < n; i++) {
      dst[i] = sum / (2 * r + 1)
      sum += at(src, i + r + 1) - at(src, i - r)
    }
  }
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

/** A repeatable random number from 0 to 1 for the whole numbers `a`, `b` and `seed`. */
function hash(a: number, b: number, seed: number) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(seed, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth random hills across a plane; nearby points get similar values. */
function hills(x: number, y: number, seed: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const top = hash(ix, iy, seed) * (1 - fx) + hash(ix + 1, iy, seed) * fx
  const bottom = hash(ix, iy + 1, seed) * (1 - fx) + hash(ix + 1, iy + 1, seed) * fx
  return top * (1 - fy) + bottom * fy
}

/**
 * Fragment: soft patches at random around the artboard. The further into a patch, the more of each
 * line is cut away, into shorter and rarer pieces with their own random lengths on every line, until
 * nothing is left. `amount` 1 clears everything. Returns how much of line `i` is cut at `v` (0 to 1);
 * the lines stay put from frame to frame, and the caller spares the design.
 */
function fragments(amount: number, seed: number, frame: Frame, space: number, size: number) {
  return (i: number, centre: number, v: number) => {
    const x = frame.x(centre, v) / size
    const y = frame.y(centre, v) / size
    const patch = clamp((0.65 * hills(x * 3.5, y * 3.5, seed) + 0.35 * hills(x * 9, y * 9, seed + 1) - 0.25) / 0.5)
    const depth = clamp((amount * 1.3 - patch) / 0.3)
    if (!depth) return 0
    const piece = space * (3 + 9 * hash(i, 0, seed + 2))
    const along = 0.7 * hills(i, v / piece, seed + 3) + 0.3 * hills(i, (v * 3) / piece, seed + 4)
    return 1 - smooth(clamp((clamp((along - 0.2) / 0.6) - depth) / 0.06))
  }
}

/** Fall: each line's own start and pace, picked at random when the page opens. */
const FALL_PATHS = Array.from({ length: 400 }, () => ({ start: Math.random(), pace: Math.random() }))

/**
 * Fall: a gap falls down line `i` like a falling star: the line disappears from the top down and
 * reappears behind the gap as it goes, then rests whole until the next one. Both ends of the gap
 * fade over a tail, so it reads as a streak. Amount 0 drops one gap across every line together;
 * 100 gives each line its own start and a pace up to a quarter faster or slower. Returns how much
 * of the line is left at `v` along it.
 */
function fall(time: number, i: number, along: number, amount: number) {
  const path = FALL_PATHS[((i % FALL_PATHS.length) + FALL_PATHS.length) % FALL_PATHS.length]
  const pace = 1 + amount * (path.pace - 0.5) * 0.5
  const phase = (((time * 0.5 * pace + amount * path.start) % 1) + 1) % 1
  // the gap falls for the first 60% of each turn; the line rests whole for the rest
  if (phase >= 0.6) return null
  const gap = along * 0.45
  const tail = along * 0.12
  // the gap's lower end starts a tail above the top and its upper end ends a tail below the bottom
  const lower = -tail + (phase / 0.6) * (along + gap + 2 * tail)
  const upper = lower - gap
  return (v: number) => Math.max(smooth(clamp((v - lower) / tail)), smooth(clamp((upper - v) / tail)))
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
 * box, `point` blends the nearest map pixels. Both leave the glow's rim there in `rim`, the haze in
 * `haze`, the gap in `gap` and the design's area in `subject`. Outside the image counts as blank paper.
 */
function reader(map: InkMap, at: { x: number; y: number; w: number; h: number }, frame: Frame) {
  const sx = map.w / at.w
  const sy = map.h / at.h
  const row = map.w + 1
  const look = {
    rim: 0,
    haze: 0,
    gap: 0,
    subject: 0,
    box(u0: number, u1: number, v0: number, v1: number) {
      let x0 = u0
      let x1 = u1
      let y0 = v0
      let y1 = v1
      if (!frame.upright) {
        // turned: an upright box of the same size around the same middle, its sides blended between
        // the turned box's width and length as the lines turn
        const cx = frame.x((u0 + u1) / 2, (v0 + v1) / 2)
        const cy = frame.y((u0 + u1) / 2, (v0 + v1) / 2)
        const c2 = frame.cos * frame.cos
        const s2 = frame.sin * frame.sin
        const bw = (u1 - u0) * c2 + (v1 - v0) * s2
        const bh = (u1 - u0) * s2 + (v1 - v0) * c2
        x0 = cx - bw / 2
        x1 = cx + bw / 2
        y0 = cy - bh / 2
        y1 = cy + bh / 2
      }
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
      look.subject = 0
      if (a === b || c === d) return 0
      const total = (s: Float64Array) => (s[d * row + b] - s[c * row + b] - s[d * row + a] + s[c * row + a]) / area
      if (map.rimSums) look.rim = total(map.rimSums)
      if (map.hazeSums) look.haze = total(map.hazeSums)
      if (map.gapSums) look.gap = total(map.gapSums)
      if (map.subjectSums) look.subject = total(map.subjectSums)
      return total(map.inkSums)
    },
    point(u: number, v: number) {
      const mx = (frame.x(u, v) - at.x) * sx - 0.5
      const my = (frame.y(u, v) - at.y) * sy - 0.5
      const x0 = Math.floor(mx)
      const y0 = Math.floor(my)
      const fx = mx - x0
      const fy = my - y0
      look.rim = map.rim ? blend(map.rim, x0, y0, fx, fy) : 0
      look.haze = map.haze ? blend(map.haze, x0, y0, fx, fy) : 0
      look.gap = map.gap ? blend(map.gap, x0, y0, fx, fy) : 0
      look.subject = map.subject ? blend(map.subject, x0, y0, fx, fy) : 0
      return blend(map.ink, x0, y0, fx, fy)
    },
  }
  const get = (values: Float32Array, x: number, y: number) => (x < 0 || y < 0 || x >= map.w || y >= map.h ? 0 : values[y * map.w + x])
  const blend = (values: Float32Array, x: number, y: number, fx: number, fy: number) =>
    (get(values, x, y) * (1 - fx) + get(values, x + 1, y) * fx) * (1 - fy) + (get(values, x, y + 1) * (1 - fx) + get(values, x + 1, y + 1) * fx) * fy
  return look
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (x: number) => x * x * (3 - 2 * x)
