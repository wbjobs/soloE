<script setup>
import { ref } from 'vue'

const emit = defineEmits(['create-room', 'join-room'])

const joinCode = ref('')
const error = ref('')

const handleCreate = async () => {
  const roomId = await emit('create-room')
}

const handleJoin = async () => {
  if (!joinCode.value || joinCode.value.length !== 6) {
    error.value = '请输入6位房间码'
    return
  }
  try {
    await emit('join-room', joinCode.value)
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="room-manager">
    <div class="card">
      <h1>白板协作系统</h1>
      <p class="subtitle">实时多人在线协作</p>
      
      <div class="button-group">
        <button class="btn primary" @click="handleCreate">
          创建房间
        </button>
      </div>

      <div class="divider">或者</div>

      <div class="join-form">
        <input 
          v-model="joinCode"
          type="text" 
          placeholder="输入6位房间码"
          maxlength="6"
          class="room-input"
        />
        <button class="btn secondary" @click="handleJoin">
          加入房间
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.room-manager {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.card {
  background: white;
  padding: 48px;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  text-align: center;
  min-width: 400px;
}

h1 {
  font-size: 28px;
  color: #333;
  margin-bottom: 8px;
}

.subtitle {
  color: #666;
  margin-bottom: 32px;
}

.button-group {
  margin-bottom: 24px;
}

.btn {
  padding: 14px 32px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.btn.primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  width: 100%;
}

.btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
}

.btn.secondary {
  background: #f0f0f0;
  color: #333;
  width: 100%;
}

.btn.secondary:hover {
  background: #e0e0e0;
}

.divider {
  color: #999;
  margin: 24px 0;
}

.join-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.room-input {
  padding: 14px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 18px;
  text-align: center;
  letter-spacing: 4px;
  transition: border-color 0.3s;
}

.room-input:focus {
  outline: none;
  border-color: #667eea;
}

.error {
  color: #e53e3e;
  margin-top: 16px;
  font-size: 14px;
}
</style>
