#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_center;
uniform float u_size;
uniform float u_hardness;
uniform vec2 u_texSize;
uniform float u_exposure;
uniform sampler2D u_selectionMask;
uniform int u_hasSelection;
uniform vec2 u_docSize;
uniform vec2 u_layerOffset;
out vec4 fragColor;

void main() {
    vec2 fragPos = v_uv * u_texSize;
    float radius = u_size * 0.5;
    float dist = length(fragPos - u_center);
    if (dist > radius) discard;

    float t = clamp(dist / radius, 0.0, 1.0);
    float soft = 1.0 - t * t;
    float stamp = u_hardness + (1.0 - u_hardness) * soft;
    float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    stamp *= edge;

    if (u_hasSelection == 1) {
        vec2 docPos = fragPos + u_layerOffset;
        vec2 selUV = docPos / u_docSize;
        if (selUV.x < 0.0 || selUV.x > 1.0 || selUV.y < 0.0 || selUV.y > 1.0) discard;
        float selMask = texture(u_selectionMask, selUV).r;
        if (selMask < 0.004) discard;
        stamp *= selMask;
    }

    float strength = clamp(stamp * u_exposure, 0.0, 1.0);
    // Write same value to all channels so MAX blend keeps the highest
    // dab strength at each pixel — overlapping dabs within one stroke
    // don't compound.
    fragColor = vec4(strength, strength, strength, strength);
}
