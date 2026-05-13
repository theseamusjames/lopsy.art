
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
