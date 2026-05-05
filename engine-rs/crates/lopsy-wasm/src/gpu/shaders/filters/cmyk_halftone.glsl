#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_dotSize;
uniform float u_cyanAngle;
uniform float u_magentaAngle;
uniform float u_yellowAngle;
uniform float u_blackAngle;
uniform float u_softness;

out vec4 fragColor;

float halftoneChannel(vec2 pixelCoord, float value, float angle, float spacing) {
    float rad = angle * 3.14159265 / 180.0;
    float cosA = cos(rad);
    float sinA = sin(rad);
    mat2 rot = mat2(cosA, sinA, -sinA, cosA);
    vec2 rotated = rot * pixelCoord;

    vec2 cellIndex = floor(rotated / spacing);
    vec2 cellCenter = (cellIndex + 0.5) * spacing;

    vec2 delta = rotated - cellCenter;
    float dist = length(delta);

    float maxRadius = spacing * 0.5;
    float dotRadius = maxRadius * value;

    float edge = smoothstep(dotRadius + u_softness, dotRadius - u_softness, dist);
    return edge;
}

void main() {
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 pixelCoord = v_uv * texSize;

    vec4 c = texture(u_tex, v_uv);

    // Convert RGB to CMY
    float cyan = 1.0 - c.r;
    float magenta = 1.0 - c.g;
    float yellow = 1.0 - c.b;

    // Extract black (K) using UCR
    float black = min(cyan, min(magenta, yellow));
    cyan -= black;
    magenta -= black;
    yellow -= black;

    float spacing = u_dotSize;

    // Render each channel's halftone dots
    float cDot = halftoneChannel(pixelCoord, cyan, u_cyanAngle, spacing);
    float mDot = halftoneChannel(pixelCoord, magenta, u_magentaAngle, spacing);
    float yDot = halftoneChannel(pixelCoord, yellow, u_yellowAngle, spacing);
    float kDot = halftoneChannel(pixelCoord, black, u_blackAngle, spacing);

    // Convert CMYK dots back to RGB (subtractive model)
    float r = 1.0 - min(1.0, cDot + kDot);
    float g = 1.0 - min(1.0, mDot + kDot);
    float b = 1.0 - min(1.0, yDot + kDot);

    fragColor = vec4(r, g, b, c.a);
}
