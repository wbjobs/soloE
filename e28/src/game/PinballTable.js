import * as THREE from 'three'

export class PinballTable {
  constructor(sceneManager, physicsWorld) {
    this.sceneManager = sceneManager
    this.physicsWorld = physicsWorld
    this.tableWidth = 8
    this.tableLength = 16
    this.tableTilt = 0.12
    this.createTable()
    this.createWalls()
    this.createBumpers()
    this.createFlippers()
    this.createPlunger()
    this.createScoreZones()
  }

  createTable() {
    const tableMesh = this.sceneManager.createPlane(
      { x: this.tableWidth, z: this.tableLength },
      0x1a1a2e
    )
    tableMesh.rotation.x = -Math.PI / 2 + this.tableTilt
    tableMesh.position.y = 0
    this.sceneManager.addMesh('table', tableMesh)

    const tableBody = this.physicsWorld.createPlane(
      { x: 0, y: 0, z: 0 },
      { x: -Math.PI / 2 + this.tableTilt, y: 0, z: 0 }
    )
    this.physicsWorld.addBody('table', tableBody)

    const borderGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(this.tableWidth, 0.2, this.tableLength))
    const borderMaterial = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 })
    const border = new THREE.LineSegments(borderGeometry, borderMaterial)
    border.position.y = 0.1
    this.sceneManager.scene.add(border)
  }

  createWalls() {
    const wallHeight = 2
    const wallThickness = 0.3

    const leftWallMesh = this.sceneManager.createBox(
      { x: wallThickness, y: wallHeight, z: this.tableLength },
      0x16213e,
      { metalness: 0.8, roughness: 0.2, emissive: 0x00e5ff, emissiveIntensity: 0.1 }
    )
    leftWallMesh.position.set(-this.tableWidth / 2, wallHeight / 2, 0)
    this.sceneManager.addMesh('leftWall', leftWallMesh)

    const leftWallBody = this.physicsWorld.createBox(
      { x: wallThickness, y: wallHeight, z: this.tableLength },
      { x: -this.tableWidth / 2, y: wallHeight / 2, z: 0 }
    )
    this.physicsWorld.addBody('leftWall', leftWallBody)

    const rightWallMesh = this.sceneManager.createBox(
      { x: wallThickness, y: wallHeight, z: this.tableLength },
      0x16213e,
      { metalness: 0.8, roughness: 0.2, emissive: 0x00e5ff, emissiveIntensity: 0.1 }
    )
    rightWallMesh.position.set(this.tableWidth / 2, wallHeight / 2, 0)
    this.sceneManager.addMesh('rightWall', rightWallMesh)

    const rightWallBody = this.physicsWorld.createBox(
      { x: wallThickness, y: wallHeight, z: this.tableLength },
      { x: this.tableWidth / 2, y: wallHeight / 2, z: 0 }
    )
    this.physicsWorld.addBody('rightWall', rightWallBody)

    const backWallMesh = this.sceneManager.createBox(
      { x: this.tableWidth - 1.5, y: wallHeight, z: wallThickness },
      0x16213e,
      { metalness: 0.8, roughness: 0.2, emissive: 0x00e5ff, emissiveIntensity: 0.1 }
    )
    backWallMesh.position.set(-0.75, wallHeight / 2, -this.tableLength / 2)
    this.sceneManager.addMesh('backWall', backWallMesh)

    const backWallBody = this.physicsWorld.createBox(
      { x: this.tableWidth - 1.5, y: wallHeight, z: wallThickness },
      { x: -0.75, y: wallHeight / 2, z: -this.tableLength / 2 }
    )
    this.physicsWorld.addBody('backWall', backWallBody)

    const frontWallMesh = this.sceneManager.createBox(
      { x: this.tableWidth - 1.5, y: wallHeight, z: wallThickness },
      0x16213e,
      { metalness: 0.8, roughness: 0.2, emissive: 0x00e5ff, emissiveIntensity: 0.1 }
    )
    frontWallMesh.position.set(-0.75, wallHeight / 2, this.tableLength / 2 - 2)
    this.sceneManager.addMesh('frontWall', frontWallMesh)

    const frontWallBody = this.physicsWorld.createBox(
      { x: this.tableWidth - 1.5, y: wallHeight, z: wallThickness },
      { x: -0.75, y: wallHeight / 2, z: this.tableLength / 2 - 2 }
    )
    this.physicsWorld.addBody('frontWall', frontWallBody)
  }

  createBumpers() {
    const bumperPositions = [
      { x: -2, z: -3 },
      { x: 2, z: -3 },
      { x: 0, z: -5 },
      { x: -1.5, z: -6.5 },
      { x: 1.5, z: -6.5 }
    ]

    bumperPositions.forEach((pos, index) => {
      const bumperMesh = this.sceneManager.createCylinder(0.5, 0.8, 0xff1744, {
        emissiveIntensity: 0.8
      })
      bumperMesh.position.set(pos.x, 0.4, pos.z)
      this.sceneManager.addMesh(`bumper${index}`, bumperMesh)

      const bumperBody = this.physicsWorld.createCylinder(0.5, 0.8, { x: pos.x, y: 0.4, z: pos.z })
      this.physicsWorld.addBody(`bumper${index}`, bumperBody)
    })
  }

  createFlippers() {
    const flipperWidth = 0.4
    const flipperLength = 2
    const flipperHeight = 0.3

    const leftAnchorBody = this.physicsWorld.createBox(
      { x: 0.1, y: 0.1, z: 0.1 },
      { x: -2.5, y: 0.2, z: 4.5 }
    )
    this.physicsWorld.addBody('leftAnchor', leftAnchorBody)

    const leftFlipperBody = this.physicsWorld.createBox(
      { x: flipperWidth, y: flipperHeight, z: flipperLength },
      { x: -2.5, y: 0.3, z: 4.5 },
      1
    )
    this.physicsWorld.addBody('leftFlipper', leftFlipperBody)

    this.leftConstraint = this.physicsWorld.createHingeConstraint(
      leftAnchorBody, leftFlipperBody,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: flipperLength / 2 - 0.1 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 }
    )
    this.leftConstraint.enableMotor()
    this.leftConstraint.setMotorMaxForce(100)

    const leftFlipperMesh = this.sceneManager.createBox(
      { x: flipperWidth, y: flipperHeight, z: flipperLength },
      0x00e676,
      { metalness: 0.9, roughness: 0.1, emissive: 0x00e676, emissiveIntensity: 0.4 }
    )
    this.sceneManager.addMesh('leftFlipper', leftFlipperMesh)

    const rightAnchorBody = this.physicsWorld.createBox(
      { x: 0.1, y: 0.1, z: 0.1 },
      { x: 2.5, y: 0.2, z: 4.5 }
    )
    this.physicsWorld.addBody('rightAnchor', rightAnchorBody)

    const rightFlipperBody = this.physicsWorld.createBox(
      { x: flipperWidth, y: flipperHeight, z: flipperLength },
      { x: 2.5, y: 0.3, z: 4.5 },
      1
    )
    this.physicsWorld.addBody('rightFlipper', rightFlipperBody)

    this.rightConstraint = this.physicsWorld.createHingeConstraint(
      rightAnchorBody, rightFlipperBody,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: flipperLength / 2 - 0.1 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 }
    )
    this.rightConstraint.enableMotor()
    this.rightConstraint.setMotorMaxForce(100)

    const rightFlipperMesh = this.sceneManager.createBox(
      { x: flipperWidth, y: flipperHeight, z: flipperLength },
      0x00e676,
      { metalness: 0.9, roughness: 0.1, emissive: 0x00e676, emissiveIntensity: 0.4 }
    )
    this.sceneManager.addMesh('rightFlipper', rightFlipperMesh)
  }

  createPlunger() {
    const plungerWidth = 0.5
    const plungerLength = 0.8
    const plungerHeight = 0.4

    const plungerBody = this.physicsWorld.createBox(
      { x: plungerWidth, y: plungerHeight, z: plungerLength },
      { x: 3.2, y: 0.3, z: 6.5 },
      1
    )
    this.physicsWorld.addBody('plunger', plungerBody)

    const plungerMesh = this.sceneManager.createBox(
      { x: plungerWidth, y: plungerHeight, z: plungerLength },
      0xffea00,
      { metalness: 0.9, roughness: 0.1, emissive: 0xffea00, emissiveIntensity: 0.3 }
    )
    this.sceneManager.addMesh('plunger', plungerMesh)

    const plungerWallBody = this.physicsWorld.createBox(
      { x: 1, y: 2, z: 0.3 },
      { x: 3.2, y: 1, z: 7.5 }
    )
    this.physicsWorld.addBody('plungerWall', plungerWallBody)

    const plungerWallMesh = this.sceneManager.createBox(
      { x: 1, y: 2, z: 0.3 },
      0x16213e
    )
    plungerWallMesh.position.set(3.2, 1, 7.5)
    this.sceneManager.addMesh('plungerWall', plungerWallMesh)

    const leftGuideBody = this.physicsWorld.createBox(
      { x: 0.2, y: 2, z: 3 },
      { x: 2.5, y: 1, z: 6 }
    )
    this.physicsWorld.addBody('leftGuide', leftGuideBody)

    const leftGuideMesh = this.sceneManager.createBox(
      { x: 0.2, y: 2, z: 3 },
      0x16213e
    )
    leftGuideMesh.position.set(2.5, 1, 6)
    this.sceneManager.addMesh('leftGuide', leftGuideMesh)
  }

  createScoreZones() {
    const zonePositions = [
      { x: -2, z: -1, points: 100 },
      { x: 2, z: -1, points: 100 },
      { x: 0, z: -2, points: 200 }
    ]

    zonePositions.forEach((zone, index) => {
      const zoneMesh = this.sceneManager.createCylinder(0.4, 0.1, 0x7c4dff, {
        emissiveIntensity: 0.6
      })
      zoneMesh.position.set(zone.x, 0.05, zone.z)
      this.sceneManager.addMesh(`scoreZone${index}`, zoneMesh)
    })
  }

  setLeftFlipper(active) {
    const targetVelocity = active ? -8 : 8
    this.leftConstraint.setMotorSpeed(targetVelocity)
  }

  setRightFlipper(active) {
    const targetVelocity = active ? 8 : -8
    this.rightConstraint.setMotorSpeed(targetVelocity)
  }

  launchPlunger() {
    const plunger = this.physicsWorld.getBody('plunger')
    if (plunger) {
      plunger.applyImpulse({ x: 0, y: 0, z: -15 }, { x: 0, y: 0, z: 0 })
    }
  }
}
