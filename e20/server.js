import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

const renderTodoWidgetSSR = (todos = []) => {
  const stats = {
    total: todos.length,
    active: todos.filter(t => !t.completed).length,
    completed: todos.filter(t => t.completed).length
  };

  const todoItemsHTML = todos.map((todo, index) => `
    <li class="todo-item ${todo.completed ? 'completed' : ''}" style="animation-delay: ${index * 0.05}s">
      <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''} data-id="${todo.id}">
      <span class="todo-text">${todo.text}</span>
      <button class="delete-btn" data-id="${todo.id}">
        <i class="fas fa-trash"></i>
      </button>
    </li>
  `).join('');

  return `
    <style>
      .todo-widget {
        display: block;
        font-family: 'Inter', sans-serif;
      }
      
      .widget-header {
        margin-bottom: 1.5rem;
        padding-bottom: 1rem;
        border-bottom: 2px solid #f3f4f6;
      }
      
      .widget-header h2 {
        font-family: 'Poppins', sans-serif;
        font-size: 1.5rem;
        color: #374151;
        margin-bottom: 0.25rem;
        margin-top: 0;
      }
      
      .widget-header p {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0;
      }
      
      .stats-bar {
        display: flex;
        gap: 1rem;
        margin-bottom: 1.5rem;
      }
      
      .stat-item {
        flex: 1;
        padding: 0.75rem 1rem;
        background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
        border-radius: 8px;
        text-align: center;
      }
      
      .stat-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: #667eea;
      }
      
      .stat-label {
        font-size: 0.75rem;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      
      .add-todo-form {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1.5rem;
      }
      
      .add-todo-input {
        flex: 1;
        padding: 0.75rem 1rem;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        font-size: 0.9rem;
        font-family: inherit;
        transition: all 0.3s ease;
      }
      
      .add-todo-input:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
      }
      
      .add-btn {
        padding: 0.75rem 1.5rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        font-family: inherit;
      }
      
      .add-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }
      
      .filter-tabs {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }
      
      .filter-tab {
        padding: 0.5rem 1rem;
        border: none;
        background: #f3f4f6;
        border-radius: 6px;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.3s ease;
        font-family: inherit;
      }
      
      .filter-tab.active {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }
      
      .todo-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      
      .todo-item {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        background: #f9fafb;
        border-radius: 8px;
        margin-bottom: 0.5rem;
        transition: all 0.3s ease;
      }
      
      .todo-item:hover {
        background: #f3f4f6;
        transform: translateX(4px);
      }
      
      .todo-item.completed .todo-text {
        text-decoration: line-through;
        color: #9ca3af;
      }
      
      .todo-checkbox {
        width: 1.25rem;
        height: 1.25rem;
        cursor: pointer;
        accent-color: #667eea;
      }
      
      .todo-text {
        flex: 1;
        font-size: 0.95rem;
        color: #374151;
      }
      
      .delete-btn {
        padding: 0.5rem;
        background: #fee2e2;
        color: #ef4444;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.3s ease;
      }
      
      .delete-btn:hover {
        background: #ef4444;
        color: white;
      }
      
      .empty-state {
        text-align: center;
        padding: 3rem 1rem;
        color: #9ca3af;
      }
      
      .empty-state i {
        font-size: 3rem;
        margin-bottom: 1rem;
        color: #d1d5db;
      }
      
      .empty-state h3 {
        margin-bottom: 0.5rem;
        color: #6b7280;
      }
      
      .widget-footer {
        margin-top: 1.5rem;
        padding-top: 1rem;
        border-top: 2px solid #f3f4f6;
        text-align: center;
        font-size: 0.75rem;
        color: #9ca3af;
      }
      
      .widget-footer span {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        background: #f3f4f6;
        border-radius: 12px;
      }
    </style>
    
    <div class="todo-widget" data-ssr="true">
      <div class="widget-header">
        <h2><i class="fas fa-check-square"></i> 待办事项</h2>
        <p>SSR 预渲染内容 - 等待注水...</p>
      </div>

      <div class="stats-bar">
        <div class="stat-item">
          <div class="stat-value">${stats.total}</div>
          <div class="stat-label">全部</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.active}</div>
          <div class="stat-label">待完成</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${stats.completed}</div>
          <div class="stat-label">已完成</div>
        </div>
      </div>

      <form class="add-todo-form">
        <input type="text" class="add-todo-input" placeholder="添加新的待办事项...">
        <button type="submit" class="add-btn">
          <i class="fas fa-plus"></i> 添加
        </button>
      </form>

      <div class="filter-tabs">
        <button class="filter-tab active" data-filter="all">全部</button>
        <button class="filter-tab" data-filter="active">待完成</button>
        <button class="filter-tab" data-filter="completed">已完成</button>
      </div>

      ${todos.length === 0 ? `
        <div class="empty-state">
          <i class="fas fa-inbox"></i>
          <h3>暂无待办事项</h3>
          <p>点击上方"加载数据"按钮获取示例数据</p>
        </div>
      ` : `
        <ul class="todo-list">
          ${todoItemsHTML}
        </ul>
      `}

      <div class="widget-footer">
        <span><i class="fas fa-cube"></i> SSR 预渲染 - Todo Widget</span>
      </div>
    </div>
  `;
};

app.get('/api/ssr/todo-widget', (req, res) => {
  const sampleTodos = [
    { id: 1, text: '学习 Web Components 基础概念', completed: true },
    { id: 2, text: '实现自定义元素生命周期管理', completed: true },
    { id: 3, text: '使用 Shadow DOM 实现样式隔离', completed: false },
    { id: 4, text: '通过 CustomEvent 实现跨组件通信', completed: false },
    { id: 5, text: '集成 Lit 框架简化开发', completed: false },
    { id: 6, text: '实现 SSR 服务端渲染', completed: true }
  ];

  const html = renderTodoWidgetSSR(sampleTodos);
  
  res.json({
    success: true,
    html: html,
    data: {
      todos: sampleTodos
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Micro-Frontend SSR Server',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           🚀 微前端 SSR 服务已启动                           ║
╠══════════════════════════════════════════════════════════════╣
║   🌐 服务地址:  http://localhost:${PORT}                       ║
║   📦 SSR 接口:  GET /api/ssr/todo-widget                     ║
║   🏥 健康检查:  GET /api/health                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
