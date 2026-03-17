#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_blurredTex;
uniform float u_amount;
uniform float u_threshold;
out vec4 fragColor;
void main() {
    vec4 orig = texture(u_tex, v_uv);
    vec4 blur = texture(u_blurredTex, v_uv);
    vec3 diff = orig.rgb - blur.rgb;
    vec3 mask = step(vec3(u_threshold / 255.0), abs(diff));
    fragColor = vec4(clamp(orig.rgb + diff * u_amount * mask, 0.0, 1.0), orig.a);
}
