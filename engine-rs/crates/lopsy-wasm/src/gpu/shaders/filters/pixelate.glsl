#version 300 es
precision highp float;

// Pixelate pass 2: every pixel takes its block's averaged colour and alpha
// (from pixelate_blocks.glsl), but only where the source pixel had any
// coverage (#1167). Point-sampling the block centre used to delete a
// partial block whose centre fell outside the content and grow one whose
// centre fell inside it; keeping the source footprint does neither.

uniform sampler2D u_tex;
uniform sampler2D u_blocks;
uniform int u_blockSize;

out vec4 fragColor;

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    if (texelFetch(u_tex, p, 0).a <= 0.0) {
        fragColor = vec4(0.0);
        return;
    }
    fragColor = texelFetch(u_blocks, p / u_blockSize, 0);
}
