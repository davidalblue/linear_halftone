# Linear Halftone

Turns an image into an animated linear halftone: evenly spaced lines whose width follows the ink
of the design underneath, in steps along each line, after Karel Martens' patterns. Built with Vite,
TypeScript and p5, from the [tool template](https://github.com/davidalblue/template).

```sh
pnpm install
pnpm dev
```

Every push to `main` deploys to GitHub Pages (set **Settings → Pages → Source** to **GitHub Actions**).

## Using it

- **Image**: upload or drop a PNG (JPG, WebP and SVG work too). **Tone** reads dark areas as ink;
  **Shape** reads the opaque parts of a transparent PNG, and is picked for you when the PNG has
  transparency. **Invert** swaps ink and paper. **Brightness** can make blank paper a mid tone.
  **Soften** blurs the image first, so edges become ramps the lines taper along. **Glow** draws a
  dark rim along every edge of the design; its slider sets how wide.
- **Halftone**: the switch flips between the halftone and the original image (or press **H**).
  **Steps** cuts each line into pieces of one width; **Screen** works like a printer's line screen,
  each edge of a line following the image pixel by pixel, so lines taper to points and the design's
  edges cut through them. Lines sets how many; Weight and Hairline the thickest and thinnest line; Detail how short the steps
  are (Steps only); Levels how many widths there are (Any = smooth); Square or Sloped steps.
- **Motion**: **Wave** sweeps a band of heavier ink across, **Drift** slides each line's image up and
  down, **Reveal** fills the lines in one after another and empties them again.
- **Export**: PNG, SVG (one path per line) and video. Pick a canvas size first to export at that size.

## Files

| File | What it holds |
| --- | --- |
| `src/halftone.ts` | The line outlines, drawn to the canvas or written as SVG |
| `src/image.ts` | The uploaded image and its ink map |
| `src/state.ts` | Everything the panel controls, its defaults, Reset and Randomize |
| `src/panel.ts` | Connects each control in `index.html` to the state |
| `src/main.ts` | Starts p5, sizes the canvas, drop, keys and export |
| `src/ui.ts`, `src/style.css` | The panel's controls and look |
