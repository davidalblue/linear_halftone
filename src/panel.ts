import { isCutOut, loadImage, picture } from './image'
import { CANVAS_PRESETS, clock, isPreset, PRESETS, randomize, RANGES, reset, state, usePreset, type CurveFrom, type Edges, type InsideEdges, type InsideShapes, type Mode, type NumberKey, type Read, type Style } from './state'
import { $, addSync, button, choice, colour, hint, numberField, onPanelChange, slider, syncPanel, toggle, type Bind } from './ui'

/** Binds a slider to a number in the state, over its range. */
const num = (label: string, key: NumberKey, when: () => boolean = () => true, off = 'Off', format?: (v: number) => string) => {
  const bind: Bind<number> = { get: () => state[key], set: (v) => (state[key] = v) }
  return slider(label, bind, () => (when() ? RANGES[key] : null), off, format)
}

/** What the export buttons do; main.ts owns the canvas, so it supplies these. */
export type Actions = {
  savePng(): void
  saveSvg(): void
  record(): void
  isRecording(): boolean
}

/** Halftones an image file, reading a transparent PNG by its shape. */
export async function useImage(file: File) {
  if (!file.type.startsWith('image/')) {
    hint('That isn’t an image', true)
    return
  }
  try {
    await loadImage(file)
  } catch {
    hint('Couldn’t open that image', true)
    return
  }
  state.read = isCutOut() ? 'shape' : 'tone'
  syncPanel()
}

/** Wires the controls in index.html to the state. */
export function initPanel(actions: Actions) {
  onPanelChange(() => {})

  // Image
  const file = $<HTMLInputElement>('#image-file')
  button($('#upload'), () => file.click())
  file.addEventListener('change', () => {
    const picked = file.files?.[0]
    file.value = ''
    if (picked) useImage(picked)
  })
  addSync(() => ($('#image-note').textContent = picture.name || 'Or drop an image on the canvas'))
  const reads: { value: Read; label: string }[] = [
    { value: 'tone', label: 'Tone' },
    { value: 'shape', label: 'Shape' },
  ]
  choice($('#read'), reads, { get: () => state.read, set: (v) => (state.read = v) })
  toggle($('#invert'), { get: () => state.invert, set: (v) => (state.invert = v) })
  toggle($('#glow'), { get: () => state.glow, set: (v) => (state.glow = v) })
  $('#image-sliders').append(
    num('Scale', 'scale'),
    num('Contrast', 'contrast'),
    num('Brightness', 'brightness'),
    num('Soften', 'soften'),
    num('Glow', 'glowSize', () => state.glow),
    num('Haze', 'haze'),
    num('Gap', 'gap'),
  )

  // Halftone: switching it off shows the original image
  toggle($('#halftone-switch'), { get: () => state.halftone, set: (v) => (state.halftone = v) })
  const styles: { value: Style; label: string }[] = [
    { value: 'steps', label: 'Steps' },
    { value: 'screen', label: 'Screen' },
  ]
  choice($('#style'), styles, { get: () => state.style, set: (v) => (state.style = v) })
  $('#line-sliders').append(
    num('Lines', 'lines'),
    num('Weight', 'weight'),
    num('Hairline', 'hairline'),
    // Screen follows the image every pixel, so it has no steps to size
    num('Detail', 'detail', () => state.style === 'steps', 'Fine'),
    num('Levels', 'levels', undefined, undefined, (v) => (v ? String(v) : 'Any')),
    // Liquid smooths Screen's edges; Steps has its own (Square or Sloped)
    num('Liquid', 'liquid', () => state.style === 'screen', '–'),
  )
  const edges: { value: Edges; label: string }[] = [
    { value: 'square', label: 'Square' },
    { value: 'sloped', label: 'Sloped' },
  ]
  choice($('#edges'), edges, { get: () => state.edges, set: (v) => (state.edges = v) })
  addSync(() => $('#edges').querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = state.style === 'screen')))

  // Angle: Vertical and Horizontal are 0 and 90
  choice(
    $('#direction'),
    [
      { value: '0', label: 'Vertical' },
      { value: '90', label: 'Horizontal' },
    ],
    { get: () => String(state.angle), set: (v) => (state.angle = Number(v)) },
  )
  $('#angle-sliders').append(num('Angle', 'angle', undefined, undefined, (v) => `${v}°`))

  // Curve: how much the lines bend, and where along them
  $('#curve-sliders').append(num('Curve', 'curve'))
  const curveFroms: { value: CurveFrom; label: string }[] = [
    { value: 'margins', label: 'Margins' },
    { value: 'even', label: 'Even' },
    { value: 'middle', label: 'Middle' },
  ]
  choice($('#curve-from'), curveFroms, { get: () => state.curveFrom, set: (v) => (state.curveFrom = v) })

  // Fragment: how much of the lines clear of the design breaks up, and Shuffle to move the patches
  $('#fragment-sliders').append(num('Fragment', 'fragment'))
  const shuffle = button($('#fragment-shuffle'), () => (state.fragmentSeed = Math.floor(Math.random() * 1e9)))
  addSync(() => ((shuffle as HTMLButtonElement).disabled = !state.fragment))

  // Bloat: how much the lines swell and pucker clear of the design and on it, and Shuffle to reshape both
  $('#bloat-sliders').append(num('Bloat', 'bloat'), num('Inside', 'inside'))
  const reshape = button($('#bloat-shuffle'), () => (state.bloatSeed = Math.floor(Math.random() * 1e9)))
  addSync(() => ((reshape as HTMLButtonElement).disabled = !state.bloat && !state.inside))
  // Inside's shapes and edges, greyed out while Inside is 0
  const insideShapes: { value: InsideShapes; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'large', label: 'Large' },
    { value: 'both', label: 'Both' },
  ]
  choice($('#inside-shapes'), insideShapes, { get: () => state.insideShapes, set: (v) => (state.insideShapes = v) })
  const insideEdges: { value: InsideEdges; label: string }[] = [
    { value: 'eased', label: 'Eased Edges' },
    { value: 'full', label: 'Full Edges' },
  ]
  choice($('#inside-edges'), insideEdges, { get: () => state.insideEdges, set: (v) => (state.insideEdges = v) })
  addSync(() =>
    document.querySelectorAll<HTMLButtonElement>('#inside-shapes button, #inside-edges button').forEach((b) => (b.disabled = !state.inside)),
  )

  // Motion
  toggle($('#motion-switch'), { get: () => state.motion, set: (v) => (state.motion = v) })
  const modes: { value: Mode; label: string }[] = [
    { value: 'wave', label: 'Wave' },
    { value: 'drift', label: 'Drift' },
    { value: 'reveal', label: 'Reveal' },
    { value: 'blobs', label: 'Blobs' },
    { value: 'fall', label: 'Fall' },
  ]
  choice($('#modes'), modes, { get: () => state.mode, set: (v) => (state.mode = v) })
  const moving = () => state.motion
  $('#motion-sliders').append(num('Speed', 'speed', moving), num('Amount', 'amount', moving))
  addSync(() => $('#modes').querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = !state.motion)))

  colour($('#line-colour'), { get: () => state.lineColour, set: (v) => (state.lineColour = v) })
  colour($('#background-colour'), { get: () => state.background, set: (v) => (state.background = v) })

  // Canvas: Fit, a ready-made size, or any width × height
  const sizes = [{ value: 'fit', label: 'Fit' }, ...Object.keys(CANVAS_PRESETS).map((value) => ({ value, label: value }))]
  choice($('#canvas-sizes'), sizes, {
    get: () => {
      if (state.canvasFit) return 'fit'
      const match = Object.entries(CANVAS_PRESETS).find(([, [w, h]]) => w === state.canvasW && h === state.canvasH)
      return match?.[0] ?? ''
    },
    set: (v) => {
      state.canvasFit = v === 'fit'
      if (v !== 'fit') [state.canvasW, state.canvasH] = CANVAS_PRESETS[v]
    },
  })
  const sizeField = (sel: string, key: 'canvasW' | 'canvasH') => {
    numberField($<HTMLInputElement>(sel), { get: () => state[key], set: (v) => Object.assign(state, { [key]: v, canvasFit: false }) }, RANGES[key])
  }
  sizeField('#canvas-w', 'canvasW')
  sizeField('#canvas-h', 'canvasH')
  // the size fields are dimmed while the canvas fits the window
  addSync(() => $('.size-row').classList.toggle('is-dim', state.canvasFit))

  const play = button($('#play'), () => (clock.playing = !clock.playing))
  addSync(() => (play.textContent = clock.playing ? 'Pause' : 'Play'))
  button($('#randomize'), randomize)
  button($('#reset'), reset)

  button($('#save-png'), actions.savePng)
  button($('#save-svg'), actions.saveSvg)
  const record = button($('#record'), actions.record)
  addSync(() => {
    record.textContent = actions.isRecording() ? 'Stop' : 'Record'
    record.classList.toggle('is-recording', actions.isRecording())
  })
  // every setting as text, to keep or to send on
  button($('#copy-settings'), async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(state, null, 2))
      hint('Settings copied')
    } catch {
      hint("Couldn't copy to the clipboard", true)
    }
  })

  // Presets: each button switches every setting to a saved look, and is lit while nothing's changed
  PRESETS.forEach((_, i) => {
    const b = button($(`#preset-${i + 1}`), () => usePreset(i))
    addSync(() => {
      b.classList.toggle('is-active', isPreset(i))
      b.setAttribute('aria-pressed', String(isPreset(i)))
    })
  })

  syncPanel()
}
