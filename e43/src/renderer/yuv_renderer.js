export class YUVWebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.program = null;
    this.textures = { y: null, u: null, v: null };
    this.buffers = { position: null, texCoord: null };
    this.width = 0;
    this.height = 0;
    this.initialized = false;
  }

  init() {
    try {
      this.gl = this.canvas.getContext('webgl', {
        preserveDrawingBuffer: true,
        antialias: false
      });

      if (!this.gl) {
        throw new Error('WebGL 不支持');
      }

      const gl = this.gl;

      const vertexShader = this.compileShader(`
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        varying vec2 v_texCoord;
        
        void main() {
          gl_Position = vec4(a_position, 0.0, 1.0);
          v_texCoord = a_texCoord;
        }
      `, gl.VERTEX_SHADER);

      const fragmentShader = this.compileShader(`
        precision mediump float;
        varying vec2 v_texCoord;
        uniform sampler2D u_yTexture;
        uniform sampler2D u_uTexture;
        uniform sampler2D u_vTexture;
        uniform vec2 u_resolution;
        
        void main() {
          float y = texture2D(u_yTexture, v_texCoord).r;
          float u = texture2D(u_uTexture, v_texCoord).r - 0.5;
          float v = texture2D(u_vTexture, v_texCoord).r - 0.5;
          
          float r = y + 1.402 * v;
          float g = y - 0.344 * u - 0.714 * v;
          float b = y + 1.772 * u;
          
          gl_FragColor = vec4(r, g, b, 1.0);
        }
      `, gl.FRAGMENT_SHADER);

      this.program = gl.createProgram();
      gl.attachShader(this.program, vertexShader);
      gl.attachShader(this.program, fragmentShader);
      gl.linkProgram(this.program);

      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error('着色器程序链接失败: ' + gl.getProgramInfoLog(this.program));
      }

      gl.useProgram(this.program);

      const positions = new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
         1,  1
      ]);

      const texCoords = new Float32Array([
        0, 1,
        1, 1,
        0, 0,
        1, 0
      ]);

      this.buffers.position = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

      const posLoc = gl.getAttribLocation(this.program, 'a_position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      this.buffers.texCoord = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
      gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

      const texLoc = gl.getAttribLocation(this.program, 'a_texCoord');
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

      this.textures.y = this.createTexture();
      this.textures.u = this.createTexture();
      this.textures.v = this.createTexture();

      gl.uniform1i(gl.getUniformLocation(this.program, 'u_yTexture'), 0);
      gl.uniform1i(gl.getUniformLocation(this.program, 'u_uTexture'), 1);
      gl.uniform1i(gl.getUniformLocation(this.program, 'u_vTexture'), 2);

      this.initialized = true;
      return true;
    } catch (e) {
      console.error('WebGL 初始化失败:', e);
      return false;
    }
  }

  compileShader(source, type) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('着色器编译失败: ' + error);
    }

    return shader;
  }

  createTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  setResolution(width, height) {
    if (this.width === width && this.height === height) return;
    
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  render(frame) {
    if (!this.initialized || !frame) return false;

    const gl = this.gl;

    if (frame.videoFrame) {
      return this.renderVideoFrame(frame);
    }

    const { y, u, v, width, height } = frame;

    this.setResolution(width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.y);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, y);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.u);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width / 2, height / 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, u);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.v);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width / 2, height / 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, v);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return true;
  }

  renderVideoFrame(frame) {
    const gl = this.gl;
    const videoFrame = frame.videoFrame;
    
    if (!videoFrame) return false;

    this.setResolution(frame.width, frame.height);

    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures.y);
      
      if ('copyTo' in videoFrame) {
        const ySize = frame.width * frame.height;
        const yData = new Uint8Array(ySize);
        videoFrame.copyTo(yData, { planeIndex: 0 });
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, frame.width, frame.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, yData);

        const uvSize = (frame.width / 2) * (frame.height / 2);
        const uData = new Uint8Array(uvSize);
        const vData = new Uint8Array(uvSize);
        videoFrame.copyTo(uData, { planeIndex: 1 });
        videoFrame.copyTo(vData, { planeIndex: 2 });

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.u);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, frame.width / 2, frame.height / 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, uData);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.v);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, frame.width / 2, frame.height / 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, vData);
      } else {
        this.createImageBitmapAndRender(videoFrame);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    } catch (e) {
      console.warn('VideoFrame 渲染失败，回退到软件渲染:', e);
      return false;
    }
  }

  async createImageBitmapAndRender(videoFrame) {
    try {
      const bitmap = await createImageBitmap(videoFrame);
      const gl = this.gl;
      
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures.y);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      
      bitmap.close();
    } catch (e) {
      console.warn('ImageBitmap 渲染失败:', e);
    }
  }

  clear() {
    if (!this.gl) return;
    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  destroy() {
    const gl = this.gl;
    if (!gl) return;

    if (this.textures.y) gl.deleteTexture(this.textures.y);
    if (this.textures.u) gl.deleteTexture(this.textures.u);
    if (this.textures.v) gl.deleteTexture(this.textures.v);

    if (this.buffers.position) gl.deleteBuffer(this.buffers.position);
    if (this.buffers.texCoord) gl.deleteBuffer(this.buffers.texCoord);

    if (this.program) gl.deleteProgram(this.program);

    this.initialized = false;
  }
}
