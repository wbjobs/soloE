#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_inputTexture;
uniform sampler2D u_alphaTexture;
uniform sampler2D u_bgTexture;

uniform int u_bgType;
uniform vec3 u_bgColor;
uniform float u_bgBlur;
uniform vec2 u_resolution;

float gaussianBlur(sampler2D tex, vec2 uv, vec2 dir, float amount) {
  float value = 0.0;
  float total = 0.0;
  float sigma = amount * 2.0 + 0.1;
  
  for (int i = -4; i <= 4; i++) {
    float weight = exp(-float(i * i) / (2.0 * sigma * sigma));
    vec2 offset = vec2(float(i)) * dir * amount / u_resolution;
    value += texture(tex, uv + offset).r * weight;
    total += weight;
  }
  
  return value / total;
}

void main() {
  vec4 inputColor = texture(u_inputTexture, v_texCoord);
  float alpha = texture(u_alphaTexture, v_texCoord).r;
  
  vec3 bgColor;
  
  if (u_bgType == 0) {
    bgColor = u_bgColor;
  } else if (u_bgType == 1) {
    float blurH = gaussianBlur(u_inputTexture, v_texCoord, vec2(1.0, 0.0), u_bgBlur);
    float blurV = gaussianBlur(u_inputTexture, v_texCoord, vec2(0.0, 1.0), u_bgBlur);
    bgColor = vec3((blurH + blurV) * 0.5);
    vec3 blurredColor = texture(u_inputTexture, v_texCoord).rgb;
    float blurAmount = u_bgBlur * 0.1;
    bgColor = mix(blurredColor, bgColor, blurAmount);
  } else {
    bgColor = texture(u_bgTexture, v_texCoord).rgb;
  }
  
  vec3 finalColor = mix(bgColor, inputColor.rgb, alpha);
  fragColor = vec4(finalColor, 1.0);
}
