// The body every brush dab shader shares: jitter, the brush texture and the
// selection mask applied to that shader's `computeDab`.
@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let fragPos = uv * params.u_texSize;

    let h1 = dabHash(params.u_center, 0.0);
    let h2 = dabHash(params.u_center, 127.1);
    let h3 = dabHash(params.u_center, 269.5);

    let jSize = max(1.0, params.u_size * (1.0 - params.u_sizeJitter * (1.0 - h1)));
    let jOpacity = params.u_opacity * (1.0 - params.u_opacityJitter * (1.0 - h2));
    let jAngle = params.u_angle + (h3 - 0.5) * 2.0 * params.u_angleJitter * 3.14159265;

    var result = computeDab(fragPos, params.u_center, jSize, jOpacity, jAngle);

    if (params.u_hasBrushTexture == 1 && result.a > 0.001) {
        let rel = fragPos - params.u_strokeOrigin;
        let ca = cos(params.u_textureRotation);
        let sa = sin(params.u_textureRotation);
        let rotated = vec2<f32>(ca * rel.x + sa * rel.y, -sa * rel.x + ca * rel.y);
        let texUV = rotated / (params.u_brushTextureSize * params.u_textureScale);
        let texVal = textureSampleLevel(u_brushTexture, u_brushTexture_sampler, fract(texUV + 0.5), 0.0).r;
        if (params.u_textureBlendMode == 0) {
            result = vec4<f32>(result.rgb * texVal, result.a * texVal);
        } else if (params.u_textureBlendMode == 1) {
            result = vec4<f32>(result.rgb * (1.0 - texVal), result.a * (1.0 - texVal));
        } else {
            var m = 1.0 - 2.0 * (1.0 - result.a) * (1.0 - texVal);
            if (result.a < 0.5) { m = 2.0 * result.a * texVal; }
            result = vec4<f32>(result.rgb * (m / max(result.a, 0.001)), m);
        }
    }

    if (params.u_hasSelection == 1) {
        let docPos = fragPos + params.u_layerOffset;
        let selUV = docPos / params.u_docSize;
        if (selUV.x < 0.0 || selUV.x > 1.0 || selUV.y < 0.0 || selUV.y > 1.0) { discard; }
        let selMask = textureSampleLevel(u_selectionMask, u_selectionMask_sampler, selUV, 0.0).r;
        if (selMask < 0.004) { discard; }
        result *= selMask;
    }

    return result;
}
