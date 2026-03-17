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
    // Convert screen UV to canvas coordinates.
    // v_uv.y=0 is bottom in WebGL; screen Y=0 is top. Flip Y.
    vec2 screenPos = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;

    // Canvas 2D convention: pan is in screen pixels, (0,0) centers the document.
    // screenPos = (canvasPos - docCenter) * zoom + screenCenter + pan
    // => canvasPos = (screenPos - screenCenter - pan) / zoom + docCenter
    vec2 center = u_resolution * 0.5;
    vec2 canvasPos = (screenPos - center - u_pan) / u_zoom + u_docSize * 0.5;

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

    // Pixel data is already sRGB from ImageData — pass through directly
    fragColor = color;
}
