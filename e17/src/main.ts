import { FluidRenderer } from './renderer';

const PARTICLE_COUNT = 8192;

class FluidSimulation {
  private canvas: HTMLCanvasElement;
  private renderer!: FluidRenderer;
  private mouseX: number = 0;
  private mouseY: number = 0;
  private isMouseDown: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.init();
    this.setupEventListeners();
  }

  private async init() {
    if (!navigator.gpu) {
      alert('您的浏览器不支持 WebGPU，请使用最新版 Chrome 或 Edge');
      return;
    }

    this.renderer = new FluidRenderer(this.canvas, PARTICLE_COUNT);
    await this.renderer.init();

    const particleCountEl = document.getElementById('particleCount');
    if (particleCountEl) {
      particleCountEl.textContent = `粒子数量: ${PARTICLE_COUNT}`;
    }

    this.setupViscosityControl();
    this.animate();
  }

  private setupViscosityControl() {
    const slider = document.getElementById('viscosity') as HTMLInputElement;
    const valueDisplay = document.getElementById('viscosityValue');
    
    if (slider && valueDisplay) {
      slider.addEventListener('input', () => {
        const value = parseFloat(slider.value);
        this.renderer.setViscosity(value);
        valueDisplay.textContent = value.toFixed(4);
      });
    }
  }

  private setupEventListeners() {
    window.addEventListener('resize', () => {
      if (this.renderer) {
        this.renderer.resize();
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.isMouseDown = true;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isMouseDown) {
        this.lastMouseX = this.mouseX;
        this.lastMouseY = this.mouseY;
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;

        const dx = this.mouseX - this.lastMouseX;
        const dy = this.mouseY - this.lastMouseY;
        this.renderer.updateMouse(this.mouseX, this.mouseY, dx, dy, true);
      }
    });

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.isMouseDown = true;
      this.mouseX = touch.clientX;
      this.mouseY = touch.clientY;
      this.lastMouseX = touch.clientX;
      this.lastMouseY = touch.clientY;
    });

    this.canvas.addEventListener('touchend', () => {
      this.isMouseDown = false;
    });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (this.isMouseDown) {
        const touch = e.touches[0];
        this.lastMouseX = this.mouseX;
        this.lastMouseY = this.mouseY;
        this.mouseX = touch.clientX;
        this.mouseY = touch.clientY;

        const dx = this.mouseX - this.lastMouseX;
        const dy = this.mouseY - this.lastMouseY;
        this.renderer.updateMouse(this.mouseX, this.mouseY, dx, dy, true);
      }
    });
  }

  private animate() {
    if (!this.isMouseDown) {
      this.renderer.updateMouse(0, 0, 0, 0, false);
    }
    this.renderer.render();
    requestAnimationFrame(() => this.animate());
  }
}

new FluidSimulation();
