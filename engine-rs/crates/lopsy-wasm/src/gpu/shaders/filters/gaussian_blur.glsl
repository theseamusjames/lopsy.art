#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;
uniform float u_weights[64];
uniform int u_radius;
out vec4 fragColor;
void main() {
    vec2 texelSize = 1.0 / vec2(textureSize(u_tex, 0));
    // The layer texture is straight alpha, so premultiply each tap before
    // the weighted sum — otherwise a transparent tap's RGB (typically 0)
    // drags the blurred edge color toward black/grey, then blend.glsl
    // composites that as straight alpha and doubles the darkening (#919).
    vec4 c0 = texture(u_tex, v_uv);
    vec4 result = vec4(c0.rgb * c0.a, c0.a) * u_weights[0];
    for (int i = 1; i <= 63; i++) {
        if (i > u_radius) break;
        vec2 offset = u_direction * float(i) * texelSize;
        vec4 cp = texture(u_tex, v_uv + offset);
        vec4 cn = texture(u_tex, v_uv - offset);
        result += vec4(cp.rgb * cp.a, cp.a) * u_weights[i];
        result += vec4(cn.rgb * cn.a, cn.a) * u_weights[i];
    }
    fragColor = result.a > 1e-6 ? vec4(result.rgb / result.a, result.a) : vec4(0.0);
}
