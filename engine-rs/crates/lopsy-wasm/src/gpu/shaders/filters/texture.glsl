#version 300 es
precision highp float;
precision highp int;

// Unified Texture filter. Each primitive yields a zero-centred value in
// [-1, 1] that is shaped (contrast), optionally lit as a height map
// (Relief), and added to the pixel. Parameters arrive pre-validated from
// lopsy_core::filters::texture.

in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_kind;       // 0 grain, 1 rough, 2 canvas, 3 streaks, 4 cells
uniform int u_blend;      // 0 light & dark, 1 lighten, 2 darken, 3 relief
uniform float u_amount;   // 0 - 1
uniform float u_size;     // feature size, px
uniform float u_stretch;  // elongation along u_angle, >= 1
uniform float u_angle;    // radians
uniform float u_octaves;  // 1 - 6, fractional
uniform float u_contrast; // 0 - 1
uniform bool u_colored;
uniform uint u_seed;
out vec4 fragColor;

const float PI = 3.14159265359;

// PCG3D — Jarzynski & Olano, "Hash Functions for GPU Rendering" (JCGT 2020).
// Integer-only so the same seed gives bit-identical lattices on every backend.
uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
}

uvec3 hashCell(ivec2 c, uint salt) {
    // Masking keeps the int -> uint conversion defined for negative cells.
    uvec2 u = uvec2(c & ivec2(0x7FFFFFFF));
    return pcg3d(uvec3(u.x, u.y, salt * 0x9E3779B9u + 0x632BE5ABu));
}

float hash1(ivec2 c, uint salt) {
    return float(hashCell(c, salt).x) / 4294967295.0;
}

vec2 hash2(ivec2 c, uint salt) {
    return vec2(hashCell(c, salt).xy) / 4294967295.0;
}

// Gradient noise: smooth, zero-centred, and free of the axis-aligned
// blockiness value noise shows once octaves are ridged or lit.
float gradientNoise(vec2 p, uint salt) {
    vec2 i = floor(p);
    vec2 f = p - i;
    ivec2 c = ivec2(i);
    vec2 h00 = hash2(c, salt) * 2.0 - 1.0;
    vec2 h10 = hash2(c + ivec2(1, 0), salt) * 2.0 - 1.0;
    vec2 h01 = hash2(c + ivec2(0, 1), salt) * 2.0 - 1.0;
    vec2 h11 = hash2(c + ivec2(1, 1), salt) * 2.0 - 1.0;
    float a = dot(h00, f);
    float b = dot(h10, f - vec2(1.0, 0.0));
    float d = dot(h01, f - vec2(0.0, 1.0));
    float e = dot(h11, f - vec2(1.0, 1.0));
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(a, b, u.x), mix(d, e, u.x), u.y) * 2.0;
}

// Each octave is rotated (~37 degrees) as well as doubled so the lattices
// of successive octaves never line up.
const mat2 OCTAVE_STEP = mat2(1.6, 1.2, -1.2, 1.6);

float octaveWeight(int i) {
    return clamp(u_octaves - float(i), 0.0, 1.0);
}

float fbm(vec2 p, uint salt) {
    float sum = 0.0;
    float amp = 1.0;
    float norm = 0.0;
    for (int i = 0; i < 6; i++) {
        float w = octaveWeight(i);
        if (w <= 0.0) break;
        sum += gradientNoise(p, salt + uint(i) * 101u) * amp * w;
        norm += amp * w;
        p = OCTAVE_STEP * p + vec2(17.31, 9.73);
        amp *= 0.5;
    }
    return sum / norm;
}

float ridged(vec2 p, uint salt) {
    float sum = 0.0;
    float amp = 1.0;
    float norm = 0.0;
    for (int i = 0; i < 6; i++) {
        float w = octaveWeight(i);
        if (w <= 0.0) break;
        float n = 1.0 - abs(gradientNoise(p, salt + uint(i) * 101u));
        sum += n * n * amp * w;
        norm += amp * w;
        p = OCTAVE_STEP * p + vec2(17.31, 9.73);
        amp *= 0.5;
    }
    return (sum / norm - 0.45) * 2.4;
}

// Extra detail beyond the first octave, 0 - 1, for primitives that use it
// as an amount rather than an octave count.
float detailAmount() {
    return (u_octaves - 1.0) / 5.0;
}

float canvasWeave(vec2 q, uint salt) {
    vec2 cell = floor(q);
    vec2 f = q - cell;
    ivec2 c = ivec2(cell);
    bool isWarpOnTop = ((c.x + c.y) & 1) == 0;
    float across = sin(PI * f.x);
    float along = sin(PI * f.y);
    float h = isWarpOnTop ? across * (0.55 + 0.45 * along) : along * (0.55 + 0.45 * across);
    float tone = isWarpOnTop ? hash1(ivec2(c.x, 0), salt + 7u) : hash1(ivec2(0, c.y), salt + 13u);
    vec2 fiberQ = isWarpOnTop ? vec2(q.x * 6.0, q.y * 0.75) : vec2(q.x * 0.75, q.y * 6.0);
    float fiber = fbm(fiberQ, salt + 29u);
    h = h * (0.8 + 0.4 * (tone - 0.5)) + fiber * 0.4 * detailAmount();
    return h * 2.0 - 1.0;
}

float cells(vec2 q, uint salt) {
    float warp = detailAmount();
    if (warp > 0.0) {
        q += vec2(fbm(q * 0.5, salt + 41u), fbm(q * 0.5 + vec2(5.2, 1.3), salt + 43u)) * warp * 0.6;
    }
    vec2 cell = floor(q);
    vec2 f = q - cell;
    ivec2 c = ivec2(cell);
    float f1 = 8.0;
    float f2 = 8.0;
    float tone = 0.5;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            ivec2 o = ivec2(x, y);
            vec2 pt = vec2(o) + 0.05 + 0.9 * hash2(c + o, salt + 3u);
            float d = length(pt - f);
            if (d < f1) {
                f2 = f1;
                f1 = d;
                tone = hash1(c + o, salt + 5u);
            } else if (d < f2) {
                f2 = d;
            }
        }
    }
    float edge = clamp((f2 - f1) * 2.5, 0.0, 1.0);
    return mix(edge, tone, 0.25) * 2.0 - 1.0;
}

vec2 toPattern(vec2 pos, float extraStretch) {
    vec2 dir = vec2(cos(u_angle), sin(u_angle));
    vec2 perp = vec2(-dir.y, dir.x);
    return vec2(dot(pos, dir) / (u_size * u_stretch * extraStretch), dot(pos, perp) / u_size);
}

float pattern(vec2 pos, uint salt) {
    if (u_kind == 1) return ridged(toPattern(pos, 1.0), salt);
    if (u_kind == 2) return canvasWeave(toPattern(pos, 1.0), salt);
    if (u_kind == 3) return fbm(toPattern(pos, 16.0), salt) * 2.0;
    if (u_kind == 4) return cells(toPattern(pos, 1.0), salt);
    return fbm(toPattern(pos, 1.0), salt) * 2.0;
}

float shaped(vec2 pos, uint salt) {
    return clamp(pattern(pos, salt) * (1.0 + 4.0 * u_contrast), -1.0, 1.0);
}

float relief(vec2 pos, uint salt) {
    float h = shaped(pos, salt);
    // Slopes are per pixel; scaling by the feature size keeps the bevel
    // depth similar whether the features are 2 px or 200 px across.
    float k = 0.6 * max(u_size, 1.0);
    vec2 g = vec2(shaped(pos + vec2(1.0, 0.0), salt) - h, shaped(pos + vec2(0.0, 1.0), salt) - h) * k;
    vec3 n = normalize(vec3(-g, 1.0));
    // Texture row 0 is the top of the image, so the light sits up and left.
    vec3 light = normalize(vec3(-0.5, -0.5, 0.7));
    return clamp((dot(n, light) - light.z) * 1.5, -1.0, 1.0);
}

float textureValue(vec2 pos, uint salt) {
    if (u_blend == 3) return relief(pos, salt);
    float t = shaped(pos, salt);
    if (u_blend == 1) return max(t, 0.0);
    if (u_blend == 2) return min(t, 0.0);
    return t;
}

void main() {
    vec4 c = texture(u_tex, v_uv);
    if (c.a <= 0.0) {
        fragColor = c;
        return;
    }
    vec2 pos = gl_FragCoord.xy;
    vec3 t;
    if (u_colored) {
        t = vec3(
            textureValue(pos, u_seed),
            textureValue(pos, u_seed + 7919u),
            textureValue(pos, u_seed + 15887u)
        );
    } else {
        t = vec3(textureValue(pos, u_seed));
    }
    fragColor = vec4(clamp(c.rgb + t * (u_amount * 0.6), 0.0, 1.0), c.a);
}
