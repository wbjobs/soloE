<template>
  <div class="app">
    <div v-if="!inRoom" class="lobby">
      <h1>WebRTC多人视频会议</h1>
      <div class="form-group">
        <label>房间号</label>
        <input v-model="roomId" type="text" placeholder="输入房间号" />
      </div>
      <div class="form-group">
        <label>昵称</label>
        <input v-model="peerName" type="text" placeholder="输入您的昵称" />
      </div>
      <button @click="joinRoom" :disabled="!roomId || !peerName || joining">
        {{ joining ? '加入中...' : '加入会议' }}
      </button>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div v-else class="conference">
      <div class="header">
        <h2>房间: {{ roomId }}</h2>
        <div class="quality-info" v-if="qualityInfo">
          <span>码率: {{ (qualityInfo.bitrate / 1000000).toFixed(2) }} Mbps</span>
          <span>分辨率: {{ qualityInfo.resolution }}</span>
          <span>FPS: {{ qualityInfo.fps }}</span>
        </div>
        <div v-if="networkSwitchNotified" class="network-notification">
          ⚠️ 检测到网络切换，正在调整视频质量...
        </div>
      </div>

      <div v-if="viewMode === 'grid'" class="videos-container">
        <div class="video-wrapper local">
          <video ref="localVideo" autoplay muted playsinline class="video-element"></video>
          <div class="video-label">{{ peerName }} (我)</div>
          <div v-if="activeSpeaker === 'local'" class="speaking-indicator">🔊 演讲中</div>
        </div>

        <div v-for="(streams, peerId) in remoteVideos" :key="peerId" class="video-wrapper">
          <video v-if="streams.video" :ref="'remoteVideo_' + peerId" autoplay playsinline class="video-element"></video>
          <div v-if="!streams.video" class="audio-only">
            <div class="avatar">{{ getPeerName(peerId).charAt(0).toUpperCase() }}</div>
          </div>
          <div class="video-label">{{ getPeerName(peerId) }}</div>
          <div v-if="activeSpeaker === peerId" class="speaking-indicator">🔊 演讲中</div>
          <audio v-if="streams.audio" :ref="'remoteAudio_' + peerId" autoplay playsinline></audio>
        </div>
      </div>

      <div v-else class="speaker-view-container">
        <div class="main-video-area">
          <div class="video-wrapper main-speaker">
            <template v-if="activeSpeaker === 'local' || (!activeSpeaker && Object.keys(remoteVideos).length === 0)">
              <video ref="localVideo" autoplay muted playsinline class="video-element"></video>
              <div class="video-label main-label">{{ peerName }} (我)</div>
              <div v-if="activeSpeaker === 'local'" class="speaking-indicator main-speaking">🔊 演讲中</div>
            </template>
            
            <template v-else-if="activeSpeaker">
              <video v-if="remoteVideos[activeSpeaker]?.video" 
                     :ref="'mainRemoteVideo'" 
                     autoplay playsinline class="video-element"></video>
              <div v-if="!remoteVideos[activeSpeaker]?.video" class="audio-only main-audio-only">
                <div class="avatar main-avatar">{{ getPeerNameHelper(activeSpeaker).charAt(0).toUpperCase() }}</div>
              </div>
              <div class="video-label main-label">{{ getPeerNameHelper(activeSpeaker) }}</div>
              <div class="speaking-indicator main-speaking">🔊 演讲中</div>
              <audio v-if="remoteVideos[activeSpeaker]?.audio" 
                     :ref="'mainRemoteAudio'" autoplay playsinline></audio>
            </template>

            <template v-else>
              <video ref="localVideo" autoplay muted playsinline class="video-element"></video>
              <div class="video-label main-label">{{ peerName }} (我)</div>
            </template>
          </div>
        </div>

        <div class="thumbnails-area">
          <div class="thumbnail-wrapper" 
               :class="{ local: true, active: activeSpeaker === 'local' }"
               @click="activeSpeaker = 'local'">
            <video ref="localVideoThumb" autoplay muted playsinline class="thumbnail-video"></video>
            <div class="thumbnail-label">{{ peerName }}</div>
            <div v-if="activeSpeaker === 'local'" class="thumbnail-speaking">🎤</div>
          </div>

          <div v-for="(streams, peerId) in remoteVideos" 
               :key="peerId" 
               class="thumbnail-wrapper"
               :class="{ active: activeSpeaker === peerId }"
               @click="activeSpeaker = peerId">
            <video v-if="streams.video" 
                   :ref="'thumbVideo_' + peerId" autoplay playsinline class="thumbnail-video"></video>
            <div v-if="!streams.video" class="thumbnail-audio-only">
              <div class="avatar thumbnail-avatar">{{ getPeerName(peerId).charAt(0).toUpperCase() }}</div>
            </div>
            <div class="thumbnail-label">{{ getPeerName(peerId) }}</div>
            <div v-if="activeSpeaker === peerId" class="thumbnail-speaking">🎤</div>
          </div>
        </div>
      </div>

      <div class="controls">
        <button @click="toggleVideo" :class="{ active: videoEnabled }" title="摄像头">
          {{ videoEnabled ? '📹' : '📷' }}
        </button>
        <button @click="toggleAudio" :class="{ active: audioEnabled }" title="麦克风">
          {{ audioEnabled ? '🎤' : '🔇' }}
        </button>
        <button @click="toggleSpeakerDetection" :class="{ active: speakerViewEnabled }" title="演讲者视图">
          {{ speakerViewEnabled ? '👤' : '🚫👤' }}
        </button>
        <button @click="toggleViewMode" :class="{ active: viewMode === 'speaker' }" title="切换视图">
          {{ viewMode === 'speaker' ? '📺' : '🔲' }}
        </button>
        <button @click="leaveRoom" class="leave">
          🚪 离开
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import webrtcService from './services/webrtcService';

const roomId = ref('');
const peerName = ref('');
const inRoom = ref(false);
const joining = ref(false);
const error = ref('');
const videoEnabled = ref(true);
const audioEnabled = ref(true);
const qualityInfo = ref(null);

const localVideo = ref(null);
const remoteVideos = ref({});
const peersMap = ref({});
const networkSwitchNotified = ref(false);

const viewMode = ref('grid');
const activeSpeaker = ref(null);
const activeSpeakerName = ref(null);
const speakerViewEnabled = ref(true);

async function joinRoom() {
  joining.value = true;
  error.value = '';

  try {
    await webrtcService.init();
    await webrtcService.joinRoom(roomId.value, peerName.value);
    
    const stream = await webrtcService.getLocalStream(videoEnabled.value, audioEnabled.value);
    webrtcService.localStream = stream;
    
    await nextTick();
    if (localVideo.value) {
      localVideo.value.srcObject = stream;
    }
    
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      await webrtcService.produce(videoTrack);
    }
    
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      await webrtcService.produce(audioTrack);
    }
    
    setupEventListeners();
  inRoom.value = true;
  
  if (speakerViewEnabled.value) {
    webrtcService.enableSpeakerDetection(true);
    await nextTick();
    await webrtcService.setupAudioAnalysis('local', webrtcService.localStream);
  }
} catch (err) {
  error.value = err.message;
  console.error('Join room error:', err);
} finally {
  joining.value = false;
}
}

function setupEventListeners() {
  webrtcService.on('new-stream', async ({ peerId, kind, stream }) => {
    if (!remoteVideos.value[peerId]) {
      remoteVideos.value[peerId] = {};
    }
    remoteVideos.value[peerId][kind] = stream;
    
    if (speakerViewEnabled.value && kind === 'audio') {
      await webrtcService.setupAudioAnalysis(peerId, stream);
    }
    
    await nextTick();
    if (kind === 'video') {
      const videoEl = document.querySelector(`[ref="remoteVideo_${peerId}"]`);
      if (videoEl) {
        videoEl.srcObject = stream;
      }
    } else if (kind === 'audio') {
      const audioEl = document.querySelector(`[ref="remoteAudio_${peerId}"]`);
      if (audioEl) {
        audioEl.srcObject = stream;
      }
    }
  });

  webrtcService.on('peer-left', (peerId) => {
    delete remoteVideos.value[peerId];
    delete peersMap.value[peerId];
  });

  webrtcService.on('peer-joined', (peer) => {
    peersMap.value[peer.id] = peer;
  });

  webrtcService.on('quality-changed', (info) => {
    qualityInfo.value = info;
  });

  webrtcService.on('network-switch', () => {
    networkSwitchNotified.value = true;
    setTimeout(() => {
      networkSwitchNotified.value = false;
    }, 5000);
  });

  webrtcService.on('speaker-changed', ({ peerId, peerName }) => {
    if (speakerViewEnabled.value) {
      activeSpeaker.value = peerId;
      activeSpeakerName.value = peerName;
      viewMode.value = peerId ? 'speaker' : 'grid';
    }
  });

  webrtcService.socket.on('speaker-broadcast', ({ peerId, peerName, isActive }) => {
    if (speakerViewEnabled.value) {
      activeSpeaker.value = isActive ? peerId : null;
      activeSpeakerName.value = isActive ? peerName : null;
      viewMode.value = isActive ? 'speaker' : 'grid';
    }
  });
}

watch([activeSpeaker, viewMode], async () => {
  await nextTick();
  
  if (viewMode.value === 'speaker') {
    if (localVideoThumb.value && webrtcService.localStream) {
      localVideoThumb.value.srcObject = webrtcService.localStream;
    }
    
    Object.keys(remoteVideos.value).forEach(peerId => {
      const streams = remoteVideos.value[peerId];
      if (streams.video) {
        const thumbVideoEl = document.querySelector(`[ref="thumbVideo_${peerId}"]`);
        if (thumbVideoEl) {
          thumbVideoEl.srcObject = streams.video;
        }
      }
    });
    
    if (activeSpeaker.value && activeSpeaker.value !== 'local') {
      const streams = remoteVideos.value[activeSpeaker.value];
      if (streams?.video) {
        const mainVideoEl = document.querySelector('[ref="mainRemoteVideo"]');
        if (mainVideoEl) {
          mainVideoEl.srcObject = streams.video;
        }
      }
      if (streams?.audio) {
        const mainAudioEl = document.querySelector('[ref="mainRemoteAudio"]');
        if (mainAudioEl) {
          mainAudioEl.srcObject = streams.audio;
        }
      }
    }
  }
}, { immediate: true });

async function toggleVideo() {
  videoEnabled.value = !videoEnabled.value;
  
  if (videoEnabled.value) {
    const stream = await webrtcService.getLocalStream(true, audioEnabled.value);
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      await webrtcService.produce(videoTrack);
      if (webrtcService.localStream) {
        webrtcService.localStream.addTrack(videoTrack);
      }
    }
  } else {
    const videoProducer = Array.from(webrtcService.producers.values()).find(p => p.kind === 'video');
    if (videoProducer) {
      videoProducer.track.stop();
      webrtcService.stopProducer(videoProducer.id);
    }
  }
  
  if (localVideo.value && webrtcService.localStream) {
    localVideo.value.srcObject = webrtcService.localStream;
  }
}

async function toggleAudio() {
  audioEnabled.value = !audioEnabled.value;
  
  if (audioEnabled.value) {
    const stream = await webrtcService.getLocalStream(videoEnabled.value, true);
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      await webrtcService.produce(audioTrack);
      if (webrtcService.localStream) {
        webrtcService.localStream.addTrack(audioTrack);
      }
    }
  } else {
    const audioProducer = Array.from(webrtcService.producers.values()).find(p => p.kind === 'audio');
    if (audioProducer) {
      audioProducer.track.stop();
      webrtcService.stopProducer(audioProducer.id);
    }
  }
}

function leaveRoom() {
  webrtcService.leaveRoom();
  inRoom.value = false;
  remoteVideos.value = {};
  peersMap.value = {};
  qualityInfo.value = null;
  activeSpeaker.value = null;
  activeSpeakerName.value = null;
  viewMode.value = 'grid';
}

function toggleViewMode() {
  viewMode.value = viewMode.value === 'grid' ? 'speaker' : 'grid';
  if (viewMode.value === 'grid') {
    activeSpeaker.value = null;
  }
}

function toggleSpeakerDetection() {
  speakerViewEnabled.value = !speakerViewEnabled.value;
  webrtcService.enableSpeakerDetection(speakerViewEnabled.value);
  
  if (!speakerViewEnabled.value) {
    activeSpeaker.value = null;
    activeSpeakerName.value = null;
    viewMode.value = 'grid';
  }
}

function getPeerNameHelper(peerId) {
  if (peerId === 'local') return peerName.value;
  const peer = webrtcService.peers.get(peerId);
  return peer?.name || 'Unknown';
}

function getPeerName(peerId) {
  const peer = webrtcService.peers.get(peerId);
  return peer?.name || '未知用户';
}

onUnmounted(() => {
  if (inRoom.value) {
    webrtcService.leaveRoom();
  }
});
</script>

<style scoped>
.app {
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: white;
}

.lobby {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 20px;
}

.lobby h1 {
  font-size: 2.5rem;
  margin-bottom: 2rem;
  text-align: center;
}

.form-group {
  width: 100%;
  max-width: 400px;
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 1.1rem;
}

.form-group input {
  width: 100%;
  padding: 12px 16px;
  font-size: 1rem;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: white;
  outline: none;
  transition: background 0.3s;
}

.form-group input:focus {
  background: rgba(255, 255, 255, 0.15);
}

.form-group input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.lobby button {
  padding: 14px 40px;
  font-size: 1.1rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.lobby button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
}

.lobby button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  margin-top: 1rem;
  color: #ff6b6b;
}

.conference {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
      position: relative;
      padding: 1rem 2rem;
      background: rgba(0, 0, 0, 0.3);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

.header h2 {
  font-size: 1.3rem;
}

.quality-info {
      display: flex;
      gap: 1.5rem;
      font-size: 0.9rem;
      color: #a0aec0;
    }

    .network-notification {
      position: absolute;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 0.9rem;
      z-index: 100;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.7;
      }
    }

.videos-container {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1rem;
  padding: 1rem;
  max-height: calc(100vh - 140px);
  overflow-y: auto;
}

.speaker-view-container {
  flex: 1;
  display: flex;
  gap: 1rem;
  padding: 1rem;
  max-height: calc(100vh - 140px);
}

.main-video-area {
  flex: 1;
  min-width: 0;
}

.thumbnails-area {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 180px;
  overflow-y: auto;
}

.video-wrapper {
  position: relative;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 12px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  min-height: 200px;
}

.video-wrapper.main-speaker {
  height: 100%;
  min-height: 100%;
  aspect-ratio: unset;
}

.video-element {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0.75rem;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
  font-size: 0.9rem;
}

.video-label.main-label {
  font-size: 1.2rem;
  padding: 1rem;
}

.speaking-indicator {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  background: rgba(52, 211, 153, 0.9);
  color: white;
  padding: 0.3rem 0.6rem;
  border-radius: 20px;
  font-size: 0.8rem;
  animation: pulse-green 1.5s infinite;
}

.speaking-indicator.main-speaking {
  font-size: 1rem;
  padding: 0.5rem 1rem;
}

@keyframes pulse-green {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.05); }
}

.audio-only {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.audio-only.main-audio-only {
  height: 100%;
}

.avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: bold;
}

.avatar.main-avatar {
  width: 150px;
  height: 150px;
  font-size: 4rem;
}

.thumbnail-wrapper {
  position: relative;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  border: 2px solid transparent;
}

.thumbnail-wrapper:hover {
  transform: scale(1.02);
}

.thumbnail-wrapper.active {
  border-color: #34d399;
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.5);
}

.thumbnail-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumbnail-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0.3rem 0.5rem;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
  font-size: 0.75rem;
}

.thumbnail-speaking {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  background: rgba(52, 211, 153, 0.9);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
}

.thumbnail-audio-only {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.thumbnail-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: bold;
}

.controls {
  padding: 1rem;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  justify-content: center;
  gap: 1rem;
}

.controls button {
  padding: 12px 24px;
  font-size: 1.5rem;
  border: none;
  border-radius: 50%;
  width: 60px;
  height: 60px;
  cursor: pointer;
  transition: transform 0.2s, background 0.2s;
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.controls button:hover {
  transform: scale(1.1);
}

.controls button.active {
  background: rgba(102, 126, 234, 0.5);
}

.controls button.leave {
  background: #e53e3e;
  border-radius: 30px;
  width: auto;
  font-size: 1rem;
}
</style>