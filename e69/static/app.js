class SchedulerUI {
    constructor() {
        this.init();
    }

    init() {
        this.bindEvents();
        this.startDataRefresh();
        this.loadInitialData();
    }

    bindEvents() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        document.getElementById('createWorkflowBtn').addEventListener('click', () => this.showModal('workflowModal'));
        document.getElementById('createModuleBtn').addEventListener('click', () => this.showModal('moduleModal'));

        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.closeModal(e.target.closest('.modal').id));
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModal(modal.id);
            });
        });

        document.getElementById('workflowForm').addEventListener('submit', (e) => this.handleWorkflowSubmit(e));
        document.getElementById('moduleForm').addEventListener('submit', (e) => this.handleModuleSubmit(e));
        document.getElementById('taskForm').addEventListener('submit', (e) => this.handleTaskSubmit(e));
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(tabName).classList.add('active');
    }

    showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
        const form = document.querySelector(`#${modalId} form`);
        if (form) form.reset();
    }

    async loadInitialData() {
        await Promise.all([
            this.loadClusterStats(),
            this.loadWorkers(),
            this.loadWorkflows(),
            this.loadModules(),
            this.loadMetrics()
        ]);
        this.updateLastUpdate();
    }

    startDataRefresh() {
        setInterval(() => this.loadInitialData(), 5000);
    }

    async loadClusterStats() {
        try {
            const response = await fetch('/api/cluster/stats');
            const data = await response.json();
            if (data.success) {
                this.updateClusterStats(data.data);
            }
        } catch (error) {
            console.error('Failed to load cluster stats:', error);
        }
    }

    updateClusterStats(stats) {
        document.getElementById('totalWorkers').textContent = stats.total_workers;
        document.getElementById('onlineWorkers').textContent = stats.online_workers;
        document.getElementById('runningTasks').textContent = stats.total_running_tasks;
        document.getElementById('usedMemory').textContent = stats.total_memory_mb - stats.available_memory_mb;
        document.getElementById('totalMemory').textContent = stats.total_memory_mb;
    }

    async loadWorkers() {
        try {
            const response = await fetch('/api/cluster/workers');
            const data = await response.json();
            if (data.success) {
                this.renderWorkers(data.data);
            }
        } catch (error) {
            console.error('Failed to load workers:', error);
        }
    }

    renderWorkers(workers) {
        const tbody = document.getElementById('workersTable');
        if (workers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">暂无工作节点，运行在本地模式</td></tr>';
            return;
        }

        tbody.innerHTML = workers.map(worker => `
            <tr>
                <td><strong>${worker.name}</strong></td>
                <td><span class="worker-status ${worker.status}">${worker.status}</span></td>
                <td>${worker.cpu_cores || 'N/A'}</td>
                <td>${worker.available_memory_mb || 'N/A'} MB</td>
                <td>${worker.running_tasks || 0}</td>
                <td>${this.formatTimestamp(worker.last_heartbeat)}</td>
            </tr>
        `).join('');
    }

    async loadWorkflows() {
        try {
            const response = await fetch('/api/workflows');
            const data = await response.json();
            if (data.success) {
                this.renderWorkflows(data.data);
                document.getElementById('totalWorkflows').textContent = data.data.length;
            }
        } catch (error) {
            console.error('Failed to load workflows:', error);
        }
    }

    renderWorkflows(workflows) {
        const grid = document.getElementById('workflowsGrid');
        if (workflows.length === 0) {
            grid.innerHTML = '<div class="loading">暂无工作流，点击上方按钮创建</div>';
            return;
        }

        grid.innerHTML = workflows.map(workflow => `
            <div class="workflow-card">
                <div class="workflow-header">
                    <span class="workflow-name">${workflow.name}</span>
                    <span class="workflow-status status-${workflow.status}">${this.capitalizeFirst(workflow.status)}</span>
                </div>
                <p class="workflow-desc">${workflow.description || '无描述'}</p>
                <div class="workflow-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${workflow.progress || 0}%"></div>
                    </div>
                    <div class="progress-text">${Math.round(workflow.progress || 0)}% 完成</div>
                </div>
                <div class="workflow-tasks">
                    <h4>任务 (${workflow.tasks.length})</h4>
                    <div class="task-list">
                        ${workflow.tasks.slice(0, 3).map(task => `
                            <div class="task-item">
                                <span class="task-dot" style="background: ${this.getTaskStatusColor(task.status)}"></span>
                                <span>${task.name}</span>
                            </div>
                        `).join('')}
                        ${workflow.tasks.length > 3 ? `<div class="task-item"><span>... 还有 ${workflow.tasks.length - 3} 个任务</span></div>` : ''}
                    </div>
                </div>
                <div class="workflow-actions">
                    ${workflow.status === 'pending' ? `
                        <button class="btn btn-primary" onclick="schedulerUI.startWorkflow('${workflow.id}')">启动</button>
                    ` : workflow.status === 'running' ? `
                        <button class="btn btn-secondary" onclick="schedulerUI.addTaskModal('${workflow.id}')">添加任务</button>
                    ` : ''}
                    <button class="btn btn-danger" onclick="schedulerUI.cancelWorkflow('${workflow.id}')">取消</button>
                </div>
            </div>
        `).join('');
    }

    async loadModules() {
        try {
            const response = await fetch('/api/modules');
            const data = await response.json();
            if (data.success) {
                this.renderModules(data.data);
            }
        } catch (error) {
            console.error('Failed to load modules:', error);
        }
    }

    renderModules(modules) {
        const tbody = document.getElementById('modulesTable');
        if (modules.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading">暂无已加载模块</td></tr>';
            return;
        }

        tbody.innerHTML = modules.map(module => `
            <tr>
                <td><strong>${module.name}</strong></td>
                <td><code>${module.id.substring(0, 12)}...</code></td>
                <td><span class="priority-badge priority-${this.getPriorityClass(module.priority)}">${this.getPriorityName(module.priority)}</span></td>
                <td>${this.formatTimestamp(module.loaded_at)}</td>
                <td>
                    <button class="btn btn-danger" onclick="schedulerUI.unloadModule('${module.id}')">卸载</button>
                </td>
            </tr>
        `).join('');
    }

    async loadMetrics() {
        try {
            const [execResponse, queueResponse] = await Promise.all([
                fetch('/api/metrics/execution'),
                fetch('/api/metrics/queue')
            ]);
            const execData = await execResponse.json();
            const queueData = await queueResponse.json();
            
            if (execData.success) {
                this.updateExecutionMetrics(execData.data);
            }
            if (queueData.success) {
                this.updateQueueMetrics(queueData.data);
            }
        } catch (error) {
            console.error('Failed to load metrics:', error);
        }
    }

    updateExecutionMetrics(metrics) {
        document.getElementById('totalExecutions').textContent = metrics.total_executions;
        document.getElementById('metricTotal').textContent = metrics.total_executions;
        document.getElementById('metricSuccess').textContent = metrics.successful_executions;
        document.getElementById('metricFailed').textContent = metrics.failed_executions;
        document.getElementById('metricAvgTime').textContent = metrics.avg_execution_time_ms.toFixed(2) + ' ms';
    }

    updateQueueMetrics(metrics) {
        document.getElementById('queueLength').textContent = metrics.current_queue_length;
        document.getElementById('metricQueueLen').textContent = metrics.current_queue_length;
        document.getElementById('metricPeakLen').textContent = metrics.peak_queue_length;
        document.getElementById('metricEnqueued').textContent = metrics.total_enqueued;
        document.getElementById('metricDequeued').textContent = metrics.total_dequeued;
    }

    async handleWorkflowSubmit(e) {
        e.preventDefault();
        const name = document.getElementById('workflowName').value;
        const description = document.getElementById('workflowDesc').value;

        try {
            const response = await fetch('/api/workflows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
            const data = await response.json();
            if (data.success) {
                this.closeModal('workflowModal');
                this.loadWorkflows();
                alert('工作流创建成功！');
            } else {
                alert('创建失败: ' + data.error);
            }
        } catch (error) {
            alert('创建失败: ' + error.message);
        }
    }

    addTaskModal(workflowId) {
        document.getElementById('taskWorkflowId').value = workflowId;
        this.loadModuleOptions();
        this.showModal('taskModal');
    }

    async loadModuleOptions() {
        try {
            const response = await fetch('/api/modules');
            const data = await response.json();
            if (data.success) {
                const select = document.getElementById('taskModuleId');
                select.innerHTML = '<option value="">选择模块</option>' + 
                    data.data.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            }
        } catch (error) {
            console.error('Failed to load module options:', error);
        }
    }

    async handleTaskSubmit(e) {
        e.preventDefault();
        const workflowId = document.getElementById('taskWorkflowId').value;
        const name = document.getElementById('taskName').value;
        const moduleId = document.getElementById('taskModuleId').value;
        const dependsStr = document.getElementById('taskDepends').value;
        const depends_on = dependsStr ? dependsStr.split(',').map(s => s.trim()).filter(s => s) : [];

        try {
            const response = await fetch(`/api/workflows/${workflowId}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, module_id: moduleId, depends_on })
            });
            const data = await response.json();
            if (data.success) {
                this.closeModal('taskModal');
                this.loadWorkflows();
                alert('任务添加成功！');
            } else {
                alert('添加失败: ' + data.error);
            }
        } catch (error) {
            alert('添加失败: ' + error.message);
        }
    }

    async handleModuleSubmit(e) {
        e.preventDefault();
        const name = document.getElementById('moduleName').value;
        const path = document.getElementById('modulePath').value;
        const priority = parseInt(document.getElementById('modulePriority').value);

        try {
            const response = await fetch('/api/modules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, path, priority })
            });
            const data = await response.json();
            if (data.success) {
                this.closeModal('moduleModal');
                this.loadModules();
                alert('模块加载成功！');
            } else {
                alert('加载失败: ' + data.error);
            }
        } catch (error) {
            alert('加载失败: ' + error.message);
        }
    }

    async startWorkflow(workflowId) {
        try {
            const response = await fetch(`/api/workflows/${workflowId}/start`, { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                this.loadWorkflows();
                alert('工作流已启动！');
            } else {
                alert('启动失败: ' + data.error);
            }
        } catch (error) {
            alert('启动失败: ' + error.message);
        }
    }

    async cancelWorkflow(workflowId) {
        if (!confirm('确定要取消这个工作流吗？')) return;
        try {
            const response = await fetch(`/api/workflows/${workflowId}/cancel`, { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                this.loadWorkflows();
                alert('工作流已取消！');
            } else {
                alert('取消失败: ' + data.error);
            }
        } catch (error) {
            alert('取消失败: ' + error.message);
        }
    }

    async unloadModule(moduleId) {
        if (!confirm('确定要卸载这个模块吗？')) return;
        try {
            const response = await fetch(`/api/modules/${moduleId}`, { method: 'DELETE' });
            const data = await response.json();
            if (data.success) {
                this.loadModules();
                alert('模块已卸载！');
            } else {
                alert('卸载失败: ' + data.error);
            }
        } catch (error) {
            alert('卸载失败: ' + error.message);
        }
    }

    updateLastUpdate() {
        const now = new Date();
        document.getElementById('lastUpdate').textContent = `最后更新: ${now.toLocaleTimeString()}`;
    }

    getPriorityClass(priority) {
        const classes = ['low', 'normal', 'high', 'critical'];
        return classes[priority] || 'normal';
    }

    getPriorityName(priority) {
        const names = ['低', '普通', '高', '关键'];
        return names[priority] || '普通';
    }

    getTaskStatusColor(status) {
        const colors = {
            pending: '#f59e0b',
            running: '#3b82f6',
            completed: '#22c55e',
            failed: '#ef4444',
            cancelled: '#6b7280'
        };
        return colors[status] || '#6b7280';
    }

    capitalizeFirst(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return 'N/A';
        const date = new Date(timestamp);
        return date.toLocaleString();
    }
}

const schedulerUI = new SchedulerUI();
