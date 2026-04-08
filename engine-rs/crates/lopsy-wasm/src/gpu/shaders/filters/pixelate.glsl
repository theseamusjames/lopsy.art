#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_blockSize;

out vec4 fragColor;

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 blockPx = vec2(u_blockSize) / texSize;
    vec2 blockUV = floor(v_uv / blockPx) * blockPx + blockPx * 0.5;
    fragColor = texture(u_tex, blockUV);
}
