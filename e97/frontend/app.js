const API_BASE = '/api';

let selectedFile = null;
let currentMeetingId = null;
let pollingInterval = null;

const elements = {
    uploadArea: document.getElementById('uploadArea'),
    fileInput: document.getElementById('fileInput'),
    meetingTitle: document.getElementById('meetingTitle'),
    numSpeakers: document.getElementById('numSpeakers'),
    uploadBtn: document.getElementById('uploadBtn'),
    uploadProgress: document.getElementById('uploadProgress'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    meetingsList: document.getElementById('meetingsList'),
    detailView: document.getElementById('detailView'),
    welcomeView: document.getElementById('welcomeView'),
    detailTitle: document.getElementById('detailTitle'),
    detailStatus: document.getElementById('detailStatus'),
    detailDuration: document.getElementById('detailDuration'),
    detailCreatedAt: document.getElementById('detailCreatedAt'),
    detailSummary: document.getElementById('detailSummary'),
    detailDecisions: document.getElementById('detailDecisions'),
    detailTodos: document.getElementById('detailTodos'),
    detailDisputes: document.getElementById('detailDisputes'),
    detailTranscription: document.getElementById('detailTranscription'),
    downloadXmindBtn: document.getElementById('downloadXmindBtn'),
    generateEmailBtn: document.getElementById('generateEmailBtn'),
    deleteBtn: document.getElementById('deleteBtn'),
    closeDetailBtn: document.getElementById('closeDetailBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toastMessage'),
    emailModal: document.getElementById('emailModal'),
    emailTemplate: document.getElementById('emailTemplate'),
    emailSubject: document.getElementById('emailSubject'),
    emailBody: document.getElementById('emailBody')
};

function showToast(message, duration = 3000) {
    elements.toastMessage.textContent = message;
    elements.toast.classList.remove('hidden');
    setTimeout(() => {
        elements.toast.classList.add('hidden');
    }, duration);
}

function formatDuration(seconds) {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getStatusBadge(status) {
    const statusMap = {
        'processing': { class: 'status-processing', text: '处理中' },
        'completed': { class: 'status-completed', text: '已完成' },
        'failed': { class: 'status-failed', text: '失败' }
    };
    return statusMap[status] || { class: '', text: status };
}

elements.uploadArea.addEventListener('click', () => {
    elements.fileInput.click();
});

elements.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        selectedFile = e.target.files[0];
        elements.uploadBtn.disabled = false;
        elements.uploadArea.querySelector('.upload-content p').textContent = `已选择: ${selectedFile.name}`;
    }
});

elements.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.uploadArea.classList.add('dragover');
});

elements.uploadArea.addEventListener('dragleave', () => {
    elements.uploadArea.classList.remove('dragover');
});

elements.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.uploadArea.classList.remove('dragover');
    
    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith('.m4a')) {
            selectedFile = file;
            elements.fileInput.files = e.dataTransfer.files;
            elements.uploadBtn.disabled = false;
            elements.uploadArea.querySelector('.upload-content p').textContent = `已选择: ${selectedFile.name}`;
        } else {
            showToast('请上传 .m4a 格式的文件');
        }
    }
});

elements.uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    elements.uploadBtn.disabled = true;
    elements.uploadProgress.classList.remove('hidden');
    elements.progressFill.style.width = '10%';
    elements.progressText.textContent = '正在上传...';

    const formData = new FormData();
    formData.append('file', selectedFile);
    
    const title = elements.meetingTitle.value.trim();
    if (title) {
        formData.append('title', title);
    }
    
    const speakers = elements.numSpeakers.value;
    if (speakers) {
        formData.append('num_speakers', speakers);
    }

    try {
        const response = await fetch(`${API_BASE}/meetings/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('上传失败');
        }

        const meeting = await response.json();
        elements.progressFill.style.width = '100%';
        elements.progressText.textContent = '上传成功，正在处理...';
        
        showToast('上传成功，会议正在处理中');
        
        loadMeetings();
        
        setTimeout(() => {
            elements.uploadProgress.classList.add('hidden');
            elements.progressFill.style.width = '0%';
            elements.meetingTitle.value = '';
            elements.numSpeakers.value = '';
            selectedFile = null;
            elements.fileInput.value = '';
            elements.uploadArea.querySelector('.upload-content p').textContent = '点击或拖拽 .m4a 文件到此处';
        }, 2000);

    } catch (error) {
        console.error('Upload error:', error);
        showToast('上传失败: ' + error.message);
        elements.uploadProgress.classList.add('hidden');
        elements.uploadBtn.disabled = false;
    }
});

elements.searchBtn.addEventListener('click', () => {
    const query = elements.searchInput.value.trim();
    if (query) {
        searchMeetings(query);
    } else {
        loadMeetings();
    }
});

elements.searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const query = elements.searchInput.value.trim();
        if (query) {
            searchMeetings(query);
        } else {
            loadMeetings();
        }
    }
});

elements.refreshBtn.addEventListener('click', () => {
    loadMeetings();
    if (currentMeetingId) {
        loadMeetingDetail(currentMeetingId);
    }
    showToast('已刷新');
});

elements.closeDetailBtn.addEventListener('click', () => {
    hideDetail();
});

elements.downloadXmindBtn.addEventListener('click', () => {
    if (currentMeetingId) {
        window.open(`${API_BASE}/meetings/${currentMeetingId}/xmind`, '_blank');
    }
});

elements.generateEmailBtn.addEventListener('click', () => {
    if (currentMeetingId) {
        generateEmail();
    }
});

elements.emailTemplate.addEventListener('change', () => {
    if (currentMeetingId) {
        generateEmail();
    }
});

elements.deleteBtn.addEventListener('click', async () => {
    if (!currentMeetingId) return;
    
    if (confirm('确定要删除这个会议记录吗？')) {
        try {
            const response = await fetch(`${API_BASE}/meetings/${currentMeetingId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                showToast('删除成功');
                hideDetail();
                loadMeetings();
            } else {
                throw new Error('删除失败');
            }
        } catch (error) {
            console.error('Delete error:', error);
            showToast('删除失败');
        }
    }
});

async function loadMeetings() {
    try {
        const response = await fetch(`${API_BASE}/meetings?limit=50`);
        const meetings = await response.json();
        renderMeetingsList(meetings);
    } catch (error) {
        console.error('Load meetings error:', error);
        elements.meetingsList.innerHTML = '<div class="loading">加载失败</div>';
    }
}

async function searchMeetings(query) {
    try {
        const response = await fetch(`${API_BASE}/meetings/search?q=${encodeURIComponent(query)}`);
        const result = await response.json();
        renderMeetingsList(result.meetings);
        showToast(`找到 ${result.total} 个相关会议`);
    } catch (error) {
        console.error('Search error:', error);
        elements.meetingsList.innerHTML = '<div class="loading">搜索失败</div>';
    }
}

function renderMeetingsList(meetings) {
    if (meetings.length === 0) {
        elements.meetingsList.innerHTML = '<div class="loading">暂无会议记录</div>';
        return;
    }

    elements.meetingsList.innerHTML = meetings.map(meeting => {
        const status = getStatusBadge(meeting.status);
        return `
            <div class="meeting-item ${meeting.id === currentMeetingId ? 'active' : ''}" 
                 data-id="${meeting.id}">
                <div class="meeting-title">${escapeHtml(meeting.title)}</div>
                <div class="meeting-meta">
                    <span>${formatDate(meeting.created_at)}</span>
                    <span class="status-badge ${status.class}">${status.text}</span>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.meeting-item').forEach(item => {
        item.addEventListener('click', () => {
            const meetingId = parseInt(item.dataset.id);
            loadMeetingDetail(meetingId);
        });
    });
}

async function loadMeetingDetail(meetingId) {
    try {
        currentMeetingId = meetingId;
        
        const response = await fetch(`${API_BASE}/meetings/${meetingId}`);
        const meeting = await response.json();
        
        renderMeetingDetail(meeting);
        showDetail();
        loadMeetings();
        
        if (meeting.status === 'processing') {
            startPolling(meetingId);
        } else {
            stopPolling();
        }
        
    } catch (error) {
        console.error('Load meeting detail error:', error);
        showToast('加载会议详情失败');
    }
}

function renderMeetingDetail(meeting) {
    elements.detailTitle.textContent = meeting.title;
    
    const status = getStatusBadge(meeting.status);
    elements.detailStatus.className = `status-badge ${status.class}`;
    elements.detailStatus.textContent = status.text;
    
    elements.detailDuration.textContent = formatDuration(meeting.duration);
    elements.detailCreatedAt.textContent = formatDate(meeting.created_at);
    
    if (meeting.summary) {
        elements.detailSummary.innerHTML = `<p>${escapeHtml(meeting.summary)}</p>`;
    } else {
        elements.detailSummary.innerHTML = '<p class="empty">暂无摘要</p>';
    }
    
    if (meeting.decisions && meeting.decisions.length > 0) {
        elements.detailDecisions.innerHTML = `
            <ul>
                ${meeting.decisions.map(d => `<li>${escapeHtml(d)}</li>`).join('')}
            </ul>
        `;
    } else {
        elements.detailDecisions.innerHTML = '<p class="empty">暂无决策</p>';
    }
    
    if (meeting.todos && meeting.todos.length > 0) {
        elements.detailTodos.innerHTML = meeting.todos.map(todo => `
            <div class="todo-item">
                <div class="task">${escapeHtml(todo.task || todo.content || '未命名任务')}</div>
                <div class="meta">
                    <span>👤 ${escapeHtml(todo.assignee || '未指定')}</span>
                    <span>📅 ${escapeHtml(todo.deadline || '未指定')}</span>
                </div>
            </div>
        `).join('');
    } else {
        elements.detailTodos.innerHTML = '<p class="empty">暂无待办事项</p>';
    }
    
    if (meeting.disputes && meeting.disputes.length > 0) {
        elements.detailDisputes.innerHTML = meeting.disputes.map(dispute => `
            <div class="dispute-item">
                <div class="issue">${escapeHtml(dispute.issue || '未命名争议')}</div>
                <ul class="points">
                    ${(dispute.points || []).map(p => `<li>${escapeHtml(p)}</li>`).join('')}
                </ul>
            </div>
        `).join('');
    } else {
        elements.detailDisputes.innerHTML = '<p class="empty">暂无争议点</p>';
    }
    
    if (meeting.transcription) {
        elements.detailTranscription.textContent = meeting.transcription;
    } else {
        elements.detailTranscription.innerHTML = '<p class="empty">暂无转录内容</p>';
    }
    
    elements.downloadXmindBtn.disabled = !meeting.xmind_path;
}

function showDetail() {
    elements.detailView.classList.remove('hidden');
    elements.welcomeView.classList.add('hidden');
}

function hideDetail() {
    elements.detailView.classList.add('hidden');
    elements.welcomeView.classList.remove('hidden');
    currentMeetingId = null;
    stopPolling();
    loadMeetings();
}

function startPolling(meetingId) {
    stopPolling();
    pollingInterval = setInterval(() => {
        if (currentMeetingId === meetingId) {
            loadMeetingDetail(meetingId);
        } else {
            stopPolling();
        }
    }, 5000);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function generateEmail() {
    if (!currentMeetingId) return;

    const template = elements.emailTemplate.value;
    
    try {
        const response = await fetch(`${API_BASE}/meetings/${currentMeetingId}/email?template=${template}`);
        const email = await response.json();

        elements.emailSubject.value = email.subject;
        elements.emailBody.value = email.body;
        elements.emailModal.classList.remove('hidden');
    } catch (error) {
        console.error('Generate email error:', error);
        showToast('生成邮件失败');
    }
}

function regenerateEmail() {
    generateEmail();
}

function copyEmailBody() {
    const body = elements.emailBody.value;
    navigator.clipboard.writeText(body).then(() => {
        showToast('邮件正文已复制');
    }).catch(() => {
        elements.emailBody.select();
        document.execCommand('copy');
        showToast('邮件正文已复制');
    });
}

function copyFullEmail() {
    const subject = elements.emailSubject.value;
    const body = elements.emailBody.value;
    const fullText = `主题: ${subject}\n\n${body}`;
    
    navigator.clipboard.writeText(fullText).then(() => {
        showToast('完整邮件已复制');
    }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = fullText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('完整邮件已复制');
    });
}

function closeEmailModal() {
    elements.emailModal.classList.add('hidden');
}

window.closeEmailModal = closeEmailModal;
window.regenerateEmail = regenerateEmail;
window.copyEmailBody = copyEmailBody;
window.copyFullEmail = copyFullEmail;

loadMeetings();
