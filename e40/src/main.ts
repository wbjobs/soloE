import { WebGPUDevice } from './gpu/device';
import { ParticlePool, EmitRequest } from './simulation/ParticlePool';
import { ParticleRenderer } from './renderer/ParticleRenderer';

const MAX_PARTICLES = 500000;
const MAX_RENDER_DISTANCE = 5.0;

class FluidSimulationApp {
  private gpuDevice!: WebGPUDevice;
  private particlePool!: ParticlePool;
  private renderer!: ParticleRenderer;
  private canvas!: HTMLCanvasElement;
  
  private lastTime = 0;
  private frameCount = 0;
  private fps = 0;
  private isRunning = false;
  private isEmitting = false;
  private emissionStrength = 5;
  private particlesPerEmit = 200;
  
  private params = {
    windX: 0,
    windY: 0,
    windZ: 0,
    dissipation: 0.02
  };

  async init(): Promise<void> {
    this.canvas = document.getElementById('gpuCanvas') as HTMLCanvasElement;
    this.resizeCanvas();
    
    this.gpuDevice = WebGPUDevice.getInstance();
    await this.gpuDevice.init(this.canvas);
    
    const device = this.gpuDevice.device;
    const context = this.gpuDevice.context;
    const format = this.gpuDevice.format;
    
    this.particlePool = new ParticlePool(device, MAX_PARTICLES, MAX_RENDER_DISTANCE);
    this.renderer = new ParticleRenderer(device, context, format, MAX_PARTICLES);
    
    const initEncoder = device.createCommandEncoder();
    this.particlePool.initialize(initEncoder);
    device.queue.submit([initEncoder.finish()]);
    
    this.setupInputHandlers();
    this.setupUIControls();
    this.updateStats();
    
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.renderer.resize();
    });
    
    this.isRunning = true;
    this.animate();
    
    console.log(`粒子池系统初始化完成，最大粒子数: ${MAX_PARTICLES}`);
  }

  private resizeCanvas(): void {
    this.canvas.width = window.innerWidth * window.devicePixelRatio;
    this.canvas.height = window.innerHeight * window.devicePixelRatio;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
  }

  private setupInputHandlers(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isEmitting = true;
        this.addSmokeEmitter(e.clientX, e.clientY);
      }
    });
    
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isEmitting && e.buttons === 1) {
        this.addSmokeEmitter(e.clientX, e.clientY);
      }
    });
    
    this.canvas.addEventListener('mouseup', () => {
      this.isEmitting = false;
    });
    
    this.canvas.addEventListener('mouseleave', () => {
      this.isEmitting = false;
    });
    
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.isEmitting = true;
      this.addSmokeEmitter(touch.clientX, touch.clientY);
    }, { passive: false });
    
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (this.isEmitting) {
        const touch = e.touches[0];
        this.addSmokeEmitter(touch.clientX, touch.clientY);
      }
    }, { passive: false });
    
    this.canvas.addEventListener('touchend', () => {
      this.isEmitting = false;
    });
  }

  private addSmokeEmitter(screenX: number, screenY: number): void {
    const worldPos = this.renderer.screenToWorld(screenX, screenY);
    const pos = {
      x: (worldPos.x - 0.5) * 1.6,
      y: (worldPos.y - 0.5) * 1.6,
      z: (worldPos.z - 0.5) * 1.6
    };
    
    const request: EmitRequest = {
      position: pos,
      direction: {
        x: (Math.random() - 0.5) * 0.5,
        y: Math.random() * 0.5 + 0.2,
        z: (Math.random() - 0.5) * 0.5
      },
      strength: this.emissionStrength,
      count: this.particlesPerEmit
    };
    
    this.particlePool.emit(request);
  }

  private setupUIControls(): void {
    const windX = document.getElementById('windX') as HTMLInputElement;
    const windY = document.getElementById('windY') as HTMLInputElement;
    const windZ = document.getElementById('windZ') as HTMLInputElement;
    const dissipation = document.getElementById('dissipation') as HTMLInputElement;
    const emission = document.getElementById('emission') as HTMLInputElement;
    const particleDensity = document.getElementById('particleDensity') as HTMLInputElement;
    
    const updateParams = () => {
      this.params.windX = parseFloat(windX.value);
      this.params.windY = parseFloat(windY.value);
      this.params.windZ = parseFloat(windZ.value);
      this.params.dissipation = parseFloat(dissipation.value);
      this.emissionStrength = parseFloat(emission.value);
      
      this.particlesPerEmit = Math.floor(parseFloat(particleDensity.value) * 500);
      
      (document.getElementById('windXVal') as HTMLElement).textContent = this.params.windX.toFixed(1);
      (document.getElementById('windYVal') as HTMLElement).textContent = this.params.windY.toFixed(1);
      (document.getElementById('windZVal') as HTMLElement).textContent = this.params.windZ.toFixed(1);
      (document.getElementById('dissipationVal') as HTMLElement).textContent = this.params.dissipation.toFixed(2);
      (document.getElementById('emissionVal') as HTMLElement).textContent = this.emissionStrength.toFixed(0);
      (document.getElementById('particleDensityVal') as HTMLElement).textContent = this.particlesPerEmit.toString();
    };
    
    windX.addEventListener('input', updateParams);
    windY.addEventListener('input', updateParams);
    windZ.addEventListener('input', updateParams);
    dissipation.addEventListener('input', updateParams);
    emission.addEventListener('input', updateParams);
    particleDensity.addEventListener('input', updateParams);
    
    updateParams();
  }

  private updateStats(): void {
    const stats = this.particlePool.getStats();
    
    (document.getElementById('fps') as HTMLElement).textContent = this.fps.toFixed(1);
    (document.getElementById('particles') as HTMLElement).textContent = `${stats.activeParticles.toLocaleString()} / ${stats.totalParticles.toLocaleString()}`;
    (document.getElementById('gpuTime') as HTMLElement).textContent = 'GPU加速';
    (document.getElementById('resolution') as HTMLElement).textContent = `${(stats.activeParticles / stats.totalParticles * 100).toFixed(1)}%`;
    
    const freePercent = (stats.freeParticles / stats.totalParticles * 100).toFixed(1);
    (document.getElementById('freeParticles') as HTMLElement).textContent = `${stats.freeParticles.toLocaleString()} (${freePercent}%)`;
  }

  private animate = (): void => {
    if (!this.isRunning) return;
    
    requestAnimationFrame(this.animate);
    
    const time = performance.now() * 0.001;
    const dt = Math.min(time - this.lastTime, 0.05);
    this.lastTime = time;
    
    this.frameCount++;
    if (this.frameCount >= 30) {
      this.fps = 1 / dt;
      this.frameCount = 0;
      this.updateStats();
    }
    
    const device = this.gpuDevice.device;
    const commandEncoder = device.createCommandEncoder();
    
    const cameraPos = this.renderer.getCameraPosition();
    
    this.particlePool.update(
      dt,
      cameraPos,
      { x: this.params.windX, y: this.params.windY, z: this.params.windZ },
      this.params.dissipation,
      commandEncoder
    );
    
    this.renderer.render(
      this.particlePool.getParticleBuffer(),
      this.particlePool.getMaxRenderDistance(),
      time,
      commandEncoder
    );
    
    device.queue.submit([commandEncoder.finish()]);
  };

  destroy(): void {
    this.isRunning = false;
  }
}

let app: FluidSimulationApp;

async function init(): Promise<void> {
  try {
    if (!navigator.gpu) {
      alert('您的浏览器不支持 WebGPU，请使用最新版本的 Chrome、Edge 或 Firefox 浏览器');
      return;
    }
    
    app = new FluidSimulationApp();
    await app.init();
  } catch (error) {
    console.error('初始化失败:', error);
    alert('初始化失败: ' + (error as Error).message);
  }
}

init();
