#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform sampler2D u_pattern;
uniform vec2 u_layerSize;
uniform vec2 u_patternSize;
uniform float u_scale;
// Brick / half-drop stagger as a fraction of one tile: x shifts each row by
// row * u_stagger.x, y shifts each column by col * u_stagger.y.
uniform vec2 u_stagger;
// Tiling-origin shift as a fraction of one tile; moves the whole grid.
uniform vec2 u_origin;

void main() {
    vec2 tileCoord = v_uv * u_layerSize / (u_patternSize * u_scale) - u_origin;
    float col = floor(tileCoord.x);
    float row = floor(tileCoord.y);
    tileCoord.x += row * u_stagger.x;
    tileCoord.y += col * u_stagger.y;
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
