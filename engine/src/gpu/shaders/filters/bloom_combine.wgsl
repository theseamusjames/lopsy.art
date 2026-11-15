struct Params {
    u_intensity: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_tex: texture_2d<f32>;
@group(0) @binding(2) var u_tex_sampler: sampler;
@group(0) @binding(3) var u_bloomTex: texture_2d<f32>;
@group(0) @binding(4) var u_bloomTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let original = textureSample(u_tex, u_tex_sampler, uv);
    let bloom = textureSample(u_bloomTex, u_bloomTex_sampler, uv);
    // Add the glow as premultiplied light and let its coverage extend the
    // layer's alpha, so the halo shows on transparent pixels (#1027).
    // Opaque pixels reduce to original.rgb + glow, as before.
    let glow = bloom.rgb * bloom.a * params.u_intensity;
    let glowAlpha = clamp(bloom.a * params.u_intensity, 0.0, 1.0);
    var a = original.a + glowAlpha * (1.0 - original.a);
    var premul = original.rgb * original.a + glow;
    // Where the added light exceeds the coverage (soft edges), straight
    // colour would go above 1.0: live/export show an over-white rim that
    // the 8-bit project encode then clamps away (#1181). Grow coverage to
    // hold that light instead, then cap at 1.0 so every path agrees.
    a = min(max(a, max(premul.r, max(premul.g, premul.b))), 1.0);
    premul = min(premul, vec3<f32>(a));
    if (a > 0.0) {
        return vec4<f32>(premul / a, a);
    }
    return vec4<f32>(0.0);
}
