<script setup>
import { ref } from 'vue'
import RoomManager from './components/RoomManager.vue'
import Whiteboard from './components/Whiteboard.vue'
import { io } from 'socket.io-client'

const socket = ref(null)
const roomId = ref('')
const isInRoom = ref(false)

const initSocket = () => {
  socket.value = io('http://localhost:3000')
  
  socket.value.on('connect', () => {
    console.log('Connected to server')
  })

  socket.value.on('user-joined', (userId) => {
    console.log('User joined:', userId)
  })

  socket.value.on('user-left', (userId) => {
    console.log('User left:', userId)
  })
}

const handleCreateRoom = async () => {
  if (!socket.value) initSocket()
  
  return new Promise((resolve) => {
    socket.value.emit('create-room', (response) => {
      roomId.value = response.roomId
      isInRoom.value = true
      resolve(response.roomId)
    })
  })
}

const handleJoinRoom = async (code) => {
  if (!socket.value) initSocket()
  
  return new Promise((resolve, reject) => {
    socket.value.emit('join-room', { roomId: code }, (response) => {
      if (response.success) {
        roomId.value = code
        isInRoom.value = true
        resolve()
      } else {
        reject(new Error(response.message))
      }
    })
  })
}

const handleLeaveRoom = () => {
  if (socket.value) {
    socket.value.disconnect()
    socket.value = null
  }
  isInRoom.value = false
  roomId.value = ''
}
</script>

<template>
  <div class="app-container">
    <RoomManager 
      v-if="!isInRoom" 
      @create-room="handleCreateRoom"
      @join-room="handleJoinRoom"
    />
    <Whiteboard 
      v-else 
      :socket="socket" 
      :room-id="roomId"
      @leave="handleLeaveRoom"
    />
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
}
</style>
