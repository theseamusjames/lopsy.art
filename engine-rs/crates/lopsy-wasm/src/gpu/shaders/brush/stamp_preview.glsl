#version 300 es
precision highp float;
in vec2 v_uv;
// Clone Stamp / Healing Brush source preview: inside the brush disc at
// u_cursor, show the active layer as it is at u_source. The screen ↔
// document mapping matches final_blit.glsl.
uniform sampler2D u_layerTex;
uniform vec2 u_resolution;
uniform float u_zoom;
uniform vec2 u_pan;
uniform vec2 u_docSize;
uniform vec2 u_cursor;
uniform vec2 u_source;
uniform float u_radius;
uniform vec2 u_layerOrigin;
uniform vec2 u_layerSize;
uniform float u_opacity;
out vec4 fragColor;

void main() {
    vec2 screenPos = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;
    vec2 docPos = (screenPos - u_resolution * 0.5 - u_pan) / u_zoom + u_docSize * 0.5;
    if (length(docPos - u_cursor) > u_radius) discard;

    vec2 layerUV = (docPos + (u_source - u_cursor) - u_layerOrigin) / u_layerSize;
    if (any(lessThan(layerUV, vec2(0.0))) || any(greaterThan(layerUV, vec2(1.0)))) discard;

    vec4 c = texture(u_layerTex, layerUV);
    fragColor = vec4(c.rgb, c.a * u_opacity);
}
