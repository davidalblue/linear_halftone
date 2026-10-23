import { defineConfig } from 'vite'

export default defineConfig({
  // `pnpm dev` serves from the root; the deploy workflow builds with --base /<repo name>/
  // so the site works at https://<user>.github.io/<repo name>/ whatever the repo is called
  build: {
    // p5 is ~1 MB minified on its own
    chunkSizeWarningLimit: 1500,
  },
})
