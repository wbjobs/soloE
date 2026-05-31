import './widget/todo-widget.js';

class MicroFrontend extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.ssrData = null;
    this.isHydrated = false;
  }

  connectedCallback() {
    this.renderLoading();
    this.loadSSRContent();
  }

  renderLoading() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        
        .ssr-loading {
          text-align: center;
          padding: 3rem;
          color: #6b7280;
        }
        
        .ssr-loading i {
          font-size: 2rem;
          color: #667eea;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        .ssr-container {
          transition: opacity 0.3s ease;
        }
        
        .ssr-container.hydrating {
          opacity: 0.5;
        }
        
        .hydrate-badge {
          position: absolute;
          top: 1rem;
          right: 1rem;
          padding: 0.25rem 0.75rem;
          background: #10b981;
          color: white;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          z-index: 10;
          animation: fadeIn 0.3s ease;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
      </style>
      <div class="ssr-loading">
        <i class="fas fa-circle-notch"></i>
        <p>正在加载 SSR 内容...</p>
      </div>
    `;
  }

  async loadSSRContent() {
    try {
      const response = await fetch('http://localhost:3002/api/ssr/todo-widget');
      const result = await response.json();
      
      if (result.success) {
        this.ssrData = result.data;
        this.renderSSRContent(result.html);
        this.hydrate();
      } else {
        this.fallbackToClientRender();
      }
    } catch (error) {
      console.warn('SSR 服务不可用，回退到客户端渲染:', error);
      this.fallbackToClientRender();
    }
  }

  renderSSRContent(html) {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          position: relative;
        }
        
        .ssr-container {
          transition: opacity 0.3s ease;
        }
        
        .ssr-container.hydrating {
          opacity: 0.5;
        }
        
        .hydrate-badge {
          position: absolute;
          top: 1rem;
          right: 1rem;
          padding: 0.25rem 0.75rem;
          background: #10b981;
          color: white;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          z-index: 10;
          animation: fadeIn 0.3s ease;
          font-family: 'Inter', sans-serif;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
      </style>
      <div class="ssr-container" id="ssr-content">
        ${html}
      </div>
    `;
    this.dispatchHydrationEvent('ssr-loaded');
  }

  async hydrate() {
    await new Promise(resolve => setTimeout(resolve, 800));
    
    const ssrContainer = this.shadowRoot.getElementById('ssr-content');
    if (ssrContainer) {
      ssrContainer.classList.add('hydrating');
    }
    
    await customElements.whenDefined('todo-widget');
    
    const todoWidget = document.createElement('todo-widget');
    
    if (this.ssrData && this.ssrData.todos) {
      todoWidget.initialTodos = this.ssrData.todos;
    }
    
    if (ssrContainer) {
      ssrContainer.parentNode.replaceChild(todoWidget, ssrContainer);
    } else {
      this.shadowRoot.appendChild(todoWidget);
    }
    
    this.isHydrated = true;
    this.setupEventListeners(todoWidget);
    this.dispatchHydrationEvent('hydrated');
    
    const badge = document.createElement('div');
    badge.className = 'hydrate-badge';
    badge.innerHTML = '<i class="fas fa-check-circle"></i> 已注水';
    this.shadowRoot.appendChild(badge);
    
    setTimeout(() => badge.remove(), 3000);
  }

  fallbackToClientRender() {
    const todoWidget = document.createElement('todo-widget');
    this.shadowRoot.innerHTML = '';
    this.shadowRoot.appendChild(todoWidget);
    this.isHydrated = true;
    this.setupEventListeners(todoWidget);
    this.dispatchHydrationEvent('client-render');
  }

  setupEventListeners(todoWidget) {
    document.addEventListener('load-data', (event) => {
      if (todoWidget && todoWidget.handleLoadData) {
        todoWidget.handleLoadData(event);
      }
    });
  }

  dispatchHydrationEvent(status) {
    const event = new CustomEvent('hydration-status', {
      detail: {
        status,
        timestamp: new Date().toISOString()
      },
      bubbles: true,
      composed: true
    });
    this.dispatchEvent(event);
  }
}

customElements.define('micro-frontend', MicroFrontend);

document.addEventListener('DOMContentLoaded', () => {
  const eventLog = document.getElementById('event-log');
  const loadDataBtn = document.getElementById('btn-load-data');
  const homeBtn = document.getElementById('btn-home');
  const ssrBtn = document.getElementById('btn-ssr-reload');

  const sampleTodos = [
    { id: 1, text: '学习 Web Components 基础概念', completed: true },
    { id: 2, text: '实现自定义元素生命周期管理', completed: true },
    { id: 3, text: '使用 Shadow DOM 实现样式隔离', completed: false },
    { id: 4, text: '通过 CustomEvent 实现跨组件通信', completed: false },
    { id: 5, text: '集成 Lit 框架简化开发', completed: false },
    { id: 6, text: '实现响应式状态管理', completed: false }
  ];

  loadDataBtn.addEventListener('click', () => {
    eventLog.textContent = '正在发送 load-data 事件...';
    
    const event = new CustomEvent('load-data', {
      detail: {
        todos: sampleTodos,
        timestamp: new Date().toISOString()
      },
      bubbles: true,
      composed: true
    });

    document.dispatchEvent(event);
    
    setTimeout(() => {
      eventLog.textContent = '数据已发送到子应用 ✓';
    }, 300);
  });

  document.addEventListener('data-loaded', (event) => {
    eventLog.textContent = `子应用已加载 ${event.detail.count} 条数据 ✓`;
  });

  document.addEventListener('hydration-status', (event) => {
    const status = event.detail.status;
    switch (status) {
      case 'ssr-loaded':
        eventLog.textContent = 'SSR 内容已加载 ✓';
        break;
      case 'hydrated':
        eventLog.textContent = '注水完成 ✓ Web Component 已激活';
        break;
      case 'client-render':
        eventLog.textContent = '客户端渲染模式 ✓';
        break;
    }
  });

  if (ssrBtn) {
    ssrBtn.addEventListener('click', () => {
      eventLog.textContent = '重新加载 SSR 内容...';
      const microFrontend = document.querySelector('micro-frontend');
      if (microFrontend) {
        microFrontend.loadSSRContent();
      }
    });
  }

  homeBtn.addEventListener('click', () => {
    eventLog.textContent = '返回首页 ✓';
  });

  eventLog.textContent = '正在连接 SSR 服务...';
});
