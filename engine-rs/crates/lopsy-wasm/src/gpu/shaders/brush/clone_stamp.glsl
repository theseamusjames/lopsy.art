#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sourceTex;
uniform sampler2D u_stampTex;
uniform vec2 u_sourceOffset;
uniform vec2 u_center;
uniform float u_size;
uniform vec2 u_texSize;
out vec4 fragColor;

void main() {
    vec2 fragPos = v_uv * u_texSize;
    vec4 existing = texture(u_sourceTex, v_uv);

    // Only apply within the dab circle
    float radius = u_size * 0.5;
    float dist = length(fragPos - u_center);
    if (dist > radius) {
        fragColor = existing;
        return;
    }

    // Compute stamp falloff (same as brush_dab)
    float t = clamp(dist / radius, 0.0, 1.0);
    float soft = 1.0 - t * t;
    float stamp = 0.8 + (1.0 - 0.8) * soft; // hardness=0.8
    float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    stamp *= edge;

    // Sample source at offset position
    vec2 sourceUV = (fragPos + u_sourceOffset) / u_texSize;
    if (sourceUV.x < 0.0 || sourceUV.x > 1.0 || sourceUV.y < 0.0 || sourceUV.y > 1.0) {
        fragColor = existing;
        return;
    }
    vec4 source = texture(u_sourceTex, sourceUV);

    // Blend source onto existing using stamp as alpha
    float a = source.a * stamp;
    vec3 blended = source.rgb * a + existing.rgb * (1.0 - a);
    float outA = a + existing.a * (1.0 - a);
    fragColor = vec4(blended, outA);
}
