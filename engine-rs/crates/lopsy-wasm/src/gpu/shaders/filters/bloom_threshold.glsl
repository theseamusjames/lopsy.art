#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_threshold;
uniform float u_softKnee;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_tex, v_uv);
    float brightness = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float knee = u_threshold * u_softKnee;
    float soft = brightness - (u_threshold - knee);
    soft = clamp(soft / (2.0 * knee + 0.0001), 0.0, 1.0);
    soft = soft * soft;
    float contribution = max(soft, step(u_threshold, brightness));
    fragColor = vec4(c.rgb * contribution, c.a * contribution);
}
