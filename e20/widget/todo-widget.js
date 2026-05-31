import { LitElement, html, css } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

class TodoWidget extends LitElement {
  static properties = {
    todos: { type: Array },
    newTodoText: { type: String },
    filter: { type: String },
    isLoading: { type: Boolean }
  };

  static styles = css`
    :host {
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
    }

    .widget-header p {
      font-size: 0.875rem;
      color: #6b7280;
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
      animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(-20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
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

    .loading-state {
      text-align: center;
      padding: 2rem;
    }

    .loading-state i {
      font-size: 2rem;
      color: #667eea;
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
  `;

  constructor() {
    super();
    this.todos = [];
    this.newTodoText = '';
    this.filter = 'all';
    this.isLoading = false;
    this._initialTodos = null;
  }

  static get properties() {
    return {
      todos: { type: Array },
      initialTodos: { type: Array, attribute: false }
    };
  }

  set initialTodos(value) {
    this._initialTodos = value;
    if (value && value.length > 0) {
      this.todos = [...value];
    }
  }

  get initialTodos() {
    return this._initialTodos;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('load-data', this.handleLoadData.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('load-data', this.handleLoadData.bind(this));
  }

  handleLoadData(event) {
    this.isLoading = true;
    
    setTimeout(() => {
      if (event.detail && event.detail.todos) {
        this.todos = [...event.detail.todos];
        
        const dataLoadedEvent = new CustomEvent('data-loaded', {
          detail: {
            status: 'success',
            count: this.todos.length,
            timestamp: new Date().toISOString()
          },
          bubbles: true,
          composed: true
        });
        this.dispatchEvent(dataLoadedEvent);
      }
      this.isLoading = false;
    }, 500);
  }

  get filteredTodos() {
    switch (this.filter) {
      case 'active':
        return this.todos.filter(todo => !todo.completed);
      case 'completed':
        return this.todos.filter(todo => todo.completed);
      default:
        return this.todos;
    }
  }

  get stats() {
    const total = this.todos.length;
    const completed = this.todos.filter(t => t.completed).length;
    const active = total - completed;
    return { total, completed, active };
  }

  handleInputChange(e) {
    this.newTodoText = e.target.value;
  }

  handleAddTodo(e) {
    e.preventDefault();
    if (!this.newTodoText.trim()) return;

    const newTodo = {
      id: Date.now(),
      text: this.newTodoText.trim(),
      completed: false
    };
    this.todos = [...this.todos, newTodo];
    this.newTodoText = '';
  }

  handleToggleTodo(todoId) {
    this.todos = this.todos.map(todo => 
      todo.id === todoId ? { ...todo, completed: !todo.completed } : todo
    );
  }

  handleDeleteTodo(todoId) {
    this.todos = this.todos.filter(todo => todo.id !== todoId);
  }

  setFilter(filterType) {
    this.filter = filterType;
  }

  render() {
    return html`
      <div class="todo-widget">
        <div class="widget-header">
          <h2><i class="fas fa-check-square"></i> 待办事项</h2>
          <p>子应用运行中 - 使用 Lit + Web Components</p>
        </div>

        <div class="stats-bar">
          <div class="stat-item">
            <div class="stat-value">${this.stats.total}</div>
            <div class="stat-label">全部</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${this.stats.active}</div>
            <div class="stat-label">待完成</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${this.stats.completed}</div>
            <div class="stat-label">已完成</div>
          </div>
        </div>

        <form class="add-todo-form" @submit="${this.handleAddTodo}">
          <input 
            type="text" 
            class="add-todo-input" 
            placeholder="添加新的待办事项..."
            .value="${this.newTodoText}"
            @input="${this.handleInputChange}"
          >
          <button type="submit" class="add-btn">
            <i class="fas fa-plus"></i> 添加
          </button>
        </form>

        <div class="filter-tabs">
          <button 
            class="filter-tab ${this.filter === 'all' ? 'active' : ''}"
            @click="${() => this.setFilter('all')}"
          >
            全部
          </button>
          <button 
            class="filter-tab ${this.filter === 'active' ? 'active' : ''}"
            @click="${() => this.setFilter('active')}"
          >
            待完成
          </button>
          <button 
            class="filter-tab ${this.filter === 'completed' ? 'active' : ''}"
            @click="${() => this.setFilter('completed')}"
          >
            已完成
          </button>
        </div>

        ${this.isLoading ? html`
          <div class="loading-state">
            <i class="fas fa-spinner fa-spin"></i>
            <p>正在加载数据...</p>
          </div>
        ` : ''}

        ${!this.isLoading && this.filteredTodos.length === 0 ? html`
          <div class="empty-state">
            <i class="fas fa-inbox"></i>
            <h3>暂无待办事项</h3>
            <p>点击上方"加载数据"按钮获取示例数据</p>
          </div>
        ` : html`
          <ul class="todo-list">
            ${this.filteredTodos.map((todo, index) => html`
              <li 
                class="todo-item ${classMap({ completed: todo.completed })}"
                style="animation-delay: ${index * 0.05}s"
              >
                <input 
                  type="checkbox" 
                  class="todo-checkbox"
                  ?checked="${todo.completed}"
                  @change="${() => this.handleToggleTodo(todo.id)}"
                >
                <span class="todo-text">${todo.text}</span>
                <button 
                  class="delete-btn"
                  @click="${() => this.handleDeleteTodo(todo.id)}"
                >
                  <i class="fas fa-trash"></i>
                </button>
              </li>
            `)}
          </ul>
        `}

        <div class="widget-footer">
          <span><i class="fas fa-cube"></i> 子应用: Todo Widget v1.0</span>
        </div>
      </div>
    `;
  }
}

customElements.define('todo-widget', TodoWidget);
