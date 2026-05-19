
void main() {
    vec2 fragPos = v_uv * u_texSize;

    float h1 = dabHash(u_center, 0.0);
    float h2 = dabHash(u_center, 127.1);
    float h3 = dabHash(u_center, 269.5);

    float jSize = u_size * (1.0 - u_sizeJitter * (1.0 - h1));
    jSize = max(1.0, jSize);
    float jOpacity = u_opacity * (1.0 - u_opacityJitter * (1.0 - h2));
    float jAngle = u_angle + (h3 - 0.5) * 2.0 * u_angleJitter * 3.14159265;

    vec4 result = computeDab(fragPos, u_center, jSize, jOpacity, jAngle);

    if (u_hasBrushTexture == 1 && result.a > 0.001) {
        vec2 rel = fragPos - u_strokeOrigin;
        float ca = cos(u_textureRotation);
        float sa = sin(u_textureRotation);
        vec2 rotated = vec2(ca * rel.x + sa * rel.y, -sa * rel.x + ca * rel.y);
        vec2 texUV = rotated / (u_brushTextureSize * u_textureScale);
        float texVal = texture(u_brushTexture, fract(texUV + 0.5)).r;
        if (u_textureBlendMode == 0) {
            result.a *= texVal;
            result.rgb *= texVal;
        } else if (u_textureBlendMode == 1) {
            result.a *= (1.0 - texVal);
            result.rgb *= (1.0 - texVal);
        } else {
            float m = result.a < 0.5 ? 2.0 * result.a * texVal : 1.0 - 2.0 * (1.0 - result.a) * (1.0 - texVal);
            result.rgb *= m / max(result.a, 0.001);
            result.a = m;
        }
    }

    if (u_hasSelection == 1) {
        vec2 docPos = fragPos + u_layerOffset;
        vec2 selUV = docPos / u_docSize;
        if (selUV.x < 0.0 || selUV.x > 1.0 || selUV.y < 0.0 || selUV.y > 1.0) discard;
        float selMask = texture(u_selectionMask, selUV).r;
        if (selMask < 0.004) discard;
        result *= selMask;
    }

    fragColor = result;
}
