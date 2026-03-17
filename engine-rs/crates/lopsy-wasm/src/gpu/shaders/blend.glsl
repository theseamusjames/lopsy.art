#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_srcTex;
uniform sampler2D u_dstTex;
uniform float u_opacity;
uniform int u_blendMode;
out vec4 fragColor;

// RGB <-> HSL helpers
float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
}

vec3 rgb2hsl(vec3 c) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float l = (mx + mn) * 0.5;
    if (mx - mn < 0.00001) return vec3(0.0, 0.0, l);
    float d = mx - mn;
    float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    float h;
    if (mx == c.r) { h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0); }
    else if (mx == c.g) { h = (c.b - c.r) / d + 2.0; }
    else { h = (c.r - c.g) / d + 4.0; }
    h /= 6.0;
    return vec3(h, s, l);
}

vec3 hsl2rgb(vec3 hsl) {
    if (hsl.y < 0.00001) return vec3(hsl.z);
    float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
    float p = 2.0 * hsl.z - q;
    return vec3(
        hue2rgb(p, q, hsl.x + 1.0/3.0),
        hue2rgb(p, q, hsl.x),
        hue2rgb(p, q, hsl.x - 1.0/3.0)
    );
}

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec3 setLum(vec3 c, float l) {
    float d = l - lum(c);
    c += d;
    float n = min(min(c.r, c.g), c.b);
    float x = max(max(c.r, c.g), c.b);
    if (n < 0.0) { float ln = lum(c); c = ln + (c - ln) * ln / (ln - n); }
    if (x > 1.0) { float ln = lum(c); c = ln + (c - ln) * (1.0 - ln) / (x - ln); }
    return c;
}

float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }

vec3 blendMode(vec3 s, vec3 d) {
    if (u_blendMode == 0) return s; // Normal
    if (u_blendMode == 1) return s * d; // Multiply
    if (u_blendMode == 2) return s + d - s * d; // Screen
    if (u_blendMode == 3) { // Overlay
        return vec3(
            d.r < 0.5 ? 2.0*s.r*d.r : 1.0-2.0*(1.0-s.r)*(1.0-d.r),
            d.g < 0.5 ? 2.0*s.g*d.g : 1.0-2.0*(1.0-s.g)*(1.0-d.g),
            d.b < 0.5 ? 2.0*s.b*d.b : 1.0-2.0*(1.0-s.b)*(1.0-d.b)
        );
    }
    if (u_blendMode == 4) return min(s, d); // Darken
    if (u_blendMode == 5) return max(s, d); // Lighten
    if (u_blendMode == 6) { // ColorDodge
        return vec3(
            s.r >= 1.0 ? 1.0 : min(1.0, d.r / (1.0 - s.r)),
            s.g >= 1.0 ? 1.0 : min(1.0, d.g / (1.0 - s.g)),
            s.b >= 1.0 ? 1.0 : min(1.0, d.b / (1.0 - s.b))
        );
    }
    if (u_blendMode == 7) { // ColorBurn
        return vec3(
            s.r <= 0.0 ? 0.0 : max(0.0, 1.0 - (1.0 - d.r) / s.r),
            s.g <= 0.0 ? 0.0 : max(0.0, 1.0 - (1.0 - d.g) / s.g),
            s.b <= 0.0 ? 0.0 : max(0.0, 1.0 - (1.0 - d.b) / s.b)
        );
    }
    if (u_blendMode == 8) { // HardLight
        return vec3(
            s.r < 0.5 ? 2.0*s.r*d.r : 1.0-2.0*(1.0-s.r)*(1.0-d.r),
            s.g < 0.5 ? 2.0*s.g*d.g : 1.0-2.0*(1.0-s.g)*(1.0-d.g),
            s.b < 0.5 ? 2.0*s.b*d.b : 1.0-2.0*(1.0-s.b)*(1.0-d.b)
        );
    }
    if (u_blendMode == 9) { // SoftLight (W3C)
        vec3 dd = mix(sqrt(d), ((16.0*d - 12.0)*d + 4.0)*d, step(d, vec3(0.25)));
        return mix(
            d - (1.0 - 2.0*s) * d * (1.0 - d),
            d + (2.0*s - 1.0) * (dd - d),
            step(vec3(0.5), s)
        );
    }
    if (u_blendMode == 10) return abs(s - d); // Difference
    if (u_blendMode == 11) return s + d - 2.0*s*d; // Exclusion
    if (u_blendMode == 12) { // Hue
        vec3 shsl = rgb2hsl(s);
        vec3 dhsl = rgb2hsl(d);
        return setLum(hsl2rgb(vec3(shsl.x, dhsl.y, 0.5)), lum(d));
    }
    if (u_blendMode == 13) { // Saturation
        float ss = sat(s);
        return setLum(hsl2rgb(vec3(rgb2hsl(d).x, ss > 0.0 ? ss : rgb2hsl(d).y, 0.5)), lum(d));
    }
    if (u_blendMode == 14) { // Color
        return setLum(s, lum(d));
    }
    if (u_blendMode == 15) { // Luminosity
        return setLum(d, lum(s));
    }
    return s;
}

void main() {
    vec4 src = texture(u_srcTex, v_uv);
    vec4 dst = texture(u_dstTex, v_uv);

    float sa = src.a * u_opacity;
    float da = dst.a;

    if (sa < 0.001) { fragColor = dst; return; }
    if (da < 0.001) { fragColor = vec4(src.rgb, sa); return; }

    vec3 blended = blendMode(src.rgb, dst.rgb);
    float outA = sa + da * (1.0 - sa);

    vec3 outRGB = (sa * da * blended + sa * (1.0 - da) * src.rgb + da * (1.0 - sa) * dst.rgb) / outA;

    fragColor = vec4(outRGB, outA);
}
