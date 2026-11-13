#version 300 es
precision highp float;
in vec2 v_uv;
// Clone Stamp / Healing Brush source preview: inside the brush disc at
// u_cursor, show the active layer as it is at u_source. The screen ↔
// document mapping matches final_blit.glsl.
uniform sampler2D u_layerTex;
layout(std140) uniform Params {
    vec2 u_resolution;
    float u_zoom;
    vec2 u_pan;
    vec2 u_docSize;
    vec2 u_cursor;
    vec2 u_source;
    float u_radius;
    vec2 u_layerOrigin;
    vec2 u_layerSize;
    float u_opacity;
};
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
