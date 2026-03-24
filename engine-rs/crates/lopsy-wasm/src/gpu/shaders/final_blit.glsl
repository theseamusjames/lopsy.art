#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_compositeTex;
uniform vec2 u_resolution;
uniform float u_zoom;
uniform vec2 u_pan;
uniform vec2 u_docSize;
uniform float u_bgAlpha;
out vec4 fragColor;

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

    // Checkerboard for transparent areas — only on transparent documents.
    // For opaque documents (bgAlpha >= 1.0), the composite alpha is always 1.0;
    // any deviation is a GPU precision artifact from RGBA16F rendering,
    // not real transparency.
    bool isTransparentDoc = u_bgAlpha < 0.999;
    if (isTransparentDoc && color.a < 1.0 - 1.0/256.0) {
        vec2 checker = floor(canvasPos / 8.0);
        float check = mod(checker.x + checker.y, 2.0);
        vec3 bg = mix(vec3(0.8), vec3(0.9), check);
        color.rgb = color.rgb * color.a + bg * (1.0 - color.a);
        color.a = 1.0;
    }

    // Pixel data is already sRGB from ImageData — pass through directly
    fragColor = color;
}
