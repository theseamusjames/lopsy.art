
vec4 computeDab(vec2 fragPos, vec2 center, float jSize, float jOpacity, float jAngle) {
    float radius = jSize * 0.5;
    float stamp = circleStamp(fragPos, center, radius);
    if (stamp < 0.0) discard;
    float a = stamp * u_flow * jOpacity;
    return vec4(u_brushColor.rgb * a, a);
}
