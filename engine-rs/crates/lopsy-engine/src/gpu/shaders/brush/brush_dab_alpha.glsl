
vec4 computeDab(vec2 fragPos, vec2 center, float jSize, float jOpacity, float jAngle) {
    vec2 uv = computeTipUV(fragPos, center, jSize, jAngle);
    if (tipUVOutOfBounds(uv)) discard;
    float stamp = sampleTipWithHardness(uv);
    float a = stamp * u_flow * jOpacity;
    return vec4(u_brushColor.rgb * a, a);
}
