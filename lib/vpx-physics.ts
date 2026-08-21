// SPDX-License-Identifier: GPL-3.0-or-later
// Contact response ported from Visual Pinball's GPLv3+ physics implementation:
// https://github.com/vpinball/vpinball/blob/master/src/physics/hitflipper.cpp
// https://github.com/vpinball/vpinball/blob/master/src/physics/hitball.cpp
// https://github.com/vpinball/vpinball/blob/master/src/physics/collide.cpp

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

export type VpxPlanarBall = VpxPhysicsBall & {
  x: number
  y: number
}

export type VpxLineSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
  thickness?: number
}

export type VpxLineContact = {
  normalX: number
  normalY: number
  penetration: number
}

export type VpxLineHit = VpxLineContact & {
  time: number
}

export type VpxStaticContact = {
  normalX: number
  normalY: number
  friction: number
  externalVelocityDeltaX?: number
  externalVelocityDeltaY?: number
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
export const VPX_CONTACT_VELOCITY = 0.099

/**
 * Discrete counterpart of VPX LineSeg + HitLineZ collision geometry.
 *
 * A VPX wall face is one-sided and uses its winding-defined normal; it is
 * not an independent two-sided capsule. The vertical joint at v1 supplies
 * the radial endpoint contact. Since every closed wall segment contributes
 * its own v1, each polygon joint is represented exactly once.
 */
export function getVpxLineSegmentContact(
  ball: VpxPlanarBall,
  segment: VpxLineSegment,
): VpxLineContact | null {
  const dx = segment.x2 - segment.x1
  const dy = segment.y2 - segment.y1
  const length = Math.hypot(dx, dy)
  if (length <= 1e-8) return null

  const tangentX = dx / length
  const tangentY = dy / length
  // Direct port of LineSeg::CalcNormalAndLength. Clockwise VPX wall
  // polygons therefore expose their outward-facing normal.
  const faceNormalX = -tangentY
  const faceNormalY = tangentX
  const relativeX = ball.x - segment.x1
  const relativeY = ball.y - segment.y1
  const tangentDistance = relativeX * tangentX + relativeY * tangentY
  const normalDistance = relativeX * faceNormalX + relativeY * faceNormalY
  const contactRadius = ball.radius + (segment.thickness ?? 0)

  let closest: VpxLineContact | null = null
  if (normalDistance >= 0 && tangentDistance >= 0 && tangentDistance <= length) {
    const penetration = contactRadius - normalDistance
    if (penetration > 0) {
      closest = { normalX: faceNormalX, normalY: faceNormalY, penetration }
    }
  }

  // VPX adds a HitLineZ at v1 for the round vertical polygon joint.
  const jointDistance = Math.hypot(relativeX, relativeY)
  if (jointDistance > 1e-8 && jointDistance < contactRadius) {
    const jointContact = {
      normalX: relativeX / jointDistance,
      normalY: relativeY / jointDistance,
      penetration: contactRadius - jointDistance,
    }
    if (!closest || jointContact.penetration > closest.penetration) closest = jointContact
  }

  return closest
}

/** Port of VPX LineSeg::HitTestBasic and HitLineZ::HitTest in the XY plane. */
export function getVpxLineSegmentHit(
  ball: VpxPlanarBall,
  segment: VpxLineSegment,
  maximumTime: number,
): VpxLineHit | null {
  const dx = segment.x2 - segment.x1
  const dy = segment.y2 - segment.y1
  const length = Math.hypot(dx, dy)
  if (length <= 1e-8 || maximumTime < 0) return null

  const tangentX = dx / length
  const tangentY = dy / length
  const faceNormalX = -tangentY
  const faceNormalY = tangentX
  const relativeX = ball.x - segment.x1
  const relativeY = ball.y - segment.y1
  const contactRadius = ball.radius + (segment.thickness ?? 0)
  const normalDistance = relativeX * faceNormalX + relativeY * faceNormalY
  const normalSpeed = ball.vx * faceNormalX + ball.vy * faceNormalY
  const faceSeparation = normalDistance - contactRadius

  let earliest: VpxLineHit | null = null
  // VPX LineSeg faces are directional. A ball behind the winding-defined
  // face or clearly receding from it cannot hit that face.
  if (normalDistance >= 0 && normalSpeed < -1e-8) {
    const time = faceSeparation <= 0 ? 0 : faceSeparation / -normalSpeed
    if (time <= maximumTime) {
      const tangentDistance = relativeX * tangentX + relativeY * tangentY
        + (ball.vx * tangentX + ball.vy * tangentY) * time
      if (tangentDistance >= 0 && tangentDistance <= length) {
        earliest = {
          time,
          normalX: faceNormalX,
          normalY: faceNormalY,
          penetration: Math.max(0, -faceSeparation),
        }
      }
    }
  }

  // Surface::AddLine creates a vertical HitLineZ at v1. In the playfield
  // plane this is a swept circle-versus-point test for the round joint.
  const speedSquared = ball.vx * ball.vx + ball.vy * ball.vy
  const approach = relativeX * ball.vx + relativeY * ball.vy
  const jointSeparationSquared = relativeX * relativeX + relativeY * relativeY - contactRadius * contactRadius
  let jointTime = Number.POSITIVE_INFINITY
  if (jointSeparationSquared < 0 && approach < 0) {
    jointTime = 0
  } else if (speedSquared > 1e-8 && approach < 0) {
    const discriminant = approach * approach - speedSquared * jointSeparationSquared
    if (discriminant >= 0) jointTime = (-approach - Math.sqrt(discriminant)) / speedSquared
  }
  if (jointTime >= 0 && jointTime <= maximumTime && (!earliest || jointTime < earliest.time)) {
    const hitRelativeX = relativeX + ball.vx * jointTime
    const hitRelativeY = relativeY + ball.vy * jointTime
    const hitDistance = Math.hypot(hitRelativeX, hitRelativeY)
    if (hitDistance > 1e-8) {
      earliest = {
        time: jointTime,
        normalX: hitRelativeX / hitDistance,
        normalY: hitRelativeY / hitDistance,
        penetration: jointTime === 0 ? Math.max(0, contactRadius - Math.hypot(relativeX, relativeY)) : 0,
      }
    }
  }

  return earliest
}

/**
 * Planar port of HitBall::HandleStaticContact/ApplyFriction. Gravity has
 * already been integrated by the caller, so killing the remaining inward
 * speed also supplies the supporting normal impulse without restitution.
 */
export function resolveVpxStaticContact(ball: VpxPhysicsBall, contact: VpxStaticContact) {
  const {
    normalX,
    normalY,
    friction,
    externalVelocityDeltaX = 0,
    externalVelocityDeltaY = 0,
  } = contact
  const normalSpeed = ball.vx * normalX + ball.vy * normalY
  if (normalSpeed > VPX_CONTACT_VELOCITY) return null

  const normalImpulse = Math.max(0, -normalSpeed)
  ball.vx += normalImpulse * normalX
  ball.vy += normalImpulse * normalY

  const tangentX = -normalY
  const tangentY = normalX
  const contactRadiusX = -normalX * ball.radius
  const contactRadiusY = -normalY * ball.radius
  const ballInertia = SOLID_SPHERE_INERTIA_FACTOR * ball.radius * ball.radius
  const ballSurfaceVelocityX = ball.vx - ball.angularVelocity * contactRadiusY
  const ballSurfaceVelocityY = ball.vy + ball.angularVelocity * contactRadiusX
  const tangentSpeed = ballSurfaceVelocityX * tangentX + ballSurfaceVelocityY * tangentY
  const radiusCrossTangent = contactRadiusX * tangentY - contactRadiusY * tangentX
  const tangentEffectiveMass = 1 + radiusCrossTangent * radiusCrossTangent / ballInertia
  const externalNormalImpulse = Math.max(
    0,
    -(externalVelocityDeltaX * normalX + externalVelocityDeltaY * normalY),
  )
  const maximumFrictionImpulse = friction * Math.max(normalImpulse, externalNormalImpulse)
  const tangentImpulse = Math.max(
    -maximumFrictionImpulse,
    Math.min(maximumFrictionImpulse, -tangentSpeed / tangentEffectiveMass),
  )
  ball.vx += tangentImpulse * tangentX
  ball.vy += tangentImpulse * tangentY
  ball.angularVelocity += radiusCrossTangent * tangentImpulse / ballInertia
  return { normalSpeed, normalImpulse } satisfies VpxContactResult
}

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
