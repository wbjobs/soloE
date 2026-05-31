import * as CANNON from 'cannon-es'

export class PhysicsWorld {
  constructor() {
    this.world = null
    this.bodies = new Map()
    this.init()
  }

  init() {
    this.world = new CANNON.World()
    this.world.gravity.set(0, -9.82, 0)
    this.world.broadphase = new CANNON.NaiveBroadphase()
    this.world.solver.iterations = 20
    this.world.solver.tolerance = 0.001
    this.world.defaultContactMaterial.contactEquationStiffness = 1e7
    this.world.defaultContactMaterial.contactEquationRelaxation = 3
    this.world.allowSleep = false
  }

  addBody(name, body) {
    this.bodies.set(name, body)
    this.world.addBody(body)
    return body
  }

  getBody(name) {
    return this.bodies.get(name)
  }

  removeBody(name) {
    const body = this.bodies.get(name)
    if (body) {
      this.world.removeBody(body)
      this.bodies.delete(name)
    }
  }

  step(deltaTime) {
    this.world.step(1 / 120, deltaTime, 10)
  }

  createBall(radius = 0.3, position = { x: 0, y: 5, z: 0 }) {
    const shape = new CANNON.Sphere(radius)
    const body = new CANNON.Body({
      mass: 1,
      shape: shape,
      material: new CANNON.Material({ restitution: 0.8, friction: 0.3 }),
      collisionFilterGroup: 1,
      collisionFilterMask: -1,
      allowSleep: false
    })
    body.position.set(position.x, position.y, position.z)
    body.linearDamping = 0.1
    body.angularDamping = 0.1
    body.ccdIterations = 10
    body.ccdThreshold = 0.1
    return body
  }

  createBox(size = { x: 1, y: 1, z: 1 }, position = { x: 0, y: 0, z: 0 }, mass = 0) {
    const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2))
    const body = new CANNON.Body({
      mass: mass,
      shape: shape,
      material: new CANNON.Material({ restitution: 0.5, friction: 0.3 }),
      collisionFilterGroup: 2,
      collisionFilterMask: -1,
      allowSleep: false
    })
    body.position.set(position.x, position.y, position.z)
    body.ccdIterations = 5
    body.ccdThreshold = 0.05
    return body
  }

  createCylinder(radius = 0.5, height = 1, position = { x: 0, y: 0, z: 0 }) {
    const shape = new CANNON.Cylinder(radius, radius, height, 16)
    const body = new CANNON.Body({
      mass: 0,
      shape: shape,
      material: new CANNON.Material({ restitution: 1.2, friction: 0.1 }),
      collisionFilterGroup: 2,
      collisionFilterMask: -1,
      allowSleep: false
    })
    body.position.set(position.x, position.y, position.z)
    body.ccdIterations = 5
    body.ccdThreshold = 0.05
    return body
  }

  createPlane(position = { x: 0, y: 0, z: 0 }, rotation = { x: 0, y: 0, z: 0 }) {
    const shape = new CANNON.Plane()
    const body = new CANNON.Body({
      mass: 0,
      shape: shape,
      material: new CANNON.Material({ restitution: 0.3, friction: 0.3 }),
      collisionFilterGroup: 2,
      collisionFilterMask: -1,
      allowSleep: false
    })
    body.position.set(position.x, position.y, position.z)
    body.quaternion.setFromEuler(rotation.x, rotation.y, rotation.z)
    body.ccdIterations = 5
    body.ccdThreshold = 0.05
    return body
  }

  createHingeConstraint(bodyA, bodyB, pivotA, pivotB, axisA, axisB) {
    const constraint = new CANNON.HingeConstraint(bodyA, bodyB, {
      pivotA: new CANNON.Vec3(pivotA.x, pivotA.y, pivotA.z),
      pivotB: new CANNON.Vec3(pivotB.x, pivotB.y, pivotB.z),
      axisA: new CANNON.Vec3(axisA.x, axisA.y, axisA.z),
      axisB: new CANNON.Vec3(axisB.x, axisB.y, axisB.z)
    })
    this.world.addConstraint(constraint)
    return constraint
  }
}
