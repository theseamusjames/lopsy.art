#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_tex;
// amount in [-1.0, 1.0]: positive = spherize (barrel), negative = pinch
uniform float u_amount;
// mode: 0 = normal (radial), 1 = horizontal only, 2 = vertical only
uniform int u_mode;
out vec4 fragColor;

void main() {
    // Map uv to [-1, 1] centered coordinates
    vec2 centered = v_uv * 2.0 - 1.0;

    vec2 srcCentered = centered;

    if (u_mode == 1) {
        // Horizontal only — distort x-axis only
        float x = centered.x;
        float maxR = 1.0;
        float r = abs(x);
        float rNew = r + u_amount * r * (1.0 - r / maxR);
        srcCentered.x = sign(x) * rNew;
    } else if (u_mode == 2) {
        // Vertical only — distort y-axis only
        float y = centered.y;
        float maxR = 1.0;
        float r = abs(y);
        float rNew = r + u_amount * r * (1.0 - r / maxR);
        srcCentered.y = sign(y) * rNew;
    } else {
        // Normal: radial distortion
        float maxR = sqrt(2.0);
        float r = length(centered);
        if (r > 0.0) {
            float rNew = r + u_amount * r * (1.0 - r / maxR);
            srcCentered = (centered / r) * rNew;
        }
    }

    // Map back to [0, 1] UV space
    vec2 srcUv = srcCentered * 0.5 + 0.5;

    // Out-of-bounds: transparent
    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
        fragColor = vec4(0.0);
        return;
    }

    fragColor = texture(u_tex, srcUv);
}
