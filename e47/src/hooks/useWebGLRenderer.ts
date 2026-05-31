import { useRef, useEffect, useCallback } from 'react';
import {
  createShader,
  createProgram,
  createTexture,
  updateTexture,
  createQuadBuffer,
  hexToRgb,
} from '../utils/webgl';
import vertexShaderSource from '../shaders/vertex.glsl?raw';
import compositeShaderSource from '../shaders/composite.frag?raw';
import postprocessShaderSource from '../shaders/postprocess.frag?raw';
import instanceOverlayShaderSource from '../shaders/instanceOverlay.frag?raw';
import type { PostProcessSettings, BackgroundSettings, PersonInstance } from '../types';

export function useWebGLRenderer(width: number, height: number) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programsRef = useRef<{
    composite: WebGLProgram | null;
    postprocess: WebGLProgram | null;
    instanceOverlay: WebGLProgram | null;
  }>({ composite: null, postprocess: null, instanceOverlay: null });
  const texturesRef = useRef<{
    input: WebGLTexture | null;
    alpha: WebGLTexture | null;
    background: WebGLTexture | null;
    postprocess: WebGLTexture | null;
  }>({ input: null, alpha: null, background: null, postprocess: null });
  const buffersRef = useRef<{
    position: WebGLBuffer | null;
    texCoord: WebGLBuffer | null;
  }>({ position: null, texCoord: null });
  const fboRef = useRef<WebGLFramebuffer | null>(null);
  const initializedRef = useRef(false);

  const initialize = useCallback(() => {
    if (initializedRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      console.error('WebGL 2 not supported');
      return;
    }

    glRef.current = gl;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const compositeFragment = createShader(gl, gl.FRAGMENT_SHADER, compositeShaderSource);
    const postprocessFragment = createShader(gl, gl.FRAGMENT_SHADER, postprocessShaderSource);
    const instanceOverlayFragment = createShader(gl, gl.FRAGMENT_SHADER, instanceOverlayShaderSource);

    if (!vertexShader || !compositeFragment || !postprocessFragment || !instanceOverlayFragment) return;

    const compositeProgram = createProgram(gl, vertexShader, compositeFragment);
    const postprocessProgram = createProgram(gl, vertexShader, postprocessFragment);
    const instanceOverlayProgram = createProgram(gl, vertexShader, instanceOverlayFragment);

    if (!compositeProgram || !postprocessProgram || !instanceOverlayProgram) return;

    programsRef.current = { composite: compositeProgram, postprocess: postprocessProgram, instanceOverlay: instanceOverlayProgram };

    const buffers = createQuadBuffer(gl);
    if (!buffers) return;
    buffersRef.current = buffers;

    texturesRef.current = {
      input: createTexture(gl, width, height),
      alpha: createTexture(gl, width, height),
      background: createTexture(gl, width, height),
      postprocess: createTexture(gl, width, height),
    };

    if (texturesRef.current.postprocess) {
      fboRef.current = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboRef.current);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texturesRef.current.postprocess,
        0
      );
    }

    initializedRef.current = true;
  }, [width, height]);

  const updateInputTexture = useCallback(
    (source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) => {
      const gl = glRef.current;
      if (!gl || !texturesRef.current.input || !initializedRef.current) return;

      gl.bindTexture(gl.TEXTURE_2D, texturesRef.current.input);
      
      if (source instanceof HTMLVideoElement) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }
      
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
    []
  );

  const updateAlphaTexture = useCallback((data: Uint8ClampedArray) => {
    const gl = glRef.current;
    if (!gl || !texturesRef.current.alpha || !initializedRef.current) return;

    gl.bindTexture(gl.TEXTURE_2D, texturesRef.current.alpha);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }, [width, height]);

  const updateBackgroundTexture = useCallback(
    (source: HTMLImageElement | HTMLCanvasElement) => {
      const gl = glRef.current;
      if (!gl || !texturesRef.current.background || !initializedRef.current) return;

      gl.bindTexture(gl.TEXTURE_2D, texturesRef.current.background);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },
    []
  );

  const render = useCallback(
    (
      postProcess: PostProcessSettings,
      background: BackgroundSettings
    ) => {
      const gl = glRef.current;
      const { composite: compositeProgram, postprocess: postprocessProgram } = programsRef.current;
      const { input: inputTexture, alpha: alphaTexture, background: bgTexture, postprocess: ppTexture } = texturesRef.current;
      const { position: positionBuffer, texCoord: texCoordBuffer } = buffersRef.current;
      const fbo = fboRef.current;

      if (!gl || !compositeProgram || !postprocessProgram || !inputTexture || !alphaTexture || !positionBuffer || !texCoordBuffer || !initializedRef.current) {
        return;
      }

      if (postProcess.featherAmount > 0 || postProcess.erodeAmount > 0 || postProcess.dilateAmount > 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, width, height);
        gl.useProgram(postprocessProgram);

        const posLoc = gl.getAttribLocation(postprocessProgram, 'a_position');
        const texLoc = gl.getAttribLocation(postprocessProgram, 'a_texCoord');

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, alphaTexture);
        gl.uniform1i(gl.getUniformLocation(postprocessProgram, 'u_alphaTexture'), 0);

        gl.uniform1f(gl.getUniformLocation(postprocessProgram, 'u_featherAmount'), postProcess.featherAmount);
        gl.uniform1f(gl.getUniformLocation(postprocessProgram, 'u_erodeAmount'), postProcess.erodeAmount);
        gl.uniform1f(gl.getUniformLocation(postprocessProgram, 'u_dilateAmount'), postProcess.dilateAmount);
        gl.uniform2f(gl.getUniformLocation(postprocessProgram, 'u_resolution'), width, height);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(compositeProgram);

      const posLoc = gl.getAttribLocation(compositeProgram, 'a_position');
      const texLoc = gl.getAttribLocation(compositeProgram, 'a_texCoord');

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      gl.uniform1i(gl.getUniformLocation(compositeProgram, 'u_inputTexture'), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, (postProcess.featherAmount > 0 || postProcess.erodeAmount > 0 || postProcess.dilateAmount > 0) ? ppTexture : alphaTexture);
      gl.uniform1i(gl.getUniformLocation(compositeProgram, 'u_alphaTexture'), 1);

      if (background.type === 'image' && bgTexture) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, bgTexture);
        gl.uniform1i(gl.getUniformLocation(compositeProgram, 'u_bgTexture'), 2);
      }

      const bgTypeMap = { solid: 0, blur: 1, image: 2 };
      gl.uniform1i(gl.getUniformLocation(compositeProgram, 'u_bgType'), bgTypeMap[background.type]);

      const rgb = hexToRgb(background.color);
      gl.uniform3f(gl.getUniformLocation(compositeProgram, 'u_bgColor'), rgb[0], rgb[1], rgb[2]);

      gl.uniform1f(gl.getUniformLocation(compositeProgram, 'u_bgBlur'), background.blurAmount);
      gl.uniform2f(gl.getUniformLocation(compositeProgram, 'u_resolution'), width, height);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    [width, height]
  );

  const renderWithInstances = useCallback(
    (
      postProcess: PostProcessSettings,
      background: BackgroundSettings,
      instances: PersonInstance[],
      showBorders: boolean,
      showColors: boolean
    ) => {
      const gl = glRef.current;
      const { instanceOverlay: instanceOverlayProgram } = programsRef.current;
      const { input: inputTexture, alpha: alphaTexture, background: bgTexture } = texturesRef.current;
      const { position: positionBuffer, texCoord: texCoordBuffer } = buffersRef.current;

      if (!gl || !instanceOverlayProgram || !inputTexture || !alphaTexture || !positionBuffer || !texCoordBuffer || !initializedRef.current) {
        render(postProcess, background);
        return;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(instanceOverlayProgram);

      const posLoc = gl.getAttribLocation(instanceOverlayProgram, 'a_position');
      const texLoc = gl.getAttribLocation(instanceOverlayProgram, 'a_texCoord');

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      gl.uniform1i(gl.getUniformLocation(instanceOverlayProgram, 'u_inputTexture'), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, alphaTexture);
      gl.uniform1i(gl.getUniformLocation(instanceOverlayProgram, 'u_alphaTexture'), 1);

      if (background.type === 'image' && bgTexture) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, bgTexture);
        gl.uniform1i(gl.getUniformLocation(instanceOverlayProgram, 'u_bgTexture'), 2);
      }

      const bgTypeMap = { solid: 0, blur: 1, image: 2 };
      gl.uniform1i(gl.getUniformLocation(instanceOverlayProgram, 'u_bgType'), bgTypeMap[background.type]);

      const rgb = hexToRgb(background.color);
      gl.uniform3f(gl.getUniformLocation(instanceOverlayProgram, 'u_bgColor'), rgb[0], rgb[1], rgb[2]);

      gl.uniform1f(gl.getUniformLocation(instanceOverlayProgram, 'u_bgBlur'), background.blurAmount);
      gl.uniform2f(gl.getUniformLocation(instanceOverlayProgram, 'u_resolution'), width, height);

      const maxInstances = Math.min(instances.length, 16);
      gl.uniform1i(gl.getUniformLocation(instanceOverlayProgram, 'u_instanceCount'), maxInstances);

      const boxes = new Float32Array(16 * 4);
      const colors = new Float32Array(16 * 3);
      const selected = new Int32Array(16);
      const visible = new Int32Array(16);

      for (let i = 0; i < maxInstances; i++) {
        const inst = instances[i];
        boxes[i * 4] = inst.boundingBox.x;
        boxes[i * 4 + 1] = inst.boundingBox.y;
        boxes[i * 4 + 2] = inst.boundingBox.width;
        boxes[i * 4 + 3] = inst.boundingBox.height;
        
        colors[i * 3] = inst.color.r / 255;
        colors[i * 3 + 1] = inst.color.g / 255;
        colors[i * 3 + 2] = inst.color.b / 255;
        
        selected[i] = inst.isSelected ? 1 : 0;
        visible[i] = inst.isVisible ? 1 : 0;
      }

      gl.uniform4fv(gl.getUniformLocation(instanceOverlayProgram, 'u_instanceBoxes'), boxes);
      gl.uniform3fv(gl.getUniformLocation(instanceOverlayProgram, 'u_instanceColors'), colors);
      gl.uniform1iv(gl.getUniformLocation(instanceOverlayProgram, 'u_instanceSelected'), selected);
      gl.uniform1iv(gl.getUniformLocation(instanceOverlayProgram, 'u_instanceVisible'), visible);
      
      gl.uniform1i(gl.getUniformLocation(instanceOverlayProgram, 'u_showBorders'), showBorders ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(instanceOverlayProgram, 'u_showColors'), showColors ? 1 : 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    [width, height, render]
  );

  useEffect(() => {
    initialize();

    return () => {
      const gl = glRef.current;
      if (!gl) return;

      const { input, alpha, background, postprocess: pp } = texturesRef.current;
      const textures = [input, alpha, background, pp].filter(Boolean);
      textures.forEach(texture => {
        if (texture) {
          gl.deleteTexture(texture);
        }
      });

      const { position: positionBuffer, texCoord: texCoordBuffer } = buffersRef.current;
      if (positionBuffer) gl.deleteBuffer(positionBuffer);
      if (texCoordBuffer) gl.deleteBuffer(texCoordBuffer);

      const { composite: compositeProgram, postprocess: ppProgram } = programsRef.current;
      if (compositeProgram) gl.deleteProgram(compositeProgram);
      if (ppProgram) gl.deleteProgram(ppProgram);

      if (fboRef.current) gl.deleteFramebuffer(fboRef.current);

      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();

      initializedRef.current = false;
    };
  }, [initialize]);

  return {
    canvasRef,
    updateInputTexture,
    updateAlphaTexture,
    updateBackgroundTexture,
    render,
    renderWithInstances,
  };
}
