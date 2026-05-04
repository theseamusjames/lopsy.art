#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_layerTex;
uniform vec2 u_center;
uniform float u_size;
uniform vec2 u_texSize;
uniform vec2 u_sourceOffset;
uniform float u_opacity;
uniform vec2 u_srcMean;
uniform vec2 u_dstMean;
// srcMean/dstMean packed as (r, g) in u_srcMean and (b, _) plus (r, g) in u_dstMean
// Actually we'll pass full vec3 means as two uniforms:
uniform vec3 u_srcMeanRGB;
uniform vec3 u_dstMeanRGB;
out vec4 fragColor;

void main() {
    vec2 fragPos = v_uv * u_texSize;
    vec4 existing = texture(u_layerTex, v_uv);

    float radius = u_size * 0.5;
    float dist = length(fragPos - u_center);
    if (dist > radius) {
        fragColor = existing;
        return;
    }

    // Soft falloff within the dab
    float t = clamp(dist / radius, 0.0, 1.0);
    float soft = 1.0 - t * t;
    float edge = 1.0 - smoothstep(radius - 1.0, radius, dist);
    float stamp = soft * edge;

    // Sample source at offset position
    vec2 sourceUV = (fragPos + u_sourceOffset) / u_texSize;
    if (sourceUV.x < 0.0 || sourceUV.x > 1.0 || sourceUV.y < 0.0 || sourceUV.y > 1.0) {
        fragColor = existing;
        return;
    }
    vec4 source = texture(u_layerTex, sourceUV);

    // Healing: preserve source texture, match destination color
    // healed = source - srcMean + dstMean
    vec3 healed = source.rgb - u_srcMeanRGB + u_dstMeanRGB;
    healed = clamp(healed, 0.0, 1.0);

    // Blend healed onto existing using stamp * opacity
    float a = source.a * stamp * u_opacity;
    vec3 blended = healed * a + existing.rgb * (1.0 - a);
    float outA = a + existing.a * (1.0 - a);
    fragColor = vec4(blended, outA);
}
