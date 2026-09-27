#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform sampler2D u_pattern;
uniform vec2 u_layerSize;
uniform vec2 u_patternSize;
uniform float u_scale;
uniform vec2 u_offset;

void main() {
    vec2 tileCoord = v_uv * u_layerSize / (u_patternSize * u_scale);
    float col = floor(tileCoord.x);
    float row = floor(tileCoord.y);
    tileCoord.x += row * u_offset.x;
    tileCoord.y += col * u_offset.y;
    vec4 src = texture(u_pattern, fract(tileCoord));
    vec4 dst = texture(u_tex, v_uv);
    // #942: composite the tile "over" the existing pixels (straight alpha)
    // instead of replacing them, so transparent tile areas keep the layer.
    float outA = src.a + dst.a * (1.0 - src.a);
    if (outA < 1e-6) {
        fragColor = vec4(0.0);
        return;
    }
    vec3 rgb = (src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / outA;
    fragColor = vec4(rgb, outA);
}
