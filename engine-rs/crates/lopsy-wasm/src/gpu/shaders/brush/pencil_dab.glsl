#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec4 u_color;
uniform vec2 u_center;
uniform float u_size;
uniform vec2 u_texSize;
uniform sampler2D u_selectionMask;
uniform int u_hasSelection;
uniform vec2 u_docSize;
uniform vec2 u_layerOffset;
out vec4 fragColor;

// Pencil renders hard, aliased square pixel blocks — no edge feathering.
// The block geometry mirrors the former CPU path: an integer cell centered
// on floor(center), spanning `floor(size/2)` on each side for `ceil(size)`
// pixels total, so the on-screen result is pixel-identical to before but
// computed on the GPU.
void main() {
    vec2 fragPos = v_uv * u_texSize;
    vec2 p = floor(fragPos);
    vec2 c = floor(u_center);
    float half_ = floor(u_size * 0.5);
    float block = ceil(u_size);
    vec2 lo = c - half_;
    vec2 hi = lo + block;
    if (p.x < lo.x || p.x >= hi.x || p.y < lo.y || p.y >= hi.y) discard;

    float a = u_color.a;
    if (u_hasSelection == 1) {
        vec2 docPos = fragPos + u_layerOffset;
        vec2 selUV = docPos / u_docSize;
        if (selUV.x < 0.0 || selUV.x > 1.0 || selUV.y < 0.0 || selUV.y > 1.0) discard;
        float selMask = texture(u_selectionMask, selUV).r;
        if (selMask < 0.004) discard;
        a *= selMask;
    }

    fragColor = vec4(u_color.rgb * a, a);
}
