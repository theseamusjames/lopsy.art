struct Params {
    u_hue: f32,
    u_saturation: f32,
    u_lightness: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;

//#include hsl

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = textureSample(u_tex, u_tex_sampler, uv);
    var hsl = rgb2hsl(c.rgb);
    hsl.x = fract(hsl.x + params.u_hue / 360.0);
    hsl.y = clamp(hsl.y * (1.0 + params.u_saturation / 100.0), 0.0, 1.0);
    var rgb = hsl2rgb(hsl);
    // Lightness blends towards black or white (as Photoshop does) rather than
    // shifting HSL L, which turns pale tints into fully saturated colours.
    let l = params.u_lightness / 100.0;
    if (l < 0.0) { rgb = rgb * (1.0 + l); } else { rgb = rgb + (1.0 - rgb) * l; }
    return vec4<f32>(rgb, c.a);
}
