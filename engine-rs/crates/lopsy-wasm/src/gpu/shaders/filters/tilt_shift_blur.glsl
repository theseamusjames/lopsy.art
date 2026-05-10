#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform float u_focusPosition;
uniform float u_focusWidth;
uniform float u_blurRadius;
uniform float u_angle;

float computeBlurAmount(vec2 uv) {
    vec2 centered = uv - 0.5;
    float cosA = cos(u_angle);
    float sinA = sin(u_angle);
    float projected = centered.x * (-sinA) + centered.y * cosA + 0.5;

    float dist = abs(projected - u_focusPosition);
    float halfWidth = u_focusWidth * 0.5;
    float t = smoothstep(halfWidth, halfWidth + 0.15, dist);
    return t;
}

// Poisson disc samples (28 points) for natural-looking blur
const int NUM_SAMPLES = 28;
const vec2 poissonDisk[28] = vec2[28](
    vec2(-0.613392, 0.617481),
    vec2( 0.170019,-0.040254),
    vec2(-0.299417, 0.791925),
    vec2( 0.645680, 0.493210),
    vec2(-0.651784, 0.717887),
    vec2( 0.421003, 0.027070),
    vec2(-0.817194,-0.271096),
    vec2(-0.705374,-0.668203),
    vec2( 0.977050,-0.108615),
    vec2( 0.063326, 0.142369),
    vec2( 0.203528, 0.214331),
    vec2(-0.667531, 0.326090),
    vec2(-0.098422,-0.295755),
    vec2(-0.885922, 0.215369),
    vec2( 0.566637, 0.605213),
    vec2( 0.039766,-0.396100),
    vec2( 0.751946, 0.453352),
    vec2( 0.078707,-0.715323),
    vec2(-0.075838,-0.529344),
    vec2( 0.724479,-0.580798),
    vec2( 0.222999,-0.215125),
    vec2(-0.467574,-0.405438),
    vec2(-0.248268,-0.814753),
    vec2( 0.354411,-0.887570),
    vec2( 0.175817, 0.382366),
    vec2( 0.487472,-0.063082),
    vec2(-0.084078, 0.898312),
    vec2( 0.488876,-0.783441)
);

void main() {
    float blurAmount = computeBlurAmount(v_uv);

    if (blurAmount < 0.01) {
        fragColor = texture(u_tex, v_uv);
        return;
    }

    vec2 texelSize = 1.0 / vec2(textureSize(u_tex, 0));
    float radius = blurAmount * u_blurRadius;

    vec4 accum = texture(u_tex, v_uv);
    float totalWeight = 1.0;

    for (int i = 0; i < NUM_SAMPLES; i++) {
        vec2 offset = poissonDisk[i] * radius * texelSize;
        float d = length(poissonDisk[i]);
        float w = 1.0 - d * 0.3;
        accum += texture(u_tex, v_uv + offset) * w;
        totalWeight += w;
    }

    fragColor = accum / totalWeight;
}
