# 🌐 TopoGlyph Web

The official web frontend for **TopoGlyph** — a topology-to-glyph text-art rendering engine. This repository houses a static, zero-server web app that compiles the core Rust engine into WebAssembly to convert images, video, and GIFs into text art directly in the browser.

🔗 **Live Site:** [https://topoglyph.xuepoo.xyz](https://topoglyph.xuepoo.xyz)

---

## Architecture

1. **`wasm-engine/`**
   - A Rust `cdylib` crate bridging `topoglyph-core`/`-atlas`/`-output`/`-vectomancy` (pinned to their published crates.io releases) to JavaScript via `wasm-bindgen`/`serde-wasm-bindgen`.
   - `AtlasHandle` builds a glyph atlas once and reuses it across many `render_with_atlas` calls, so video conversion doesn't re-rasterize a custom font on every single frame.
   - `AnimationBuilder` assembles a sequence of matched frames into a `.tglyph` text animation (see `topoglyph_output::animation`), matching the CLI's own `topoglyph video` output format.
2. **`zola-site/`**
   - A [Zola](https://www.getzola.org/) static site with a self-authored "paper" aesthetic (see `static/css/paper.css`) — a monospace `<pre>` output panel wrapped in a perforated-edge, receipt-paper-styled container, rather than depending on a full CSS framework.
   - `static/js/app.js` wires three tabs: Image (upload → render), Video/GIF (native `<video>`/`<canvas>` frame extraction → `.tglyph` conversion → playback), and Glyph Atlas (inspects the configured atlas's masks/ports/features).
   - No FFmpeg in the browser: video/GIF decoding uses the browser's own `<video>` element, since `topoglyph-video`'s `ffmpeg-next` dependency can't target `wasm32-unknown-unknown` (the native CLI gates it behind the `video` cargo feature for the same reason).

## Local Development

```bash
# Build the WASM engine
cd wasm-engine
wasm-pack build --target web --out-dir ../zola-site/static/wasm

# Serve the site
cd ../zola-site
zola serve
```

> **Note (CachyOS / Arch with a global `target-cpu=native` + `mold` Cargo
> config):** `wasm-bindgen`'s `cdylib` output needs a real link step even on
> `wasm32-unknown-unknown`, and `mold` doesn't support that target
> (`clang: error: invalid linker name`). If your global
> `$CARGO_HOME/config.toml` sets a linker/rustflags for all targets, build
> with an isolated `CARGO_HOME` instead of trying to override it inline —
> Cargo unions `cfg(all())` rustflags with target-specific ones rather than
> replacing them, so a per-target override in this repo can't cancel it out:
>
> ```bash
> CARGO_HOME=/tmp/clean-cargo-home wasm-pack build --target web --out-dir ../zola-site/static/wasm
> ```

## Deployment

Deploys to Cloudflare Pages (project `topoglyph`) via `.github/workflows/deploy.yml` on every push to `main`. See that workflow for the exact build steps (wasm-pack, then `zola build`, then `wrangler pages deploy`).
