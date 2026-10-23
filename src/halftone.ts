// The linear halftone: evenly spaced lines whose width follows the ink of the image underneath,
// in steps along each line. Each line is one filled outline, so the canvas and the SVG draw the
// same shapes.
import { inkMap, picture } from './image'
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
  // Detail 0 makes steps longer than the gap between lines; 100 makes them a tenth of it
  const step = Math.max(1, space * (1.6 - 1.5 * (state.detail / 100)))
  const steps = Math.ceil(along / step)
  const contrast = 2 ** ((state.contrast - 50) / 20)
  const amount = state.motion ? state.amount / 100 : 0
  const ink = sampler(w, h, vertical)
  const widths = new Float32Array(steps)
  // u is across the lines, v along them
  const start = vertical ? (u: number, v: number) => pen.moveTo(u, v) : (u: number, v: number) => pen.moveTo(v, u)
  const point = vertical ? (u: number, v: number) => pen.lineTo(u, v) : (u: number, v: number) => pen.lineTo(v, u)

  for (let i = 0; i < count; i++) {
    const centre = (i + 0.5) * space
    // Drift slides what each line shows up and down, each line a little behind its neighbour
    const drift =
      state.mode === 'drift' && amount
        ? amount * along * 0.05 * (0.7 * Math.sin(Math.PI * 2 * time + i * 0.5) + 0.3 * Math.sin(Math.PI * 1.2 * time - i * 0.17))
        : 0
    const shown = state.mode === 'reveal' && state.motion ? reveal(time, count > 1 ? i / (count - 1) : 0, amount) : 1
    let any = false
    for (let j = 0; j < steps; j++) {
      const v = j * step + drift
      let t = ink(centre - space / 2, centre + space / 2, v, v + step)
      t = clamp((t - 0.5) * contrast + 0.5)
      if (state.invert) t = 1 - t
      // Wave: a band of heavier ink sweeps across the lines, mostly over the design so it stays legible
      if (state.mode === 'wave' && amount) {
        const swell = Math.sin(Math.PI * 2 * (time - (1.2 * centre) / across - (0.4 * j * step) / along))
        t = clamp(t + amount * 0.5 * swell * (0.3 + 0.7 * t))
      }
      t *= shown
      if (state.levels) t = Math.round(t * state.levels) / state.levels
      widths[j] = thinnest + (widest - thinnest) * t
      if (widths[j] > 0) any = true
    }
    if (!any) continue

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
 * Returns how much ink, 0 to 1, lies in a box of the canvas. The box is given across and along the
 * lines; outside the image counts as blank paper.
 */
function sampler(w: number, h: number, vertical: boolean) {
  const map = inkMap(state.read)
  const at = placement(w, h)
  const sx = map.w / at.w
  const sy = map.h / at.h
  const row = map.w + 1
  return (u0: number, u1: number, v0: number, v1: number) => {
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
    if (a === b || c === d) return 0
    const s = map.sum
    return (s[d * row + b] - s[c * row + b] - s[d * row + a] + s[c * row + a]) / area
  }
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (x: number) => x * x * (3 - 2 * x)
