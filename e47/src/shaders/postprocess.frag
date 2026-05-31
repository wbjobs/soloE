#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_alphaTexture;
uniform float u_featherAmount;
uniform float u_erodeAmount;
uniform float u_dilateAmount;
uniform vec2 u_resolution;

float gaussianBlur(sampler2D tex, vec2 uv, float amount) {
  float value = 0.0;
  float total = 0.0;
  float sigma = amount * 2.0 + 0.1;
  
  for (int y = -4; y <= 4; y++) {
    for (int x = -4; x <= 4; x++) {
      float weight = exp(-float(x * x + y * y) / (2.0 * sigma * sigma));
      vec2 offset = vec2(float(x), float(y)) * amount / u_resolution;
      value += texture(tex, uv + offset).r * weight;
      total += weight;
    }
  }
  
  return value / total;
}

float erode(sampler2D tex, vec2 uv, float amount) {
  float minValue = 1.0;
  int steps = int(ceil(amount));
  
  for (int y = -steps; y <= steps; y++) {
    for (int x = -steps; x <= steps; x++) {
      vec2 offset = vec2(float(x), float(y)) * amount / u_resolution;
      minValue = min(minValue, texture(tex, uv + offset).r);
    }
  }
  
  return minValue;
}

float dilate(sampler2D tex, vec2 uv, float amount) {
  float maxValue = 0.0;
  int steps = int(ceil(amount));
  
  for (int y = -steps; y <= steps; y++) {
    for (int x = -steps; x <= steps; x++) {
      vec2 offset = vec2(float(x), float(y)) * amount / u_resolution;
      maxValue = max(maxValue, texture(tex, uv + offset).r);
    }
  }
  
  return maxValue;
}

void main() {
  float alpha = texture(u_alphaTexture, v_texCoord).r;
  
  if (u_erodeAmount > 0.0) {
    alpha = erode(u_alphaTexture, v_texCoord, u_erodeAmount);
  }
  
  if (u_dilateAmount > 0.0) {
    alpha = dilate(u_alphaTexture, v_texCoord, u_dilateAmount);
  }
  
  if (u_featherAmount > 0.0) {
    alpha = gaussianBlur(u_alphaTexture, v_texCoord, u_featherAmount);
  }
  
  fragColor = vec4(alpha, alpha, alpha, 1.0);
}
