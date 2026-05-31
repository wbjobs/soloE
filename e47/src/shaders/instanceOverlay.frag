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

uniform int u_instanceCount;
uniform vec4 u_instanceBoxes[16];
uniform vec3 u_instanceColors[16];
uniform int u_instanceSelected[16];
uniform int u_instanceVisible[16];

uniform int u_showBorders;
uniform int u_showColors;

float getInstanceAlpha(vec2 uv, int idx) {
  vec4 box = u_instanceBoxes[idx];
  float x = uv.x * u_resolution.x;
  float y = uv.y * u_resolution.y;
  
  if (x < box.x || x > box.x + box.z || y < box.y || y > box.y + box.w) {
    return 0.0;
  }
  
  vec2 alphaUV = vec2(x / u_resolution.x, y / u_resolution.y);
  return texture(u_alphaTexture, alphaUV).r;
}

void main() {
  vec4 inputColor = texture(u_inputTexture, v_texCoord);
  float finalAlpha = 0.0;
  vec3 instanceTint = vec3(0.0);
  float borderAlpha = 0.0;
  vec3 borderColor = vec3(1.0, 1.0, 1.0);
  
  for (int i = 0; i < 16; i++) {
    if (i >= u_instanceCount) break;
    if (u_instanceVisible[i] == 0) continue;
    
    vec4 box = u_instanceBoxes[i];
    float x = v_texCoord.x * u_resolution.x;
    float y = v_texCoord.y * u_resolution.y;
    
    float alpha = getInstanceAlpha(v_texCoord, i);
    
    if (u_showColors == 1 && u_instanceSelected[i] == 1) {
      instanceTint += u_instanceColors[i] * alpha * 0.3;
    }
    
    if (u_showBorders == 1 && u_instanceSelected[i] == 1) {
      float borderWidth = 3.0;
      float inBox = 0.0;
      
      if (x >= box.x - borderWidth && x <= box.x + borderWidth && y >= box.y && y <= box.y + box.w) {
        inBox = 1.0;
      }
      if (x >= box.x + box.z - borderWidth && x <= box.x + box.z + borderWidth && y >= box.y && y <= box.y + box.w) {
        inBox = 1.0;
      }
      if (y >= box.y - borderWidth && y <= box.y + borderWidth && x >= box.x && x <= box.x + box.z) {
        inBox = 1.0;
      }
      if (y >= box.y + box.w - borderWidth && y <= box.y + box.w + borderWidth && x >= box.x && x <= box.x + box.z) {
        inBox = 1.0;
      }
      
      if (inBox > 0.0 && alpha > 0.1) {
        borderAlpha = 1.0;
        borderColor = u_instanceColors[i];
      }
    }
    
    if (u_instanceSelected[i] == 1) {
      finalAlpha = max(finalAlpha, alpha);
    }
  }

  vec3 bgColor;
  
  if (u_bgType == 0) {
    bgColor = u_bgColor;
  } else if (u_bgType == 1) {
    bgColor = inputColor.rgb * 0.5 + vec3(0.2);
  } else {
    bgColor = texture(u_bgTexture, v_texCoord).rgb;
  }
  
  vec3 finalColor = mix(bgColor, inputColor.rgb, finalAlpha);
  finalColor += instanceTint;
  
  if (borderAlpha > 0.0) {
    finalColor = mix(finalColor, borderColor, 0.8);
  }
  
  fragColor = vec4(finalColor, 1.0);
}