#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_dotSize;
uniform float u_angle;
uniform float u_contrast;

out vec4 fragColor;

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 pixelCoord = v_uv * texSize;

    // Rotate coordinates by the halftone angle
    float rad = u_angle * 3.14159265 / 180.0;
    float cosA = cos(rad);
    float sinA = sin(rad);
    mat2 rot = mat2(cosA, sinA, -sinA, cosA);
    vec2 rotated = rot * pixelCoord;

    // Find the center of the nearest halftone cell
    vec2 cellIndex = floor(rotated / u_dotSize);
    vec2 cellCenter = (cellIndex + 0.5) * u_dotSize;

    // Rotate cell center back to sample the original image
    mat2 invRot = mat2(cosA, -sinA, sinA, cosA);
    vec2 samplePos = invRot * cellCenter;
    vec2 sampleUV = samplePos / texSize;

    // Clamp UV to avoid sampling outside texture
    sampleUV = clamp(sampleUV, vec2(0.0), vec2(1.0));

    // Sample color at cell center
    vec4 c = texture(u_tex, sampleUV);

    // Convert to luminance for dot size calculation
    float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));

    // Distance from pixel to cell center in rotated space
    vec2 delta = rotated - cellCenter;
    float dist = length(delta);

    // Dot radius is proportional to luminance (brighter = smaller dot for CMYK-style)
    // Invert so dark areas get big dots, light areas get small dots
    float maxRadius = u_dotSize * 0.5;
    float dotRadius = maxRadius * (1.0 - lum);

    // Apply contrast to sharpen/soften dot edges
    float edge = smoothstep(dotRadius + u_contrast, dotRadius - u_contrast, dist);

    // Output: dot color where inside dot, white where outside
    vec3 result = mix(vec3(1.0), c.rgb, edge);

    fragColor = vec4(result, c.a);
}
