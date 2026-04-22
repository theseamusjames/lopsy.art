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
    fragColor = texture(u_pattern, fract(tileCoord));
}
