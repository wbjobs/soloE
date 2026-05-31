export class InputController {
  constructor() {
    this.keys = {}
    this.setupEventListeners()
  }

  setupEventListeners() {
    window.addEventListener('keydown', (event) => {
      this.keys[event.code] = true
    })

    window.addEventListener('keyup', (event) => {
      this.keys[event.code] = false
    })
  }

  isKeyPressed(keyCode) {
    return this.keys[keyCode] || false
  }

  isLeftFlipperPressed() {
    return this.isKeyPressed('ArrowLeft') || this.isKeyPressed('KeyA')
  }

  isRightFlipperPressed() {
    return this.isKeyPressed('ArrowRight') || this.isKeyPressed('KeyD')
  }

  isLaunchPressed() {
    return this.isKeyPressed('Space')
  }

  isResetPressed() {
    return this.isKeyPressed('KeyR')
  }
}
