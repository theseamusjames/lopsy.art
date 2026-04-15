#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_existingTex;
uniform sampler2D u_historyTex;
uniform vec2 u_center;
uniform float u_size;
uniform float u_hardness;
uniform float u_opacity;
uniform vec2 u_texSize;
uniform sampler2D u_selectionMask;
uniform int u_hasSelection;
uniform vec2 u_layerOffset;
uniform vec2 u_docSize;
out vec4 fragColor;

void main() {
    vec2 fragPos = v_uv * u_texSize;
    vec4 existing = texture(u_existingTex, v_uv);

    float radius = u_size * 0.5;
    float dist = length(fragPos - u_center);
    if (dist > radius) {
        fragColor = existing;
        return;
    }

    // Same soft/hard falloff as brush_dab
    float t = clamp(dist / radius, 0.0, 1.0);
    float soft = 1.0 - t * t;
    float stamp = u_hardness + (1.0 - u_hardness) * soft;
    float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    stamp *= edge * u_opacity;

    if (u_hasSelection == 1) {
        vec2 docPos = (fragPos + u_layerOffset) / u_docSize;
        if (docPos.x < 0.0 || docPos.x > 1.0 || docPos.y < 0.0 || docPos.y > 1.0) {
            fragColor = existing;
            return;
        }
        float sel = texture(u_selectionMask, docPos).r;
        stamp *= sel;
    }

    vec4 source = texture(u_historyTex, v_uv);

    // Transparent source pixels should leave the existing pixel alone
    // (same semantics as clone_stamp — painting a transparent source
    // over opaque content is a no-op).
    float a = source.a * stamp;
    vec3 blended = source.rgb * a + existing.rgb * (1.0 - a);
    float outA = a + existing.a * (1.0 - a);
    fragColor = vec4(blended, outA);
}
