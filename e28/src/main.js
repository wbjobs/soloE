import { PinballGame } from './game/PinballGame.js'

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('game-container')
  if (container) {
    const game = new PinballGame(container)
    console.log('3D弹珠台游戏已启动！')
    console.log('控制方式：')
    console.log('← → 或 A D 键：控制挡板')
    console.log('空格键：发射弹珠')
    console.log('R 键：重新开始')
  } else {
    console.error('找不到游戏容器！')
  }
})
