#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_compositeTex;
uniform vec2 u_resolution;
uniform float u_zoom;
uniform vec2 u_pan;
uniform vec2 u_docSize;
out vec4 fragColor;

// sRGB OETF
vec3 linearToSrgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(c, vec3(1.0/2.4)) - 0.055;
    return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
    // Convert screen UV to canvas coordinates
    vec2 screenPos = v_uv * u_resolution;
    vec2 center = u_resolution * 0.5;
    vec2 canvasPos = (screenPos - center) / u_zoom + u_pan;

    // Map canvas coordinates to document UV
    vec2 docUV = canvasPos / u_docSize;

    // Check if within document bounds
    if (docUV.x < 0.0 || docUV.x > 1.0 || docUV.y < 0.0 || docUV.y > 1.0) {
        // Outside document: dark gray background
        fragColor = vec4(0.18, 0.18, 0.18, 1.0);
        return;
    }

    vec4 color = texture(u_compositeTex, docUV);

    // Checkerboard for transparent areas
    if (color.a < 1.0) {
        vec2 checker = floor(canvasPos / 8.0);
        float check = mod(checker.x + checker.y, 2.0);
        vec3 bg = mix(vec3(0.8), vec3(0.9), check);
        color.rgb = color.rgb * color.a + bg * (1.0 - color.a);
        color.a = 1.0;
    }

    // Linear to sRGB
    fragColor = vec4(linearToSrgb(color.rgb), color.a);
}
