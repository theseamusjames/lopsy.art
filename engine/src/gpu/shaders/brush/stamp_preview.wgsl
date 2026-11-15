// Clone Stamp / Healing Brush source preview: inside the brush disc at
// u_cursor, show the active layer as it is at u_source. The screen <->
// document mapping matches the final blit.
struct Params {
    u_resolution: vec2<f32>,
    u_zoom: f32,
    u_pan: vec2<f32>,
    u_docSize: vec2<f32>,
    u_cursor: vec2<f32>,
    u_source: vec2<f32>,
    u_radius: f32,
    u_layerOrigin: vec2<f32>,
    u_layerSize: vec2<f32>,
    u_opacity: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_layerTex: texture_2d<f32>;
@group(0) @binding(2) var u_layerTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let screenPos = vec2<f32>(uv.x, 1.0 - uv.y) * params.u_resolution;
    let docPos = (screenPos - params.u_resolution * 0.5 - params.u_pan) / params.u_zoom + params.u_docSize * 0.5;
    if (length(docPos - params.u_cursor) > params.u_radius) { discard; }

    let layerUV = (docPos + (params.u_source - params.u_cursor) - params.u_layerOrigin) / params.u_layerSize;
    if (any(layerUV < vec2<f32>(0.0)) || any(layerUV > vec2<f32>(1.0))) { discard; }

    let c = textureSampleLevel(u_layerTex, u_layerTex_sampler, layerUV, 0.0);
    return vec4<f32>(c.rgb, c.a * params.u_opacity);
}
