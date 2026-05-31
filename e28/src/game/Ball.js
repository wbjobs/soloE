export class Ball {
  constructor(sceneManager, physicsWorld) {
    this.sceneManager = sceneManager
    this.physicsWorld = physicsWorld
    this.radius = 0.3
    this.create()
  }

  create() {
    this.mesh = this.sceneManager.createBall(this.radius)
    this.sceneManager.addMesh('ball', this.mesh)

    this.body = this.physicsWorld.createBall(this.radius, { x: 3.2, y: 5, z: 6.5 })
    this.physicsWorld.addBody('ball', this.body)
  }

  reset() {
    this.body.position.set(3.2, 5, 6.5)
    this.body.velocity.set(0, 0, 0)
    this.body.angularVelocity.set(0, 0, 0)
  }

  update() {
    this.mesh.position.copy(this.body.position)
    this.mesh.quaternion.copy(this.body.quaternion)
  }

  isOutOfBounds() {
    return this.body.position.y < -5 || this.body.position.z > 9
  }
}
