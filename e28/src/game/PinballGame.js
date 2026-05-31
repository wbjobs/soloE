import { SceneManager } from '../renderer/SceneManager.js'
import { PhysicsWorld } from '../physics/PhysicsWorld.js'
import { PinballTable } from './PinballTable.js'
import { Ball } from './Ball.js'
import { InputController } from './InputController.js'

export class PinballGame {
  constructor(container) {
    this.container = container
    this.sceneManager = null
    this.physicsWorld = null
    this.table = null
    this.ball = null
    this.input = null
    this.score = 0
    this.scoreElement = null
    this.scoreboardMesh = null
    this.lastTime = 0
    this.launchCooldown = false
    this.resetCooldown = false
    this.init()
  }

  init() {
    this.sceneManager = new SceneManager(this.container)
    this.physicsWorld = new PhysicsWorld()
    this.table = new PinballTable(this.sceneManager, this.physicsWorld)
    this.ball = new Ball(this.sceneManager, this.physicsWorld)
    this.input = new InputController()
    this.setupScoreDisplay()
    this.setupScoreboard()
    this.setupCollisionDetection()
    this.animate()
  }

  setupScoreDisplay() {
    this.scoreElement = document.getElementById('score')
  }

  setupScoreboard() {
    this.scoreboardMesh = this.sceneManager.createScoreboard(0)
    this.scoreboardMesh.position.set(0, 5, -6)
    this.scoreboardMesh.rotation.x = -0.4
    this.sceneManager.addMesh('scoreboard', this.scoreboardMesh)
  }

  updateScoreboard() {
    if (this.scoreboardMesh && this.scoreboardMesh.material && this.scoreboardMesh.material.uniforms) {
      this.scoreboardMesh.material.uniforms.score.value = this.score
    }
  }

  setupCollisionDetection() {
    const ballBody = this.ball.body
    ballBody.addEventListener('collide', (event) => {
      const bodyB = event.body
      const name = this.getBodyName(bodyB)

      if (name && name.startsWith('bumper')) {
        this.addScore(50)
        this.hitBumperEffect(name)
      }

      if (name && name.startsWith('scoreZone')) {
        this.addScore(100)
        this.hitZoneEffect(name)
      }
    })
  }

  getBodyName(body) {
    for (const [name, b] of this.physicsWorld.bodies.entries()) {
      if (b === body) return name
    }
    return null
  }

  hitBumperEffect(name) {
    const bumper = this.sceneManager.getMesh(name)
    if (bumper) {
      bumper.material.emissiveIntensity = 1.5
      setTimeout(() => {
        bumper.material.emissiveIntensity = 0.8
      }, 100)
    }
  }

  hitZoneEffect(name) {
    const zone = this.sceneManager.getMesh(name)
    if (zone) {
      zone.material.emissiveIntensity = 1.5
      setTimeout(() => {
        zone.material.emissiveIntensity = 0.6
      }, 100)
    }
  }

  addScore(points) {
    this.score += points
    if (this.scoreElement) {
      this.scoreElement.textContent = this.score
    }
    this.updateScoreboard()
  }

  resetGame() {
    this.ball.reset()
    this.score = 0
    if (this.scoreElement) {
      this.scoreElement.textContent = this.score
    }
    this.updateScoreboard()
  }

  update(deltaTime) {
    this.physicsWorld.step(deltaTime)

    this.ball.update()

    const leftFlipperMesh = this.sceneManager.getMesh('leftFlipper')
    const leftFlipperBody = this.physicsWorld.getBody('leftFlipper')
    if (leftFlipperMesh && leftFlipperBody) {
      leftFlipperMesh.position.copy(leftFlipperBody.position)
      leftFlipperMesh.quaternion.copy(leftFlipperBody.quaternion)
    }

    const rightFlipperMesh = this.sceneManager.getMesh('rightFlipper')
    const rightFlipperBody = this.physicsWorld.getBody('rightFlipper')
    if (rightFlipperMesh && rightFlipperBody) {
      rightFlipperMesh.position.copy(rightFlipperBody.position)
      rightFlipperMesh.quaternion.copy(rightFlipperBody.quaternion)
    }

    const plungerMesh = this.sceneManager.getMesh('plunger')
    const plungerBody = this.physicsWorld.getBody('plunger')
    if (plungerMesh && plungerBody) {
      plungerMesh.position.copy(plungerBody.position)
      plungerMesh.quaternion.copy(plungerBody.quaternion)
    }

    this.table.setLeftFlipper(this.input.isLeftFlipperPressed())
    this.table.setRightFlipper(this.input.isRightFlipperPressed())

    if (this.input.isLaunchPressed() && !this.launchCooldown) {
      this.table.launchPlunger()
      this.launchCooldown = true
      setTimeout(() => {
        this.launchCooldown = false
      }, 500)
    }

    if (this.input.isResetPressed() && !this.resetCooldown) {
      this.resetGame()
      this.resetCooldown = true
      setTimeout(() => {
        this.resetCooldown = false
      }, 500)
    }

    if (this.ball.isOutOfBounds()) {
      this.ball.reset()
    }
  }

  animate(currentTime = 0) {
    requestAnimationFrame((time) => this.animate(time))

    const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.1)
    this.lastTime = currentTime

    this.update(deltaTime)
    this.sceneManager.render()
  }
}
