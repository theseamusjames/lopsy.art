#version 300 es
precision highp float;

// Pixelate pass 1: one fragment per block. Rendered into a
// ceil(w / block) x ceil(h / block) viewport, so the pass reads each layer
// texel exactly once however large the block is.
//
// Output: rgb = alpha-weighted mean colour of the block (transparent texels
// don't darken it), a = mean alpha of the block's non-transparent texels.
// Blocks clipped by the texture edge average only the texels inside it.

uniform sampler2D u_tex;
uniform int u_blockSize;

out vec4 fragColor;

void main() {
    ivec2 texSize = textureSize(u_tex, 0);
    ivec2 origin = ivec2(gl_FragCoord.xy) * u_blockSize;
    ivec2 end = min(origin + ivec2(u_blockSize), texSize);

    vec3 colorSum = vec3(0.0);
    float alphaSum = 0.0;
    float covered = 0.0;
    for (int y = origin.y; y < end.y; y++) {
        for (int x = origin.x; x < end.x; x++) {
            vec4 c = texelFetch(u_tex, ivec2(x, y), 0);
            colorSum += c.rgb * c.a;
            alphaSum += c.a;
            covered += c.a > 0.0 ? 1.0 : 0.0;
        }
    }

    if (alphaSum <= 0.0) {
        fragColor = vec4(0.0);
        return;
    }
    fragColor = vec4(colorSum / alphaSum, alphaSum / covered);
}
