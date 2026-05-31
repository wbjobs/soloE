uniform float score;
uniform vec3 backgroundColor;
uniform vec3 textColor;
uniform vec3 glowColor;

varying vec2 vUv;

float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

float sdRect(vec2 p, vec2 size, float radius) {
    size -= radius;
    vec2 d = abs(p) - size;
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - radius;
}

float digit0(vec2 p) {
    float outer = sdRect(p, vec2(0.35, 0.45), 0.1);
    float inner = sdRect(p, vec2(0.2, 0.3), 0.05);
    return max(outer, -inner);
}

float digit1(vec2 p) {
    return sdSegment(p, vec2(0.0, -0.4), vec2(0.0, 0.4)) - 0.08;
}

float digit2(vec2 p) {
    float top = sdSegment(p, vec2(-0.25, 0.3), vec2(0.25, 0.3)) - 0.08;
    float mid = sdSegment(p, vec2(-0.25, 0.0), vec2(0.25, 0.0)) - 0.08;
    float bot = sdSegment(p, vec2(-0.25, -0.3), vec2(0.25, -0.3)) - 0.08;
    float tr = sdSegment(p, vec2(0.25, 0.3), vec2(0.25, 0.0)) - 0.08;
    float bl = sdSegment(p, vec2(-0.25, 0.0), vec2(-0.25, -0.3)) - 0.08;
    return min(min(min(min(top, mid), bot), tr), bl);
}

float digit3(vec2 p) {
    float top = sdSegment(p, vec2(-0.25, 0.3), vec2(0.25, 0.3)) - 0.08;
    float mid = sdSegment(p, vec2(-0.2, 0.0), vec2(0.2, 0.0)) - 0.08;
    float bot = sdSegment(p, vec2(-0.25, -0.3), vec2(0.25, -0.3)) - 0.08;
    float r1 = sdSegment(p, vec2(0.25, 0.3), vec2(0.25, 0.0)) - 0.08;
    float r2 = sdSegment(p, vec2(0.25, 0.0), vec2(0.25, -0.3)) - 0.08;
    return min(min(min(min(top, mid), bot), r1), r2);
}

float digit4(vec2 p) {
    float left = sdSegment(p, vec2(-0.25, 0.3), vec2(-0.25, 0.0)) - 0.08;
    float mid = sdSegment(p, vec2(-0.25, 0.0), vec2(0.25, 0.0)) - 0.08;
    float right = sdSegment(p, vec2(0.25, 0.4), vec2(0.25, -0.4)) - 0.08;
    return min(min(left, mid), right);
}

float digit5(vec2 p) {
    float top = sdSegment(p, vec2(-0.25, 0.3), vec2(0.25, 0.3)) - 0.08;
    float mid = sdSegment(p, vec2(-0.2, 0.0), vec2(0.2, 0.0)) - 0.08;
    float bot = sdSegment(p, vec2(-0.25, -0.3), vec2(0.25, -0.3)) - 0.08;
    float tl = sdSegment(p, vec2(-0.25, 0.3), vec2(-0.25, 0.0)) - 0.08;
    float br = sdSegment(p, vec2(0.25, 0.0), vec2(0.25, -0.3)) - 0.08;
    return min(min(min(min(top, mid), bot), tl), br);
}

float digit6(vec2 p) {
    float top = sdSegment(p, vec2(-0.25, 0.3), vec2(0.25, 0.3)) - 0.08;
    float mid = sdSegment(p, vec2(-0.2, 0.0), vec2(0.2, 0.0)) - 0.08;
    float bot = sdSegment(p, vec2(-0.25, -0.3), vec2(0.25, -0.3)) - 0.08;
    float tl = sdSegment(p, vec2(-0.25, 0.3), vec2(-0.25, 0.0)) - 0.08;
    float bl = sdSegment(p, vec2(-0.25, 0.0), vec2(-0.25, -0.3)) - 0.08;
    float br = sdSegment(p, vec2(0.25, 0.0), vec2(0.25, -0.3)) - 0.08;
    return min(min(min(min(min(top, mid), bot), tl), bl), br);
}

float digit7(vec2 p) {
    float top = sdSegment(p, vec2(-0.25, 0.3), vec2(0.25, 0.3)) - 0.08;
    float right = sdSegment(p, vec2(0.25, 0.3), vec2(0.25, -0.3)) - 0.08;
    return min(top, right);
}

float digit8(vec2 p) {
    float d = digit0(p);
    float mid = sdSegment(p, vec2(-0.2, 0.0), vec2(0.2, 0.0)) - 0.08;
    return min(d, mid);
}

float digit9(vec2 p) {
    float d = digit0(p);
    float mid = sdSegment(p, vec2(-0.2, 0.0), vec2(0.2, 0.0)) - 0.08;
    float bl = sdSegment(p, vec2(-0.25, 0.0), vec2(-0.25, -0.3)) - 0.08;
    return min(min(d, mid), bl);
}

float getDigit(vec2 p, float digit) {
    if (digit < 0.5) return digit0(p);
    else if (digit < 1.5) return digit1(p);
    else if (digit < 2.5) return digit2(p);
    else if (digit < 3.5) return digit3(p);
    else if (digit < 4.5) return digit4(p);
    else if (digit < 5.5) return digit5(p);
    else if (digit < 6.5) return digit6(p);
    else if (digit < 7.5) return digit7(p);
    else if (digit < 8.5) return digit8(p);
    else return digit9(p);
}

void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    
    float border = sdRect(uv, vec2(0.95, 0.9), 0.1);
    float innerBorder = sdRect(uv, vec2(0.88, 0.83), 0.08);
    
    float scoreVal = score;
    float digits[6];
    digits[0] = floor(mod(scoreVal / 100000.0, 10.0));
    digits[1] = floor(mod(scoreVal / 10000.0, 10.0));
    digits[2] = floor(mod(scoreVal / 1000.0, 10.0));
    digits[3] = floor(mod(scoreVal / 100.0, 10.0));
    digits[4] = floor(mod(scoreVal / 10.0, 10.0));
    digits[5] = floor(mod(scoreVal, 10.0));
    
    float digitDist = 1.0;
    float digitSpacing = 0.32;
    float startX = -digitSpacing * 2.5;
    
    for (int i = 0; i < 6; i++) {
        vec2 digitPos = vec2(startX + float(i) * digitSpacing, 0.0);
        vec2 localUv = (uv - digitPos) * vec2(1.0, 1.2);
        float d = getDigit(localUv, digits[i]);
        
        float showDigit = 1.0;
        if (i < 5) {
            float threshold = pow(10.0, float(5 - i));
            showDigit = step(threshold - 0.5, scoreVal);
            if (i == 0 && scoreVal < 10.0) showDigit = 0.0;
        }
        
        d = mix(1.0, d, showDigit);
        digitDist = min(digitDist, d);
    }
    
    float finalDist = min(max(border, -innerBorder), digitDist);
    
    float glow = exp(-finalDist * 8.0) * 0.5;
    float outline = smoothstep(0.03, -0.01, finalDist);
    float fill = smoothstep(0.0, -0.02, finalDist);
    
    vec3 col = backgroundColor;
    col += glow * glowColor;
    col = mix(col, textColor, outline * 0.3);
    col = mix(col, textColor + glowColor * 0.3, fill);
    
    float alpha = smoothstep(0.15, -0.02, finalDist);
    
    gl_FragColor = vec4(col, alpha);
}
