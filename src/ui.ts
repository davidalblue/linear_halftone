// Panel building blocks: buttons, choice tiles, toggles and sliders. Each control redraws itself from
// the state on every change, so the panel never needs to know which control changed what.

export type Bind<T> = { get(): T; set(v: T): void }
type Range = [number, number]

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!

let onChange = () => {}
const syncs: (() => void)[] = []

/** `changed` runs after every edit made through the panel. */
export function onPanelChange(changed: () => void) {
  onChange = () => {
    changed()
    syncPanel()
  }
}

/** Reflects the state in every control. Call it after changing the state from outside the panel. */
export function syncPanel() {
  syncs.forEach((fn) => fn())
}

/** Adds a redraw of some other part of the panel, run on every sync. */
export const addSync = (fn: () => void) => syncs.push(fn)

let hintTimer = 0
/** Shows `message` at the foot of the panel for a few seconds. */
export function hint(message: string, error = false) {
  const box = $('#hint')
  const resting = box.dataset.resting ?? box.textContent ?? ''
  box.dataset.resting = resting
  box.textContent = message
  box.classList.toggle('is-error', error)
  clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => {
    box.textContent = resting
    box.classList.remove('is-error')
  }, 2500)
}

export function button(b: HTMLElement, action: () => void) {
  b.addEventListener('click', (e) => {
    action()
    onChange()
    // mouse clicks shouldn't leave focus on the button, so keyboard shortcuts keep working
    if (e.detail > 0) b.blur()
  })
  return b
}

/** A row of tiles where exactly one is selected, like a set of modes. */
export function choice<T extends string>(box: HTMLElement, options: { value: T; label: string }[], bind: Bind<T>) {
  for (const { value, label } of options) {
    const b = el('button', { class: 'tile' }, label)
    box.append(button(b, () => bind.set(value)))
    syncs.push(() => {
      b.classList.toggle('is-active', bind.get() === value)
      b.setAttribute('aria-pressed', String(bind.get() === value))
    })
  }
}

/** An on/off control: a `.switch` (with role="switch") or a `.tile.toggle`. */
export function toggle(b: HTMLElement, bind: Bind<boolean>) {
  const isSwitch = b.classList.contains('switch')
  button(b, () => bind.set(!bind.get()))
  syncs.push(() => {
    b.classList.toggle(isSwitch ? 'is-on' : 'is-active', bind.get())
    b.setAttribute(isSwitch ? 'aria-checked' : 'aria-pressed', String(bind.get()))
  })
  return b
}

/** A colour swatch: an `<input type="color">` inside a `.swatch` label. */
export function colour(input: HTMLInputElement, bind: Bind<string>) {
  input.addEventListener('input', () => {
    bind.set(input.value)
    onChange()
  })
  syncs.push(() => {
    if (input.value !== bind.get()) input.value = bind.get()
  })
}

/** A number typed into `input`, kept within `range` and applied on Enter or when leaving the field. */
export function numberField(input: HTMLInputElement, bind: Bind<number>, range: Range) {
  input.min = String(range[0])
  input.max = String(range[1])
  input.addEventListener('change', () => {
    const v = Math.round(Number(input.value))
    if (input.value.trim() !== '' && Number.isFinite(v)) bind.set(Math.min(range[1], Math.max(range[0], v)))
    onChange()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur()
  })
  syncs.push(() => {
    // leave it alone while it's being typed into
    if (document.activeElement !== input) input.value = String(bind.get())
  })
}

export type Slider = HTMLElement & { sync(): void }

/**
 * A slider over `range()`; it's disabled (showing `disabledText`) while `range()` is null. Its thumb
 * shows the value as `format` writes it. `sync()` redraws just this slider.
 */
export function slider(label: string, bind: Bind<number>, range: () => Range | null, disabledText = '–', format: (v: number) => string = String) {
  const row = el('div', { class: 'slider' }) as Slider
  const track = el('div', { class: 'track', role: 'slider', tabindex: '0', 'aria-label': label })
  const thumb = el('div', { class: 'thumb' })
  track.append(thumb)
  row.append(el('span', { class: 'label' }, label), track)

  const set = (v: number) => {
    const r = range()
    if (!r) return
    v = Math.round(Math.min(r[1], Math.max(r[0], v)))
    if (v === bind.get()) return
    bind.set(v)
    onChange()
  }
  const fromPointer = (e: PointerEvent) => {
    const r = range()
    if (!r) return
    const box = track.getBoundingClientRect()
    const w = thumb.offsetWidth
    set(r[0] + ((e.clientX - box.left - w / 2) / (box.width - w)) * (r[1] - r[0]))
  }

  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId)
    fromPointer(e)
  })
  track.addEventListener('pointermove', (e) => {
    if (track.hasPointerCapture(e.pointerId)) fromPointer(e)
  })
  track.addEventListener('keydown', (e) => {
    const r = range()
    if (!r) return
    const unit = r[1] - r[0] > 200 ? 10 : 1
    const step = e.shiftKey ? unit * 10 : unit
    const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key]
    if (delta === undefined) return
    e.preventDefault()
    set(bind.get() + delta)
  })

  row.sync = () => {
    const r = range()
    row.classList.toggle('is-disabled', !r)
    track.tabIndex = r ? 0 : -1
    track.setAttribute('aria-disabled', String(!r))
    if (!r) {
      thumb.textContent = disabledText
      thumb.style.left = '0px'
      return
    }
    const v = Math.round(bind.get())
    thumb.textContent = format(v)
    thumb.style.left = `calc((100% - var(--thumb-w)) * ${r[1] > r[0] ? (v - r[0]) / (r[1] - r[0]) : 0})`
    track.setAttribute('aria-valuemin', String(r[0]))
    track.setAttribute('aria-valuemax', String(r[1]))
    track.setAttribute('aria-valuenow', String(v))
    track.setAttribute('aria-valuetext', format(v))
  }
  syncs.push(row.sync)
  return row
}

function el(tag: string, attrs: Record<string, string>, text?: string) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  if (text) node.textContent = text
  return node
}
