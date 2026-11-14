struct Params {
    u_opacity: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var u_srcTex: texture_2d<f32>;
@group(0) @binding(2) var u_srcTex_sampler: sampler;
@group(0) @binding(3) var u_dstTex: texture_2d<f32>;
@group(0) @binding(4) var u_dstTex_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let src = textureSample(u_srcTex, u_srcTex_sampler, uv);
    let dst = textureSample(u_dstTex, u_dstTex_sampler, uv);
    // Source (stroke texture) is premultiplied — un-premultiply first
    var srcRGB = vec3<f32>(0.0);
    if (src.a > 0.001) { srcRGB = src.rgb / src.a; }
    let sa = src.a * params.u_opacity;
    let da = dst.a;
    let outA = sa + da * (1.0 - sa);
    if (outA < 0.001) {
        return vec4<f32>(0.0);
    }
    let outRGB = (srcRGB * sa + dst.rgb * da * (1.0 - sa)) / outA;
    return vec4<f32>(outRGB, outA);
}
