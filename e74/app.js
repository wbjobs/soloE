const { ipcRenderer } = require('electron');

let socket;
let peerConnection;
let dataChannel;
let laserChannel;
let roomId = '';
let isHost = false;
let isSharing = false;
let localStream;

const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');
let isDrawing = false;
let currentTool = 'pen';
let currentColor = '#1a1a1a';
let currentSize = 3;
let lastPoint = null;
let velocityHistory = [];

let laserDots = [];
const LASER_DURATION = 3000;

const roomIdInput = document.getElementById('roomIdInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const startSharingBtn = document.getElementById('startSharingBtn');
const endCallBtn = document.getElementById('endCallBtn');
const sourceSelect = document.getElementById('sourceSelect');
const colorPicker = document.getElementById('colorPicker');
const brushSize = document.getElementById('brushSize');
const brushSizeValue = document.getElementById('brushSizeValue');
const remoteVideo = document.getElementById('remoteVideo');
const localVideo = document.getElementById('localVideo');
const videoContainer = document.getElementById('videoContainer');
const whiteboardContainer = document.getElementById('whiteboardContainer');
const connectionStatus = document.getElementById('connectionStatus');
const statusDot = connectionStatus.querySelector('.status-dot');
const notification = document.getElementById('notification');

const toolButtons = document.querySelectorAll('.tool-btn');
const colorPresets = document.querySelectorAll('.color-preset');
const tabButtons = document.querySelectorAll('.tab-btn');

function showNotification(message, type = 'info') {
  notification.textContent = message;
  notification.className = `notification show ${type}`;
  setTimeout(() => {
    notification.classList.remove('show');
  }, 3000);
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function checkMediaDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showNotification('浏览器不支持媒体设备访问', 'error');
    return false;
  }
  return true;
}

function connectToSignaling() {
  if (!checkMediaDevices()) {
    return;
  }

  socket = io('http://localhost:3000');
  
  socket.on('connect', () => {
    statusDot.className = 'status-dot online';
    connectionStatus.querySelector('span:last-child').textContent = '已连接';
    showNotification('已连接到信令服务器', 'success');
  });

  socket.on('disconnect', () => {
    statusDot.className = 'status-dot offline';
    connectionStatus.querySelector('span:last-child').textContent = '未连接';
    resetState();
  });

  socket.on('room-created', (id) => {
    roomId = id;
    roomIdInput.value = id;
    isHost = true;
    showNotification(`房间创建成功: ${id}`, 'success');
    createRoomBtn.disabled = true;
    joinRoomBtn.disabled = true;
  });

  socket.on('room-joined', (id) => {
    roomId = id;
    isHost = false;
    showNotification(`已加入房间: ${id}`, 'success');
    createRoomBtn.disabled = true;
    joinRoomBtn.disabled = true;
    startSharingBtn.disabled = false;
  });

  socket.on('room-full', () => {
    showNotification('房间已满', 'error');
  });

  socket.on('guest-joined', (guestId) => {
    showNotification('对方已加入', 'success');
    startSharingBtn.disabled = false;
    setTimeout(() => {
      createOffer();
    }, 500);
  });

  socket.on('peer-disconnected', () => {
    showNotification('对方已断开连接', 'error');
    resetState();
  });

  socket.on('offer', async (data) => {
    showNotification('收到连接请求', 'info');
    await createAnswer(data.offer);
  });

  socket.on('answer', async (data) => {
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      showNotification('连接已建立', 'success');
    } catch (error) {
      showNotification('设置远程描述失败: ' + error.message, 'error');
    }
  });

  socket.on('ice-candidate', (data) => {
    if (data.candidate && peerConnection) {
      try {
        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (error) {
        console.error('添加 ICE candidate 失败:', error);
      }
    }
  });
}

function initPeerConnection() {
  const config = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ]
  };

  peerConnection = new RTCPeerConnection(config);

  peerConnection.ontrack = (event) => {
    showNotification('收到远程视频流', 'info');
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.play().catch(e => console.error('视频播放失败:', e));
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        roomId,
        candidate: event.candidate.toJSON()
      });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE 连接状态:', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'connected') {
      showNotification('ICE 连接已建立', 'success');
    } else if (peerConnection.iceConnectionState === 'failed') {
      showNotification('ICE 连接失败', 'error');
      peerConnection.restartIce();
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('连接状态:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      showNotification('WebRTC 连接已建立', 'success');
      endCallBtn.disabled = false;
    } else if (peerConnection.connectionState === 'disconnected' || 
               peerConnection.connectionState === 'closed') {
      showNotification('连接已断开', 'error');
      resetState();
    } else if (peerConnection.connectionState === 'failed') {
      showNotification('连接失败', 'error');
    }
  };

  peerConnection.onsignalingstatechange = () => {
    console.log('信令状态:', peerConnection.signalingState);
  };

  dataChannel = peerConnection.createDataChannel('whiteboard', {
    ordered: true,
    reliable: true
  });
  
  dataChannel.onopen = () => {
    showNotification('数据通道已建立', 'success');
  };

  dataChannel.onclose = () => {
    showNotification('数据通道已关闭', 'info');
  };

  dataChannel.onerror = (error) => {
    console.error('数据通道错误:', error);
  };

  dataChannel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'clear') {
        drawRemoteClear();
      } else {
        drawRemoteStroke(data);
      }
    } catch (error) {
      console.error('解析数据失败:', error);
    }
  };

  laserChannel = peerConnection.createDataChannel('laser', {
    ordered: false,
    maxRetransmits: 0
  });
  
  laserChannel.onopen = () => {
    console.log('激光笔通道已建立');
  };

  laserChannel.onclose = () => {
    console.log('激光笔通道已关闭');
  };

  laserChannel.onerror = (error) => {
    console.error('激光笔通道错误:', error);
  };

  laserChannel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      drawRemoteLaser(data);
    } catch (error) {
      console.error('解析激光笔数据失败:', error);
    }
  };

  peerConnection.ondatachannel = (event) => {
    if (event.channel.label === 'whiteboard') {
      dataChannel = event.channel;
      dataChannel.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'clear') {
            drawRemoteClear();
          } else {
            drawRemoteStroke(data);
          }
        } catch (error) {
          console.error('解析数据失败:', error);
        }
      };
    } else if (event.channel.label === 'laser') {
      laserChannel = event.channel;
      laserChannel.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          drawRemoteLaser(data);
        } catch (error) {
          console.error('解析激光笔数据失败:', error);
        }
      };
    }
  };
}

async function createOffer() {
  try {
    initPeerConnection();
    
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: true
    });
    
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('offer', {
      roomId,
      offer: offer.toJSON()
    });
    
    showNotification('已发送连接请求', 'info');
  } catch (error) {
    showNotification('创建 Offer 失败: ' + error.message, 'error');
    console.error('创建 Offer 失败:', error);
  }
}

async function createAnswer(offer) {
  try {
    initPeerConnection();
    
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await peerConnection.createAnswer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: true
    });
    
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('answer', {
      roomId,
      answer: answer.toJSON()
    });
    
    showNotification('已回复连接请求', 'info');
  } catch (error) {
    showNotification('创建 Answer 失败: ' + error.message, 'error');
    console.error('创建 Answer 失败:', error);
  }
}

async function getScreenSources() {
  try {
    const sources = await ipcRenderer.invoke('get-sources');
    sourceSelect.innerHTML = '<option value="">选择共享源</option>';
    
    sources.forEach(source => {
      const option = document.createElement('option');
      option.value = source.id;
      option.textContent = source.name;
      sourceSelect.appendChild(option);
    });
    
    sourceSelect.disabled = false;
  } catch (error) {
    showNotification('获取屏幕源失败: ' + error.message, 'error');
  }
}

async function startScreenSharing() {
  const sourceId = sourceSelect.value;
  
  if (!sourceId) {
    showNotification('请先选择共享源', 'error');
    return;
  }

  try {
    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 4096,
          minHeight: 720,
          maxHeight: 2160,
          maxFrameRate: 30
        },
        optional: []
      }
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);

    localVideo.srcObject = localStream;
    localVideo.play().catch(e => console.error('本地视频播放失败:', e));
    
    isSharing = true;
    startSharingBtn.textContent = '停止共享';
    showNotification('屏幕共享已开始', 'success');

    if (peerConnection) {
      localStream.getTracks().forEach(track => {
        const sender = peerConnection.addTrack(track, localStream);
        console.log('添加轨道:', sender);
      });
    }
  } catch (error) {
    showNotification('无法开始屏幕共享: ' + error.message, 'error');
    console.error('屏幕共享错误:', error);
  }
}

function stopScreenSharing() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
    localVideo.srcObject = null;
    isSharing = false;
    startSharingBtn.textContent = '开始共享屏幕';
    showNotification('屏幕共享已停止', 'info');
  }
}

function resetState() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  
  if (laserChannel) {
    laserChannel.close();
    laserChannel = null;
  }
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  
  roomId = '';
  isHost = false;
  isSharing = false;
  
  createRoomBtn.disabled = false;
  joinRoomBtn.disabled = false;
  startSharingBtn.disabled = true;
  endCallBtn.disabled = true;
  sourceSelect.disabled = true;
  
  startSharingBtn.textContent = '开始共享屏幕';
  
  laserDots = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function endCall() {
  resetState();
  showNotification('通话已结束', 'info');
}

function initCanvas() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function calculateVelocity(current, previous) {
  if (!previous) return 0;
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getPressure(velocity) {
  const minPressure = 0.3;
  const maxPressure = 1.0;
  const minVelocity = 0;
  const maxVelocity = 50;
  
  const normalizedVelocity = Math.min(velocity / maxVelocity, 1);
  return maxPressure - (normalizedVelocity * (maxPressure - minPressure));
}

function getBrushSize(baseSize, pressure) {
  return baseSize * (0.5 + pressure * 0.5);
}

function getPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function startDrawing(e) {
  isDrawing = true;
  lastPoint = getPoint(e);
  velocityHistory = [];
}

function draw(e) {
  if (!isDrawing) return;
  
  const currentPoint = getPoint(e);
  
  if (currentTool === 'laser') {
    drawLaserStroke(lastPoint, currentPoint);
  } else {
    const velocity = calculateVelocity(currentPoint, lastPoint);
    
    velocityHistory.push(velocity);
    if (velocityHistory.length > 5) {
      velocityHistory.shift();
    }
    
    const avgVelocity = velocityHistory.reduce((a, b) => a + b, 0) / velocityHistory.length;
    const pressure = getPressure(avgVelocity);
    
    if (currentTool === 'pen') {
      drawStroke(lastPoint, currentPoint, currentColor, getBrushSize(currentSize, pressure), pressure);
    } else if (currentTool === 'eraser') {
      eraseStroke(lastPoint, currentPoint, currentSize * 2);
    }
  }
  
  lastPoint = currentPoint;
}

function drawStroke(from, to, color, size, pressure) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.globalAlpha = 0.3 + pressure * 0.7;
  
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  
  ctx.globalAlpha = 1;
  
  sendStrokeData(from, to, color, size, pressure);
}

function eraseStroke(from, to, size) {
  ctx.beginPath();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  
  sendStrokeData(from, to, '#ffffff', size, 1);
}

function drawRemoteStroke(data) {
  ctx.beginPath();
  ctx.strokeStyle = data.color;
  ctx.lineWidth = data.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.globalAlpha = 0.3 + data.pressure * 0.7;
  
  ctx.moveTo(data.from.x, data.from.y);
  ctx.lineTo(data.to.x, data.to.y);
  ctx.stroke();
  
  ctx.globalAlpha = 1;
}

function sendStrokeData(from, to, color, size, pressure) {
  if (dataChannel && dataChannel.readyState === 'open') {
    const data = {
      from,
      to,
      color,
      size,
      pressure
    };
    dataChannel.send(JSON.stringify(data));
  }
}

function stopDrawing() {
  isDrawing = false;
  lastPoint = null;
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify({ type: 'clear' }));
  }
}

function drawRemoteClear() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawLaserStroke(from, to) {
  ctx.beginPath();
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 5]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  
  ctx.setLineDash([]);
  
  sendLaserData(from, to);
}

function sendLaserData(from, to) {
  if (laserChannel && laserChannel.readyState === 'open') {
    const data = {
      from,
      to,
      timestamp: Date.now()
    };
    laserChannel.send(JSON.stringify(data));
  }
}

function drawRemoteLaser(data) {
  const now = Date.now();
  const dot = {
    from: data.from,
    to: data.to,
    startTime: now,
    expiresAt: now + LASER_DURATION
  };
  
  laserDots.push(dot);
  
  drawLaserDot(dot);
  
  setTimeout(() => {
    removeLaserDot(dot);
  }, LASER_DURATION);
}

function drawLaserDot(dot) {
  ctx.beginPath();
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 5]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.moveTo(dot.from.x, dot.from.y);
  ctx.lineTo(dot.to.x, dot.to.y);
  ctx.stroke();
  
  ctx.setLineDash([]);
}

function removeLaserDot(dot) {
  const index = laserDots.indexOf(dot);
  if (index > -1) {
    laserDots.splice(index, 1);
  }
  redrawWhiteboard();
}

function redrawWhiteboard() {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.putImageData(imageData, 0, 0);
  
  laserDots.forEach(dot => {
    drawLaserDot(dot);
  });
}

function updateLaserDots() {
  const now = Date.now();
  const expired = laserDots.filter(dot => dot.expiresAt <= now);
  expired.forEach(dot => {
    removeLaserDot(dot);
  });
}

setInterval(updateLaserDots, 100);

toolButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    toolButtons.forEach(b => {
      b.classList.remove('active');
      b.classList.remove('laser-active');
    });
    
    if (btn.dataset.tool === 'laser') {
      btn.classList.add('laser-active');
      showNotification('激光笔模式已开启，3秒后自动消失', 'info');
    } else {
      btn.classList.add('active');
    }
    
    currentTool = btn.dataset.tool;
    
    if (currentTool === 'clear') {
      clearCanvas();
      toolButtons[0].classList.add('active');
      toolButtons[3].classList.remove('active');
      currentTool = 'pen';
    }
  });
});

colorPresets.forEach(btn => {
  btn.addEventListener('click', () => {
    colorPresets.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentColor = btn.dataset.color;
    colorPicker.value = btn.dataset.color;
  });
});

colorPicker.addEventListener('input', (e) => {
  currentColor = e.target.value;
  colorPresets.forEach(btn => btn.classList.remove('active'));
});

brushSize.addEventListener('input', (e) => {
  currentSize = parseInt(e.target.value);
  brushSizeValue.textContent = currentSize;
});

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    if (btn.dataset.tab === 'video') {
      videoContainer.style.display = 'flex';
      whiteboardContainer.classList.remove('active');
    } else {
      videoContainer.style.display = 'none';
      whiteboardContainer.classList.add('active');
    }
  });
});

createRoomBtn.addEventListener('click', () => {
  const id = generateRoomId();
  roomIdInput.value = id;
  socket.emit('create-room', id);
  getScreenSources();
});

joinRoomBtn.addEventListener('click', () => {
  const id = roomIdInput.value.trim();
  if (!id) {
    showNotification('请输入房间 ID', 'error');
    return;
  }
  socket.emit('join-room', id);
  getScreenSources();
});

startSharingBtn.addEventListener('click', () => {
  if (isSharing) {
    stopScreenSharing();
  } else {
    startScreenSharing();
  }
});

endCallBtn.addEventListener('click', endCall);

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseleave', stopDrawing);

document.addEventListener('DOMContentLoaded', () => {
  connectToSignaling();
  initCanvas();
  showNotification('欢迎使用 WebRTC 屏幕共享', 'info');
});