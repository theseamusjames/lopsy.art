
vec4 computeDab(vec2 fragPos, vec2 center, float jSize, float jOpacity, float jAngle) {
    vec2 uv = computeTipUV(fragPos, center, jSize, jAngle);
    if (tipUVOutOfBounds(uv)) discard;
    vec4 tipColor = texture(u_brushTip, uv);
    return tipColor * (u_flow * jOpacity);
}
