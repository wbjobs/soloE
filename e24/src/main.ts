import { FluidSimulation } from './FluidSimulation';

async function main() {
  const canvas = document.getElementById('fluidCanvas') as HTMLCanvasElement;
  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }
  
  if (!navigator.gpu) {
    showNoWebGPUSupport();
    return;
  }
  
  const fluid = new FluidSimulation(canvas, {
    resolution: [512, 512],
    dt: 0.016,
    mouseForce: 8000,
    mouseRadius: 0.15,
    pressureIterations: 40,
    dissipation: 0.5
  });
  
  try {
    await fluid.init();
    fluid.resize();
    
    window.addEventListener('resize', () => {
      fluid.resize();
    });
    
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    
    const animate = () => {
      fluid.step();
      fluid.render();
      
      frameCount++;
      const now = performance.now();
      if (now - lastFpsUpdate >= 1000) {
        const fpsElement = document.getElementById('fps');
        if (fpsElement) {
          fpsElement.textContent = `FPS: ${frameCount}`;
        }
        frameCount = 0;
        lastFpsUpdate = now;
      }
      
      requestAnimationFrame(animate);
    };
    
    animate();
  } catch (error) {
    console.error('Failed to initialize fluid simulation:', error);
    showNoWebGPUSupport();
  }
}

function showNoWebGPUSupport() {
  const app = document.getElementById('app');
  if (!app) return;
  
  app.innerHTML = `
    <div style="
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: white;
      background: rgba(0, 0, 0, 0.8);
      padding: 40px;
      border-radius: 16px;
      max-width: 500px;
    ">
      <h2 style="color: #ff6b6b; margin-bottom: 20px; font-size: 24px;">
        WebGPU 不支持
      </h2>
      <p style="margin-bottom: 15px; opacity: 0.9; line-height: 1.6;">
        您的浏览器不支持 WebGPU API。请使用以下浏览器之一：
      </p>
      <ul style="text-align: left; margin: 20px 0; opacity: 0.8;">
        <li>Chrome 113+</li>
        <li>Edge 113+</li>
        <li>Firefox Nightly（需要开启 webgpu.enable 标志）</li>
        <li>Safari 16.4+</li>
      </ul>
      <p style="opacity: 0.7; font-size: 14px;">
        请更新您的浏览器或使用支持 WebGPU 的浏览器。
      </p>
    </div>
  `;
}

main();
