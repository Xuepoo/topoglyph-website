use serde::{Deserialize, Serialize};
use std::panic;
use wasm_bindgen::prelude::*;

use topoglyph_atlas::atlas::{AtlasOptions, GlyphAtlas};
use topoglyph_core::canvas::TextCanvas;
use topoglyph_core::clipping;
use topoglyph_core::geometry::GridOptions;
use topoglyph_core::matching::{self, GlyphDescriptor, MatchOptions, MatchWeights};
use topoglyph_output::animation::TglyphAnimation;
use topoglyph_output::encoder::{AnsiEncoder, HtmlEncoder, PlainTextEncoder, TextEncoder};
use topoglyph_vectomancy::adapter::{self, SmoothingOptions};

#[wasm_bindgen(start)]
pub fn start() {
    #[cfg(feature = "console_error_panic_hook")]
    panic::set_hook(Box::new(console_error_panic_hook::hook));
}

/// Options mirroring `topoglyph-cli render`'s flags, passed from JS as a
/// plain object and deserialized via `serde-wasm-bindgen`.
#[derive(Deserialize)]
pub struct RenderOptions {
    pub width: usize,
    pub height: usize,
    #[serde(default)]
    pub tolerance: f64,
    #[serde(default = "default_chaikin_iters")]
    pub chaikin_iters: usize,
    #[serde(default)]
    pub invert: bool,
    #[serde(default)]
    pub color: bool,
    #[serde(default = "default_top_k")]
    pub top_k: usize,
    #[serde(default = "default_relaxation_rounds")]
    pub relaxation_rounds: usize,
    #[serde(default)]
    pub preset: String,
    #[serde(default)]
    pub glyph_mode: String,
    #[serde(default = "default_output_format")]
    pub output_format: String,
}

fn default_chaikin_iters() -> usize {
    1
}
fn default_top_k() -> usize {
    8
}
fn default_relaxation_rounds() -> usize {
    3
}
fn default_output_format() -> String {
    "text".to_string()
}

#[derive(Serialize)]
struct RenderResult {
    text: String,
    columns: usize,
    rows: usize,
}

fn resolve_preset(preset: &str) -> MatchWeights {
    match preset {
        "han-emoji" => MatchWeights::han_emoji_preset(),
        _ => MatchWeights::line_art_preset(),
    }
}

fn resolve_frequency_bias(glyph_mode: &str) -> f32 {
    match glyph_mode {
        "weighted" => 1.0,
        _ => 0.0,
    }
}

/// A built glyph atlas, kept alive on the JS side as an opaque handle so a
/// caller processing many frames (e.g. video-to-`.tglyph` conversion, where
/// every frame reuses the same charset/font) only pays the font
/// rasterization cost once instead of on every single frame. Mirrors
/// `topoglyph-cli`'s `build_atlas` helper, but exposed as a
/// `#[wasm_bindgen]` struct rather than a plain function so JS can hold a
/// reference to it across multiple `render_with_atlas` calls.
#[wasm_bindgen]
pub struct AtlasHandle {
    inner: GlyphAtlas,
}

#[wasm_bindgen]
impl AtlasHandle {
    /// Builds the built-in 17-glyph line/box-drawing atlas (no font
    /// required). This is the `lines` charset from `topoglyph-cli`.
    #[wasm_bindgen(js_name = builtin)]
    pub fn builtin(charset: &str) -> Result<AtlasHandle, JsValue> {
        if charset == "lines" {
            let inner = GlyphAtlas::from_text("", &AtlasOptions::default())
                .map_err(|e| JsValue::from_str(&e))?;
            return Ok(AtlasHandle { inner });
        }
        let glyphs = match charset {
            "ascii" => topoglyph_atlas::precomputed::build_ascii_glyphs(),
            "blocks" => topoglyph_atlas::precomputed::build_blocks_glyphs(),
            "braille" => topoglyph_atlas::precomputed::build_braille_glyphs(),
            _ => return Err(JsValue::from_str(&format!("Invalid builtin charset: '{charset}'"))),
        };
        let index = topoglyph_core::matching::GlyphIndex::build(&glyphs);
        let inner = GlyphAtlas {
            font_id: format!("precomputed_{charset}"),
            glyphs,
            index,
        };
        Ok(AtlasHandle { inner })
    }

    /// Builds an atlas from a custom character pool and a TTF/OTF font's
    /// raw bytes (as read from a `<input type="file">` into a
    /// `Uint8Array`). `charset` is one of `ascii`/`blocks`/`braille` (uses
    /// `topoglyph-cli`'s built-in preset strings) or `custom` (uses `chars`
    /// verbatim, including repeats for `--glyph-mode weighted`'s frequency
    /// weighting).
    #[wasm_bindgen(js_name = fromFont)]
    pub fn from_font(
        charset: &str,
        chars: &str,
        font_bytes: &[u8],
    ) -> Result<AtlasHandle, JsValue> {
        let pool = if charset == "custom" {
            chars.to_string()
        } else {
            GlyphAtlas::get_charset_string(charset)
                .ok_or_else(|| JsValue::from_str(&format!("Invalid charset: '{charset}'")))?
                .to_string()
        };
        let inner = GlyphAtlas::from_custom_font(&pool, font_bytes, &AtlasOptions::default())
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(AtlasHandle { inner })
    }

    /// Number of distinct glyphs in this atlas.
    #[wasm_bindgen(js_name = glyphCount)]
    pub fn glyph_count(&self) -> usize {
        self.inner.glyphs.len()
    }

    /// Dumps every glyph's token/ports/features as a JSON-serializable
    /// value, for the atlas-preview visualization
    /// (`topoglyph-cli atlas inspect`'s web equivalent). Each entry mirrors
    /// one `GlyphDescriptor`, including the raw 16x32 `CellMask` bits (as a
    /// flat boolean array) so the frontend can render the glyph's shape as
    /// a small grid without needing to re-rasterize anything.
    #[wasm_bindgen(js_name = inspect)]
    pub fn inspect(&self) -> Result<JsValue, JsValue> {
        let summary: Vec<GlyphSummary> = self.inner.glyphs.iter().map(GlyphSummary::from).collect();
        serde_wasm_bindgen::to_value(&AtlasSummary {
            font_id: self.inner.font_id.clone(),
            glyphs: summary,
        })
        .map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

#[derive(Serialize)]
struct AtlasSummary {
    font_id: String,
    glyphs: Vec<GlyphSummary>,
}

#[derive(Serialize)]
struct GlyphSummary {
    token: String,
    cell_width: u8,
    /// Flattened 16x32 mask bits, row-major, for a frontend grid renderer.
    mask_bits: Vec<bool>,
    ports: Vec<&'static str>,
    orientation: [f32; 8],
    density: f32,
    centroid: [f32; 2],
    curvature: f32,
    stroke_count: u8,
    frequency: f32,
}

impl From<&GlyphDescriptor> for GlyphSummary {
    fn from(g: &GlyphDescriptor) -> Self {
        let mut mask_bits = Vec::with_capacity(16 * 32);
        for y in 0..32 {
            for x in 0..16 {
                mask_bits.push(g.mask.get(x, y, 16));
            }
        }

        use topoglyph_core::geometry::PortMask;
        let mut ports = Vec::new();
        for (flag, name) in [
            (PortMask::N, "N"),
            (PortMask::NE, "NE"),
            (PortMask::E, "E"),
            (PortMask::SE, "SE"),
            (PortMask::S, "S"),
            (PortMask::SW, "SW"),
            (PortMask::W, "W"),
            (PortMask::NW, "NW"),
        ] {
            if g.ports.contains(flag) {
                ports.push(name);
            }
        }

        Self {
            token: g.token.clone(),
            cell_width: g.cell_width,
            mask_bits,
            ports,
            orientation: g.orientation,
            density: g.density,
            centroid: g.centroid,
            curvature: g.curvature,
            stroke_count: g.stroke_count,
            frequency: g.frequency,
        }
    }
}

fn render_canvas(
    image_bytes: &[u8],
    opts: &RenderOptions,
    atlas: &GlyphAtlas,
) -> Result<TextCanvas, String> {
    let smoothing = SmoothingOptions {
        tolerance: opts.tolerance,
        chaikin_iters: opts.chaikin_iters,
    };
    let mut scene = adapter::raster_to_smoothed_scene(image_bytes, opts.color, &smoothing)?;

    if opts.invert {
        scene = adapter::invert_scene_colors(&scene);
    }

    let grid_opts = GridOptions {
        columns: opts.width,
        rows: Some(opts.height),
        ..Default::default()
    };
    let (out_cols, out_rows, cell_descriptors) = clipping::process_scene(&scene, &grid_opts);

    let mut weights = resolve_preset(&opts.preset);
    weights.frequency_bias = resolve_frequency_bias(&opts.glyph_mode);
    let match_options = MatchOptions {
        top_k: opts.top_k,
        relaxation_rounds: opts.relaxation_rounds,
    };

    Ok(matching::match_scene_indexed(
        out_cols,
        out_rows,
        &cell_descriptors,
        &atlas.glyphs,
        Some(&atlas.index),
        &weights,
        &match_options,
    ))
}

fn encode_canvas(canvas: &TextCanvas, output_format: &str) -> Result<String, String> {
    let encoded = match output_format {
        "html" => HtmlEncoder::new()
            .encode(canvas)
            .map_err(|e| e.to_string())?,
        "ansi" => AnsiEncoder::new()
            .encode(canvas)
            .map_err(|e| e.to_string())?,
        _ => PlainTextEncoder::new()
            .encode(canvas)
            .map_err(|e| e.to_string())?,
    };
    String::from_utf8(encoded).map_err(|e| format!("Encoder produced invalid UTF-8: {e}"))
}

/// Converts an in-memory raster image (any format the `image` crate
/// understands: PNG/JPEG/WebP/GIF/BMP) into text art, mirroring
/// `topoglyph-cli render`'s pipeline: raster decode -> RDP/Chaikin
/// smoothing -> Liang-Barsky grid clipping -> Top-K + Neighbor Relaxation
/// glyph matching -> text encoding. Builds a fresh built-in atlas
/// internally; for repeated calls against the same custom font/charset
/// (e.g. every frame of a video), build an [`AtlasHandle`] once and call
/// [`render_with_atlas`] instead.
#[wasm_bindgen]
pub fn render_image(image_bytes: &[u8], options: JsValue) -> Result<JsValue, JsValue> {
    let opts: RenderOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|e| JsValue::from_str(&format!("Invalid options: {e}")))?;
    let atlas =
        GlyphAtlas::from_text("", &AtlasOptions::default()).map_err(|e| JsValue::from_str(&e))?;
    let canvas = render_canvas(image_bytes, &opts, &atlas).map_err(|e| JsValue::from_str(&e))?;
    let text = encode_canvas(&canvas, &opts.output_format).map_err(|e| JsValue::from_str(&e))?;
    let result = RenderResult {
        text,
        columns: canvas.width,
        rows: canvas.height,
    };
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Same as [`render_image`], but reuses a previously-built [`AtlasHandle`]
/// instead of the built-in line atlas. This is the entry point video
/// conversion should use: build one `AtlasHandle` up front, then call this
/// once per decoded frame.
#[wasm_bindgen(js_name = renderWithAtlas)]
pub fn render_with_atlas(
    image_bytes: &[u8],
    options: JsValue,
    atlas: &AtlasHandle,
) -> Result<JsValue, JsValue> {
    let opts: RenderOptions = serde_wasm_bindgen::from_value(options)
        .map_err(|e| JsValue::from_str(&format!("Invalid options: {e}")))?;
    let canvas =
        render_canvas(image_bytes, &opts, &atlas.inner).map_err(|e| JsValue::from_str(&e))?;
    let text = encode_canvas(&canvas, &opts.output_format).map_err(|e| JsValue::from_str(&e))?;
    let result = RenderResult {
        text,
        columns: canvas.width,
        rows: canvas.height,
    };
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// A growable sequence of matched frames for building a `.tglyph`
/// animation client-side. The frontend decodes a video/GIF via a `<video>`
/// element + `<canvas>` frame-grabbing (there is no in-browser FFmpeg —
/// `topoglyph-video`'s ffmpeg-next dependency can't target wasm32, same as
/// the native CLI's own `video` cargo feature is gated off for wasm
/// consumers), encodes each grabbed frame to PNG bytes via
/// `canvas.toBlob`/`OffscreenCanvas`, and pushes it into this builder one
/// frame at a time so frames never all need to be held in memory as
/// decoded [`TextCanvas`]es simultaneously.
#[wasm_bindgen]
pub struct AnimationBuilder {
    canvases: Vec<TextCanvas>,
}

#[wasm_bindgen]
impl AnimationBuilder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            canvases: Vec::new(),
        }
    }

    /// Decodes and matches one frame, appending it to the sequence.
    /// `options.output_format` is ignored here (final encoding happens once
    /// in [`AnimationBuilder::finish`]); this always internally uses the
    /// matched [`TextCanvas`], not a pre-encoded string.
    #[wasm_bindgen(js_name = pushFrame)]
    pub fn push_frame(
        &mut self,
        image_bytes: &[u8],
        options: JsValue,
        atlas: &AtlasHandle,
    ) -> Result<(), JsValue> {
        let opts: RenderOptions = serde_wasm_bindgen::from_value(options)
            .map_err(|e| JsValue::from_str(&format!("Invalid options: {e}")))?;
        let canvas =
            render_canvas(image_bytes, &opts, &atlas.inner).map_err(|e| JsValue::from_str(&e))?;
        self.canvases.push(canvas);
        Ok(())
    }

    #[wasm_bindgen(js_name = frameCount)]
    pub fn frame_count(&self) -> usize {
        self.canvases.len()
    }

    /// Encodes every pushed frame into the final `.tglyph` text document
    /// (see `topoglyph_output::animation`: first frame in full, subsequent
    /// frames as a diff against the previous one). Consumes the builder —
    /// call this once all frames have been pushed.
    #[wasm_bindgen]
    pub fn finish(self, fps: f32, include_color: bool) -> Result<String, JsValue> {
        let animation = TglyphAnimation::encode(&self.canvases, fps, include_color)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(animation.to_text())
    }
}

impl Default for AnimationBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Decodes a `.tglyph` text document (as produced by
/// [`AnimationBuilder::finish`] or `topoglyph-cli video`) back into a
/// frame-by-frame structure the frontend player can index directly,
/// avoiding re-implementing the delta-decoding logic in JS.
#[wasm_bindgen(js_name = decodeAnimation)]
pub fn decode_animation(text: &str) -> Result<JsValue, JsValue> {
    let animation = TglyphAnimation::decode(text).map_err(|e| JsValue::from_str(&e.to_string()))?;

    #[derive(Serialize)]
    struct DecodedAnimation {
        width: usize,
        height: usize,
        fps: f32,
        include_color: bool,
        frames: Vec<String>,
    }

    let frames = animation
        .frames
        .iter()
        .map(|canvas| {
            let mut s = String::with_capacity(canvas.width * canvas.height);
            for (i, cell) in canvas.cells.iter().enumerate() {
                s.push_str(&cell.token);
                if (i + 1) % canvas.width == 0 {
                    s.push('\n');
                }
            }
            s
        })
        .collect();

    let decoded = DecodedAnimation {
        width: animation.width,
        height: animation.height,
        fps: animation.fps,
        include_color: animation.include_color,
        frames,
    };

    serde_wasm_bindgen::to_value(&decoded).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Returns the list of built-in preset charset names (`get_charset_string`
/// keys) for populating a `<select>` in the UI without hardcoding the list
/// in JS.
#[wasm_bindgen(js_name = builtinCharsets)]
pub fn builtin_charsets() -> Vec<JsValue> {
    ["lines", "ascii", "blocks", "braille", "custom"]
        .iter()
        .map(|s| JsValue::from_str(s))
        .collect()
}
