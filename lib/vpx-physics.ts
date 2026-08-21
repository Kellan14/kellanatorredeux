// SPDX-License-Identifier: GPL-3.0-or-later
// Contact response ported from Visual Pinball's GPLv3+ physics implementation:
// https://github.com/vpinball/vpinball/blob/master/src/physics/hitflipper.cpp
// https://github.com/vpinball/vpinball/blob/master/src/physics/hitball.cpp

export type VpxPhysicsBall = {
  vx: number
  vy: number
  angularVelocity: number
  radius: number
}

export type VpxSurfaceContact = {
  normalX: number
  normalY: number
  elasticity: number
  elasticityFalloff: number
  friction: number
  surfaceVelocityX?: number
  surfaceVelocityY?: number
  frictionUsesCollisionImpulse?: boolean
}

export type VpxContactResult = {
  normalSpeed: number
  normalImpulse: number
}

export type VpxFlipperParameters = {
  startAngle: number
  endAngle: number
  length: number
  mass: number
  strength: number
  returnRatio: number
  rampUp: number
  torqueDamping: number
  torqueDampingAngle: number
  elasticity: number
  elasticityFalloff: number
  friction: number
}

export type VpxFlipperMover = {
  angle: number
  angularMomentum: number
  angularVelocity: number
  angularAcceleration: number
  currentTorque: number
  contactTorque: number
  inertia: number
  isInContact: boolean
}

export type VpxFlipperContact = {
  normalX: number
  normalY: number
  radiusX: number
  radiusY: number
  worldAngularDirection: 1 | -1
  ballVelocityScale?: number
}

const VPX_ONE_METER_IN_SPEED_UNITS = 18.53
const SOLID_SPHERE_INERTIA_FACTOR = 2 / 5

export function createVpxFlipperMover(parameters: VpxFlipperParameters): VpxFlipperMover {
  return {
    angle: parameters.startAngle,
    angularMomentum: 0,
    angularVelocity: 0,
    angularAcceleration: 0,
    currentTorque: 0,
    contactTorque: 0,
    inertia: parameters.mass * parameters.length * parameters.length / 3,
    isInContact: false,
  }
}

/** Port of FlipperMoverObject::UpdateVelocities/UpdateDisplacements. */
export function stepVpxFlipperMover(
  mover: VpxFlipperMover,
  parameters: VpxFlipperParameters,
  solenoidActive: boolean,
  deltaTime: number,
) {
  const direction = parameters.endAngle >= parameters.startAngle ? 1 : -1
  let desiredTorque = parameters.strength * (solenoidActive ? 1 : -parameters.returnRatio)
  const endStopDistance = Math.abs(mover.angle - parameters.endAngle)
  if (endStopDistance < parameters.torqueDampingAngle) {
    const ratio = endStopDistance / parameters.torqueDampingAngle
    const dampingBlend = ratio ** 4
    desiredTorque *= dampingBlend + parameters.torqueDamping * (1 - dampingBlend)
  }
  desiredTorque *= direction

  const torqueRampSpeed = parameters.rampUp <= 0
    ? 1e6
    : Math.min(parameters.strength / parameters.rampUp, 1e6)
  const maximumTorqueChange = torqueRampSpeed * deltaTime
  mover.currentTorque += Math.max(
    -maximumTorqueChange,
    Math.min(maximumTorqueChange, desiredTorque - mover.currentTorque),
  )

  let appliedTorque = mover.currentTorque
  mover.isInContact = false
  const angleMinimum = Math.min(parameters.startAngle, parameters.endAngle)
  const angleMaximum = Math.max(parameters.startAngle, parameters.endAngle)
  if (Math.abs(mover.angularVelocity) <= 1e-2) {
    if (mover.angle >= angleMaximum - 1e-2 && appliedTorque > 0) {
      mover.angle = angleMaximum
      mover.isInContact = true
      mover.contactTorque = appliedTorque
      mover.angularMomentum = 0
      appliedTorque = 0
    } else if (mover.angle <= angleMinimum + 1e-2 && appliedTorque < 0) {
      mover.angle = angleMinimum
      mover.isInContact = true
      mover.contactTorque = appliedTorque
      mover.angularMomentum = 0
      appliedTorque = 0
    }
  }

  mover.angularMomentum += deltaTime * appliedTorque
  mover.angularVelocity = mover.angularMomentum / mover.inertia
  mover.angularAcceleration = appliedTorque / mover.inertia
  mover.angle += mover.angularVelocity * deltaTime

  let hitStop = false
  if (mover.angle > angleMaximum) {
    mover.angle = angleMaximum
    hitStop = mover.angularVelocity > 0
  } else if (mover.angle < angleMinimum) {
    mover.angle = angleMinimum
    hitStop = mover.angularVelocity < 0
  }
  if (hitStop) {
    mover.angularMomentum *= -0.3
    mover.angularVelocity = mover.angularMomentum / mover.inertia
  }
}

/**
 * Applies VPX's normal and Coulomb-friction impulses to a unit-mass ball.
 * Returns null when the ball is already separating from the surface.
 */
export function resolveVpxSurfaceContact(ball: VpxPhysicsBall, contact: VpxSurfaceContact) {
  const {
    normalX,
    normalY,
    elasticity,
    elasticityFalloff,
    friction,
    surfaceVelocityX = 0,
    surfaceVelocityY = 0,
    frictionUsesCollisionImpulse = false,
  } = contact
  const relativeVelocityX = ball.vx - surfaceVelocityX
  const relativeVelocityY = ball.vy - surfaceVelocityY
  const normalSpeed = relativeVelocityX * normalX + relativeVelocityY * normalY
  if (normalSpeed >= 0) return null

  const effectiveElasticity = elasticity
    / (1 + elasticityFalloff * Math.abs(normalSpeed) / VPX_ONE_METER_IN_SPEED_UNITS)
  const normalImpulse = -(1 + effectiveElasticity) * normalSpeed
  ball.vx += normalImpulse * normalX
  ball.vy += normalImpulse * normalY

  const tangentX = -normalY
  const tangentY = normalX
  const contactRadiusX = -normalX * ball.radius
  const contactRadiusY = -normalY * ball.radius
  const ballInertia = SOLID_SPHERE_INERTIA_FACTOR * ball.radius * ball.radius
  const ballSurfaceVelocityX = -ball.angularVelocity * contactRadiusY
  const ballSurfaceVelocityY = ball.angularVelocity * contactRadiusX
  const tangentSpeed = (relativeVelocityX + ballSurfaceVelocityX) * tangentX
    + (relativeVelocityY + ballSurfaceVelocityY) * tangentY
  const radiusCrossTangent = contactRadiusX * tangentY - contactRadiusY * tangentX
  const tangentEffectiveMass = 1 + radiusCrossTangent * radiusCrossTangent / ballInertia

  // VPX limits tangential impulse to the Coulomb friction cone.
  const reactionImpulse = frictionUsesCollisionImpulse ? normalImpulse : Math.abs(normalSpeed)
  const maximumFrictionImpulse = friction * reactionImpulse
  const tangentImpulse = Math.max(
    -maximumFrictionImpulse,
    Math.min(maximumFrictionImpulse, -tangentSpeed / tangentEffectiveMass),
  )
  ball.vx += tangentImpulse * tangentX
  ball.vy += tangentImpulse * tangentY
  ball.angularVelocity += radiusCrossTangent * tangentImpulse / ballInertia
  return { normalSpeed, normalImpulse } satisfies VpxContactResult
}

/** Port of HitFlipper::Collide, including flipper recoil and tangential impulse. */
export function resolveVpxFlipperContact(
  ball: VpxPhysicsBall,
  mover: VpxFlipperMover,
  parameters: VpxFlipperParameters,
  contact: VpxFlipperContact,
) {
  const {
    normalX,
    normalY,
    radiusX,
    radiusY,
    worldAngularDirection,
    ballVelocityScale = 1,
  } = contact
  const ballContactRadiusX = -ball.radius * normalX
  const ballContactRadiusY = -ball.radius * normalY
  const ballInertia = SOLID_SPHERE_INERTIA_FACTOR * ball.radius * ball.radius
  let ballVelocityX = ball.vx * ballVelocityScale
  let ballVelocityY = ball.vy * ballVelocityScale
  let ballAngularVelocity = ball.angularVelocity * ballVelocityScale
  const ballSurfaceVelocityX = ballVelocityX - ballAngularVelocity * ballContactRadiusY
  const ballSurfaceVelocityY = ballVelocityY + ballAngularVelocity * ballContactRadiusX
  const worldAngularVelocity = mover.angularVelocity * worldAngularDirection
  const flipperSurfaceVelocityX = -worldAngularVelocity * radiusY
  const flipperSurfaceVelocityY = worldAngularVelocity * radiusX
  const relativeVelocityX = ballSurfaceVelocityX - flipperSurfaceVelocityX
  const relativeVelocityY = ballSurfaceVelocityY - flipperSurfaceVelocityY
  let normalSpeed = relativeVelocityX * normalX + relativeVelocityY * normalY
  if (normalSpeed >= 0) return null

  let angularResponse = radiusX * normalY - radiusY * normalX
  let flipperResponseScaling = 1
  const worldContactTorque = mover.contactTorque * worldAngularDirection
  const angularImpulseDirection = -angularResponse
  if (mover.isInContact && worldContactTorque * angularImpulseDirection >= 0) {
    angularResponse = 0
    flipperResponseScaling = 0.5
  }

  const effectiveElasticity = parameters.elasticity
    / (1 + parameters.elasticityFalloff * Math.abs(normalSpeed) / VPX_ONE_METER_IN_SPEED_UNITS)
  let normalImpulse = -(1 + effectiveElasticity) * normalSpeed
    / (1 + angularResponse * angularResponse / mover.inertia)
  let flipperAngularImpulse = (
    radiusX * (-normalImpulse * flipperResponseScaling * normalY)
    - radiusY * (-normalImpulse * flipperResponseScaling * normalX)
  )

  if (mover.isInContact && flipperAngularImpulse * worldContactTorque < 0) {
    const recoilTime = -flipperAngularImpulse / worldContactTorque
    const normalSpeedAfter = normalSpeed + normalImpulse
    if (recoilTime <= 0.5 || normalSpeedAfter > 0) {
      normalImpulse = -(1 + effectiveElasticity) * normalSpeed
      flipperAngularImpulse = 0
    }
  }

  ballVelocityX += normalImpulse * normalX
  ballVelocityY += normalImpulse * normalY
  mover.angularMomentum += flipperAngularImpulse * worldAngularDirection
  mover.angularVelocity = mover.angularMomentum / mover.inertia

  let tangentX = relativeVelocityX - normalSpeed * normalX
  let tangentY = relativeVelocityY - normalSpeed * normalY
  const tangentSpeedSquared = tangentX * tangentX + tangentY * tangentY
  if (tangentSpeedSquared > 1e-6) {
    const inverseTangentSpeed = 1 / Math.sqrt(tangentSpeedSquared)
    tangentX *= inverseTangentSpeed
    tangentY *= inverseTangentSpeed
    const tangentSpeed = relativeVelocityX * tangentX + relativeVelocityY * tangentY
    const ballRadiusCrossTangent = ballContactRadiusX * tangentY - ballContactRadiusY * tangentX
    const flipperRadiusCrossTangent = radiusX * tangentY - radiusY * tangentX
    const tangentEffectiveMass = 1
      + ballRadiusCrossTangent * ballRadiusCrossTangent / ballInertia
      + flipperRadiusCrossTangent * flipperRadiusCrossTangent / mover.inertia
    const maximumFrictionImpulse = parameters.friction * normalImpulse
    const tangentImpulse = Math.max(
      -maximumFrictionImpulse,
      Math.min(maximumFrictionImpulse, -tangentSpeed / tangentEffectiveMass),
    )
    ballVelocityX += tangentImpulse * tangentX
    ballVelocityY += tangentImpulse * tangentY
    ballAngularVelocity += ballRadiusCrossTangent * tangentImpulse / ballInertia
    mover.angularMomentum += (-tangentImpulse * flipperRadiusCrossTangent) * worldAngularDirection
    mover.angularVelocity = mover.angularMomentum / mover.inertia
  }

  ball.vx = ballVelocityX / ballVelocityScale
  ball.vy = ballVelocityY / ballVelocityScale
  ball.angularVelocity = ballAngularVelocity / ballVelocityScale

  return { normalSpeed, normalImpulse } satisfies VpxContactResult
}

/** Applies VPX's shaped, post-collision scatter distribution. */
export function applyVpxScatter(ball: VpxPhysicsBall, scatterDegrees: number, normalImpulse: number) {
  const scatterRadians = scatterDegrees * Math.PI / 180
  if (normalImpulse <= 1 || scatterRadians <= 1e-5) return

  let scatter = Math.random() * 2 - 1
  scatter *= (1 - scatter * scatter) * 2.59808 * scatterRadians
  const sin = Math.sin(scatter)
  const cos = Math.cos(scatter)
  const velocityX = ball.vx
  ball.vx = velocityX * cos - ball.vy * sin
  ball.vy = ball.vy * cos + velocityX * sin
}

/** Port of HitBall::Collide for two equal, unit-mass balls. */
export function resolveVpxBallCollision(
  first: VpxPhysicsBall,
  second: VpxPhysicsBall,
  normalX: number,
  normalY: number,
) {
  const closingSpeed = (second.vx - first.vx) * normalX + (second.vy - first.vy) * normalY
  if (closingSpeed >= 0) return false

  // VPX uses a fixed 0.8 coefficient of restitution for ball/ball impacts.
  const impulse = -(1 + 0.8) * closingSpeed / 2
  first.vx -= impulse * normalX
  first.vy -= impulse * normalY
  second.vx += impulse * normalX
  second.vy += impulse * normalY
  return true
}
