// Fills a frame: a solid colour inside the outer rounded rectangle and
// outside the hole's rounded rectangle, both antialiased over one pixel.
// Rects are (x, y, width, height) in texels, and texel rows match document
// rows. The layer texture is straight alpha, so coverage scales only alpha.
struct Params {
    u_color: vec4<f32>,
    u_outerRect: vec4<f32>,
    u_holeRect: vec4<f32>,
    u_outerRadius: f32,
    u_innerRadius: f32,
    u_hasHole: i32,
}
@group(0) @binding(0) var<uniform> params: Params;

fn sdRoundRect(p: vec2<f32>, rect: vec4<f32>, r: f32) -> f32 {
    let half = rect.zw * 0.5;
    let q = abs(p - (rect.xy + half)) - half + r;
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment
fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let p = position.xy;
    let outer = 1.0 - smoothstep(-0.5, 0.5, sdRoundRect(p, params.u_outerRect, params.u_outerRadius));
    var hole = 0.0;
    if (params.u_hasHole == 1) {
        hole = 1.0 - smoothstep(-0.5, 0.5, sdRoundRect(p, params.u_holeRect, params.u_innerRadius));
    }
    let coverage = outer * (1.0 - hole);
    if (coverage <= 0.0) {
        return vec4<f32>(0.0);
    }
    return vec4<f32>(params.u_color.rgb, params.u_color.a * coverage);
}
