import shaderCode from './shader.wgsl?raw';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class FluidRenderer {
  private canvas: HTMLCanvasElement;
  private particleCount: number;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private presentationFormat!: GPUTextureFormat;

  private particleBuffer!: GPUBuffer;
  private uniformBuffer!: GPUBuffer;
  private computePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private computeBindGroup!: GPUBindGroup;
  private renderBindGroup!: GPUBindGroup;
  private instanceCount = 6;

  private mouseData: Float32Array;
  private viscosity: number = 0.998;

  constructor(canvas: HTMLCanvasElement, particleCount: number) {
    this.canvas = canvas;
    this.particleCount = particleCount;
    this.mouseData = new Float32Array([0, 0, 0, 0, 0]);
  }

  setViscosity(value: number) {
    this.viscosity = value;
  }

  async init() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('无法获取 GPU 适配器');
    }
    this.device = await adapter.requestDevice();

    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    
    this.resizeCanvas();
    
    this.context.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: 'opaque',
      presentMode: 'immediate',
    });

    this.createBuffers();
    this.createPipelines();
    this.createBindGroups();
  }

  private resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
  }

  private createBuffers() {
    const particles = new Float32Array(this.particleCount * 4);
    for (let i = 0; i < this.particleCount; i++) {
      particles[i * 4 + 0] = (Math.random() * 0.6 + 0.2) * this.canvas.width;
      particles[i * 4 + 1] = (Math.random() * 0.6 + 0.2) * this.canvas.height;
      particles[i * 4 + 2] = (Math.random() - 0.5) * 2;
      particles[i * 4 + 3] = (Math.random() - 0.5) * 2;
    }

    this.particleBuffer = this.device.createBuffer({
      size: particles.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
    });
    this.device.queue.writeBuffer(this.particleBuffer, 0, particles);

    this.uniformBuffer = this.device.createBuffer({
      size: 5 * 4 + 3 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private createPipelines() {
    const shaderModule = this.device.createShaderModule({
      code: shaderCode,
    });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'computeMain',
      },
    });

    this.renderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 4 * 4,
            stepMode: 'instance',
            attributes: [
              {
                shaderLocation: 0,
                offset: 0,
                format: 'float32x2',
              },
              {
                shaderLocation: 1,
                offset: 2 * 4,
                format: 'float32x2',
              },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: this.presentationFormat,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
  }

  private createBindGroups() {
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.particleBuffer,
          },
        },
        {
          binding: 1,
          resource: {
            buffer: this.uniformBuffer,
          },
        },
      ],
    });

    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.uniformBuffer,
          },
        },
      ],
    });
  }

  updateMouse(x: number, y: number, dx: number, dy: number, active: number) {
    this.mouseData[0] = x;
    this.mouseData[1] = y;
    this.mouseData[2] = dx;
    this.mouseData[3] = dy;
    this.mouseData[4] = active;
  }

  resize() {
    this.resizeCanvas();
    this.context.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: 'opaque',
      presentMode: 'immediate',
    });
  }

  render() {
    const uniformData = new Float32Array([
      this.mouseData[0],
      this.mouseData[1],
      this.mouseData[2],
      this.mouseData[3],
      this.mouseData[4],
      this.canvas.width,
      this.canvas.height,
      this.viscosity,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const commandEncoder = this.device.createCommandEncoder();

    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
    computePass.end();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.renderBindGroup);
    renderPass.setVertexBuffer(0, this.particleBuffer);
    renderPass.draw(6, this.particleCount);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}
