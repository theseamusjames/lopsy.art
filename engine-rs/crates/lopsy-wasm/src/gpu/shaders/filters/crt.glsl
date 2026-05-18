#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_scanlineIntensity; // 0.0 - 1.0
uniform float u_scanlineSpacing;   // 1.0 - 8.0 px
uniform float u_curvature;         // 0.0 - 1.0
uniform float u_phosphor;          // 0.0 - 1.0
uniform float u_vignette;          // 0.0 - 1.0

out vec4 fragColor;

vec2 barrelDistort(vec2 uv, float k) {
    vec2 c = uv - 0.5;
    float r2 = dot(c, c);
    return c * (1.0 + k * r2 + k * k * r2 * r2) + 0.5;
}

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    float k = u_curvature * 0.4;
    vec2 uv = barrelDistort(v_uv, k);

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        fragColor = vec4(0.0);
        return;
    }

    float px = 1.0 / texSize.x;
    vec4 color;

    if (u_phosphor > 0.0) {
        float subpx = px * u_phosphor * 0.5;
        color.r = texture(u_tex, uv + vec2(-subpx, 0.0)).r;
        color.g = texture(u_tex, uv).g;
        color.b = texture(u_tex, uv + vec2(subpx, 0.0)).b;
        color.a = texture(u_tex, uv).a;

        float bloom = u_phosphor * 0.12;
        vec4 left  = texture(u_tex, uv + vec2(-px, 0.0));
        vec4 right = texture(u_tex, uv + vec2( px, 0.0));
        color.rgb += (left.rgb + right.rgb) * bloom * 0.5;
    } else {
        color = texture(u_tex, uv);
    }

    float pixelY = uv.y * texSize.y;
    float phase = pixelY * 3.14159265 / u_scanlineSpacing;
    float scan = sin(phase);
    scan *= scan;
    color.rgb *= 1.0 - u_scanlineIntensity * (1.0 - scan);

    if (u_vignette > 0.0) {
        vec2 d = (uv - 0.5) * 2.0;
        float vig = 1.0 - dot(d, d) * u_vignette * 0.5;
        color.rgb *= clamp(vig, 0.0, 1.0);
    }

    fragColor = color;
}
