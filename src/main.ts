import p5 from 'p5'
import './style.css'
import { drawHalftone, drawOriginal, halftoneSvg } from './halftone'
import { initPanel, useImage } from './panel'
import { clock, state } from './state'
import { hint, syncPanel } from './ui'

const stage = document.getElementById('stage')!
let canvas: HTMLCanvasElement | null = null
let saveNextFrame = false
let recorder: MediaRecorder | null = null

initPanel({
  savePng: () => (saveNextFrame = true),
  saveSvg: () => {
    if (!canvas) return
    const { width, height } = canvas.dataset
    download(new Blob([halftoneSvg(Number(width), Number(height), clock.time)], { type: 'image/svg+xml' }), 'halftone.svg')
  },
  record: toggleRecording,
  isRecording: () => recorder !== null,
})

new p5((p: p5) => {
  p.setup = () => {
    p.createCanvas(stage.clientWidth, stage.clientHeight)
    canvas = (p.drawingContext as CanvasRenderingContext2D).canvas
  }

  p.draw = () => {
    sizeCanvas(p)
    if (clock.playing && state.motion) clock.time += (p.deltaTime / 1000) * (0.05 + (state.speed / 100) * 1.2)
    const ctx = p.drawingContext as CanvasRenderingContext2D
    p.background(state.background)
    if (state.halftone) drawHalftone(ctx, p.width, p.height, clock.time)
    else drawOriginal(ctx, p.width, p.height)
    // saved at the end of a frame, after everything is drawn
    if (saveNextFrame) {
      saveNextFrame = false
      p.saveCanvas('halftone', 'png')
    }
  }
}, stage)

// an image dropped anywhere on the canvas is halftoned
stage.addEventListener('dragover', (e) => {
  e.preventDefault()
  stage.classList.add('is-dropping')
})
stage.addEventListener('dragleave', () => stage.classList.remove('is-dropping'))
stage.addEventListener('drop', (e) => {
  e.preventDefault()
  stage.classList.remove('is-dropping')
  const file = e.dataTransfer?.files[0]
  if (file) useImage(file)
})

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    saveNextFrame = true
    return
  }
  // keys don't act while typing a size
  if (document.activeElement instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
  // H flips between the halftone and the original
  if (e.key.toLowerCase() === 'h') {
    state.halftone = !state.halftone
    syncPanel()
  }
  // Space pauses, unless it's pressing a focused button
  if (e.key === ' ' && !(document.activeElement instanceof HTMLButtonElement)) {
    e.preventDefault()
    clock.playing = !clock.playing
    syncPanel()
  }
})

/**
 * Fit: the canvas fills the stage at the screen's resolution. Otherwise it's exactly the chosen
 * width × height in pixels (so saved files are that size), shown scaled down to fit the stage.
 */
function sizeCanvas(p: p5) {
  const fit = state.canvasFit
  const w = fit ? stage.clientWidth : state.canvasW
  const h = fit ? stage.clientHeight : state.canvasH
  const density = fit ? window.devicePixelRatio || 1 : 1
  if (p.pixelDensity() !== density) p.pixelDensity(density)
  if (p.width !== w || p.height !== h) p.resizeCanvas(w, h)
  const scale = fit ? 1 : Math.min(stage.clientWidth / w, stage.clientHeight / h)
  const style = { width: `${w * scale}px`, height: `${h * scale}px` }
  if (canvas && (canvas.style.width !== style.width || canvas.style.height !== style.height)) Object.assign(canvas.style, style)
  canvas?.classList.toggle('is-fixed', !fit)
  // the SVG is the size of the drawing, not of the screen pixels
  if (canvas) Object.assign(canvas.dataset, { width: String(w), height: String(h) })
}

/** Starts recording the canvas as a video, or stops and downloads it. */
function toggleRecording() {
  if (recorder) {
    recorder.stop()
    return
  }
  if (!canvas) return
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  const type = types.find((t) => MediaRecorder.isTypeSupported(t))
  if (!type) {
    hint("This browser can't record video", true)
    return
  }
  const chunks: Blob[] = []
  const rec = new MediaRecorder(canvas.captureStream(60), { mimeType: type, videoBitsPerSecond: 20_000_000 })
  rec.ondataavailable = (e) => chunks.push(e.data)
  rec.onstop = () => {
    recorder = null
    syncPanel()
    download(new Blob(chunks, { type }), `halftone.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`)
  }
  rec.start()
  recorder = rec
  hint('Recording…')
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
