#version 300 es
precision highp float;
precision highp int;

// One step of the content-bounds reduction (#1021). Each output texel
// ORs together `u_span` source texels along `u_axis`, starting at
// `outputCoord * stride` where the stride is `u_span` on the reduced
// axis and 1 on the other. Output is 1.0 where any of them is occupied.
//
// With `u_alphaTest` = 1 the source is a layer texture and "occupied"
// means the alpha a u8 readback would report as non-zero:
// round(clamp(a) * 255) > 0, the same test `crop_to_content_bounds`
// applies on the CPU (`read_rgba` rounds float alpha with +0.5). With
// `u_alphaTest` = 0 the source is a previous step's output (R = 0 or 1).

uniform sampler2D u_src;
uniform ivec2 u_axis;
uniform int u_span;
uniform ivec2 u_srcSize;
uniform int u_alphaTest;

out vec4 fragColor;

void main() {
    ivec2 outCoord = ivec2(gl_FragCoord.xy);
    ivec2 stride = ivec2(1) + u_axis * (u_span - 1);
    ivec2 base = outCoord * stride;
    float occupied = 0.0;
    for (int i = 0; i < u_span; i++) {
        ivec2 q = base + u_axis * i;
        if (q.x >= u_srcSize.x || q.y >= u_srcSize.y) break;
        vec4 t = texelFetch(u_src, q, 0);
        bool hit = u_alphaTest == 1
            ? clamp(t.a, 0.0, 1.0) * 255.0 + 0.5 >= 1.0
            : t.r > 0.5;
        if (hit) {
            occupied = 1.0;
            break;
        }
    }
    fragColor = vec4(occupied);
}
