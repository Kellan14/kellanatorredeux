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

export type VpxSpatialSurfaceContact = {
  normalX: number
  normalY: number
  normalZ: number
  elasticity: number
  elasticityFalloff: number
  friction: number
}

export type VpxKickerBevelContact = {
  meshNormalX: number
  meshNormalY: number
  meshNormalZ: number
  hitNormalX: number
  hitNormalY: number
  hitNormalZ: number
}

export type VpxContactResult = {
  normalSpeed: number
  normalImpulse: number
}

export type VpxPlanarBall = VpxPhysicsBall & {
  x: number
  y: number
}

export type VpxPlayfieldBall = VpxPhysicsBall & {
  angularVelocityX: number
  angularVelocityY: number
}

export type VpxSpatialBall = VpxPlayfieldBall & {
  vz: number
}

export type VpxPlayfieldFriction = {
  deltaTime: number
  friction: number
  normalAcceleration: number
  planarAccelerationX: number
  planarAccelerationY: number
}

export type VpxSurfaceFriction = {
  deltaTime: number
  friction: number
  normalAcceleration: number
  tangentAcceleration: number
  lateralAcceleration: number
  tangentX: number
  tangentY: number
  tangentZ: number
  lateralX: number
  lateralY: number
  lateralZ: number
  normalX: number
  normalY: number
  normalZ: number
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

export type VpxGateMover = {
  angle: number
  angularVelocity: number
}

export type VpxGateParameters = {
  angleMin: number
  angleMax: number
  damping: number
  gravityFactor: number
  twoWay: boolean
  height: number
}

export type VpxSpinnerMover = {
  angle: number
  angularVelocity: number
}

export type VpxSpinnerParameters = {
  angleMin: number
  angleMax: number
  damping: number
  height: number
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

/**
 * Port of HitBall::ApplyFriction for the implicit playfield plane.
 *
 * VPX evaluates the velocity of the ball at the bottom contact point, then
 * applies a Coulomb-limited impulse to both linear and angular motion. This is
 * what turns sliding into rolling; generic velocity damping cannot reproduce
 * that transition and also removes energy from a ball that is already rolling.
 */
export function applyVpxPlayfieldFriction(
  ball: VpxPlayfieldBall,
  contact: VpxPlayfieldFriction,
) {
  const {
    deltaTime,
    friction,
    normalAcceleration,
    planarAccelerationX,
    planarAccelerationY,
  } = contact
  if (deltaTime <= 0 || friction <= 0 || normalAcceleration <= 0) return false

  const radius = ball.radius
  const inertia = SOLID_SPHERE_INERTIA_FACTOR * radius * radius
  // omega x (0, 0, -radius), added to center-of-mass velocity.
  const surfaceVelocityX = ball.vx - ball.angularVelocityY * radius
  const surfaceVelocityY = ball.vy + ball.angularVelocityX * radius
  const slipSpeed = Math.hypot(surfaceVelocityX, surfaceVelocityY)

  let tangentX: number
  let tangentY: number
  let numerator: number
  if (slipSpeed < 1e-4) {
    // VPX's static-friction branch uses acceleration at the contact point,
    // including the centripetal term from the full angular velocity vector.
    const surfaceAccelerationX = planarAccelerationX
      - radius * ball.angularVelocity * ball.angularVelocityX
    const surfaceAccelerationY = planarAccelerationY
      - radius * ball.angularVelocity * ball.angularVelocityY
    const accelerationLength = Math.hypot(surfaceAccelerationX, surfaceAccelerationY)
    if (accelerationLength < 1e-6) return false
    tangentX = surfaceAccelerationX / accelerationLength
    tangentY = surfaceAccelerationY / accelerationLength
    numerator = -accelerationLength
  } else {
    tangentX = surfaceVelocityX / slipSpeed
    tangentY = surfaceVelocityY / slipSpeed
    numerator = -slipSpeed
  }

  // Cross((0, 0, -radius), tangent).
  const torqueDirectionX = radius * tangentY
  const torqueDirectionY = -radius * tangentX
  const effectiveMass = 1
    + (torqueDirectionX * torqueDirectionX + torqueDirectionY * torqueDirectionY) / inertia
  const maximumFrictionForce = friction * normalAcceleration
  const frictionForce = Math.max(
    -maximumFrictionForce,
    Math.min(maximumFrictionForce, numerator / effectiveMass),
  )
  const impulse = deltaTime * frictionForce
  if (!Number.isFinite(impulse)) return false

  ball.vx += impulse * tangentX
  ball.vy += impulse * tangentY
  ball.angularVelocityX += impulse * torqueDirectionX / inertia
  ball.angularVelocityY += impulse * torqueDirectionY / inertia
  return true
}

/**
 * Applies HitBall::ApplyFriction in an arbitrary 3D surface basis.
 *
 * VPX uses the same ball/contact calculation on ramps as it does on the
 * playfield. Rotating the ball into ramp-local coordinates lets the exact
 * Coulomb rolling/sliding transition above remain the single source of truth.
 */
export function applyVpxSurfaceFriction(
  ball: VpxSpatialBall,
  contact: VpxSurfaceFriction,
) {
  const localBall: VpxPlayfieldBall = {
    vx: ball.vx * contact.tangentX + ball.vy * contact.tangentY + ball.vz * contact.tangentZ,
    vy: ball.vx * contact.lateralX + ball.vy * contact.lateralY + ball.vz * contact.lateralZ,
    angularVelocityX: ball.angularVelocityX * contact.tangentX
      + ball.angularVelocityY * contact.tangentY
      + ball.angularVelocity * contact.tangentZ,
    angularVelocityY: ball.angularVelocityX * contact.lateralX
      + ball.angularVelocityY * contact.lateralY
      + ball.angularVelocity * contact.lateralZ,
    angularVelocity: ball.angularVelocityX * contact.normalX
      + ball.angularVelocityY * contact.normalY
      + ball.angularVelocity * contact.normalZ,
    radius: ball.radius,
  }
  const applied = applyVpxPlayfieldFriction(localBall, {
    deltaTime: contact.deltaTime,
    friction: contact.friction,
    normalAcceleration: contact.normalAcceleration,
    planarAccelerationX: contact.tangentAcceleration,
    planarAccelerationY: contact.lateralAcceleration,
  })
  if (!applied) return false

  ball.vx = localBall.vx * contact.tangentX + localBall.vy * contact.lateralX
  ball.vy = localBall.vx * contact.tangentY + localBall.vy * contact.lateralY
  ball.vz = localBall.vx * contact.tangentZ + localBall.vy * contact.lateralZ
  ball.angularVelocityX = localBall.angularVelocityX * contact.tangentX
    + localBall.angularVelocityY * contact.lateralX
    + localBall.angularVelocity * contact.normalX
  ball.angularVelocityY = localBall.angularVelocityX * contact.tangentY
    + localBall.angularVelocityY * contact.lateralY
    + localBall.angularVelocity * contact.normalY
  ball.angularVelocity = localBall.angularVelocityX * contact.tangentZ
    + localBall.angularVelocityY * contact.lateralZ
    + localBall.angularVelocity * contact.normalZ
  return true
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

export function createVpxGateMover(parameters: VpxGateParameters): VpxGateMover {
  return { angle: parameters.angleMin, angularVelocity: 0 }
}

/** Port of GateMoverObject::UpdateVelocities/UpdateDisplacements. */
export function stepVpxGateMover(
  mover: VpxGateMover,
  parameters: VpxGateParameters,
  deltaTime: number,
) {
  mover.angularVelocity -= Math.sin(mover.angle) * parameters.gravityFactor * 0.1 * deltaTime
  mover.angularVelocity *= Math.pow(parameters.damping, deltaTime)
  mover.angle += mover.angularVelocity * deltaTime

  if (mover.angle > parameters.angleMax) {
    mover.angle = parameters.angleMax
    if (mover.angularVelocity > 0) mover.angularVelocity *= -parameters.damping * 0.8
  } else if (mover.angle < parameters.angleMin) {
    mover.angle = parameters.angleMin
    if (mover.angularVelocity < 0) mover.angularVelocity *= -parameters.damping * 0.8
  }
}

/** Port of Gate::Collide. Gates react to the ball but do not add an artificial rigid-wall bounce. */
export function hitVpxGateMover(
  mover: VpxGateMover,
  parameters: VpxGateParameters,
  normalSpeed: number,
  fromBack: boolean,
) {
  let angularVelocity = Math.abs(normalSpeed) / Math.max(parameters.height / 2, 1e-6)
  if (fromBack && !parameters.twoWay) angularVelocity /= 50
  mover.angularVelocity = fromBack ? -angularVelocity : angularVelocity
}

export function createVpxSpinnerMover(): VpxSpinnerMover {
  return { angle: 0, angularVelocity: 0 }
}

/** Port of SpinnerMoverObject::UpdateVelocities/UpdateDisplacements. */
export function stepVpxSpinnerMover(
  mover: VpxSpinnerMover,
  parameters: VpxSpinnerParameters,
  deltaTime: number,
) {
  mover.angularVelocity -= Math.sin(mover.angle) * 0.025 * deltaTime
  mover.angularVelocity *= Math.pow(parameters.damping, deltaTime)
  mover.angle += mover.angularVelocity * deltaTime

  if (parameters.angleMin === parameters.angleMax) {
    const fullTurn = Math.PI * 2
    mover.angle = ((mover.angle % fullTurn) + fullTurn) % fullTurn
    return
  }
  if (mover.angle > parameters.angleMax) {
    mover.angle = parameters.angleMax
    if (mover.angularVelocity > 0) mover.angularVelocity *= -parameters.damping * 0.8
  } else if (mover.angle < parameters.angleMin) {
    mover.angle = parameters.angleMin
    if (mover.angularVelocity < 0) mover.angularVelocity *= -parameters.damping * 0.8
  }
}

/** Port of Spinner::Collide. The sign records which face of the blade was struck. */
export function hitVpxSpinnerMover(
  mover: VpxSpinnerMover,
  parameters: VpxSpinnerParameters,
  normalSpeed: number,
  fromBack: boolean,
) {
  const angularVelocity = Math.abs(normalSpeed) / Math.max(parameters.height / 2, 1e-6) * parameters.damping
  mover.angularVelocity = fromBack ? -angularVelocity : angularVelocity
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

/** Direct 3D port of HitBall::Collide3DWall for a unit-mass solid sphere. */
export function resolveVpxSpatialSurfaceContact(
  ball: VpxSpatialBall,
  contact: VpxSpatialSurfaceContact,
) {
  const normalSpeed = ball.vx * contact.normalX
    + ball.vy * contact.normalY
    + ball.vz * contact.normalZ
  if (normalSpeed >= 0) return null

  const effectiveElasticity = contact.elasticity
    / (1 + contact.elasticityFalloff * Math.abs(normalSpeed) / VPX_ONE_METER_IN_SPEED_UNITS)
  const normalImpulse = -(1 + effectiveElasticity) * normalSpeed
  ball.vx += normalImpulse * contact.normalX
  ball.vy += normalImpulse * contact.normalY
  ball.vz += normalImpulse * contact.normalZ

  const radiusX = -ball.radius * contact.normalX
  const radiusY = -ball.radius * contact.normalY
  const radiusZ = -ball.radius * contact.normalZ
  const angularSurfaceX = ball.angularVelocityY * radiusZ - ball.angularVelocity * radiusY
  const angularSurfaceY = ball.angularVelocity * radiusX - ball.angularVelocityX * radiusZ
  const angularSurfaceZ = ball.angularVelocityX * radiusY - ball.angularVelocityY * radiusX
  const surfaceVelocityX = ball.vx + angularSurfaceX
  const surfaceVelocityY = ball.vy + angularSurfaceY
  const surfaceVelocityZ = ball.vz + angularSurfaceZ
  const postNormalSpeed = surfaceVelocityX * contact.normalX
    + surfaceVelocityY * contact.normalY
    + surfaceVelocityZ * contact.normalZ
  let tangentX = surfaceVelocityX - postNormalSpeed * contact.normalX
  let tangentY = surfaceVelocityY - postNormalSpeed * contact.normalY
  let tangentZ = surfaceVelocityZ - postNormalSpeed * contact.normalZ
  const tangentSpeed = Math.hypot(tangentX, tangentY, tangentZ)
  if (tangentSpeed > 1e-6) {
    tangentX /= tangentSpeed
    tangentY /= tangentSpeed
    tangentZ /= tangentSpeed
    const crossX = radiusY * tangentZ - radiusZ * tangentY
    const crossY = radiusZ * tangentX - radiusX * tangentZ
    const crossZ = radiusX * tangentY - radiusY * tangentX
    const inertia = SOLID_SPHERE_INERTIA_FACTOR * ball.radius * ball.radius
    const effectiveMass = 1 + (crossX * crossX + crossY * crossY + crossZ * crossZ) / inertia
    const maximumFrictionImpulse = contact.friction * Math.abs(normalSpeed)
    const tangentImpulse = Math.max(
      -maximumFrictionImpulse,
      Math.min(maximumFrictionImpulse, -tangentSpeed / effectiveMass),
    )
    ball.vx += tangentImpulse * tangentX
    ball.vy += tangentImpulse * tangentY
    ball.vz += tangentImpulse * tangentZ
    ball.angularVelocityX += tangentImpulse * crossX / inertia
    ball.angularVelocityY += tangentImpulse * crossY / inertia
    ball.angularVelocity += tangentImpulse * crossZ / inertia
  }
  return { normalSpeed, normalImpulse } satisfies VpxContactResult
}

/**
 * Port of KickerHitCircle::DoChangeBallVelocity for a non-legacy kicker.
 * VPX uses a normal from its kickerHitMesh for the reaction impulse and the
 * circular hit-volume normal for the ball contact point/friction tangent.
 */
export function resolveVpxKickerBevelContact(
  ball: VpxSpatialBall,
  contact: VpxKickerBevelContact,
) {
  const surfacePointX = -ball.radius * contact.hitNormalX
  const surfacePointY = -ball.radius * contact.hitNormalY
  const surfacePointZ = -ball.radius * contact.hitNormalZ
  const angularSurfaceX = ball.angularVelocityY * surfacePointZ - ball.angularVelocity * surfacePointY
  const angularSurfaceY = ball.angularVelocity * surfacePointX - ball.angularVelocityX * surfacePointZ
  const angularSurfaceZ = ball.angularVelocityX * surfacePointY - ball.angularVelocityY * surfacePointX
  const surfaceVelocityX = ball.vx + angularSurfaceX
  const surfaceVelocityY = ball.vy + angularSurfaceY
  const surfaceVelocityZ = ball.vz + angularSurfaceZ

  const meshSpeed = ball.vx * contact.meshNormalX
    + ball.vy * contact.meshNormalY
    + ball.vz * contact.meshNormalZ
  const normalImpulse = -meshSpeed
  const reactionImpulse = Math.abs(normalImpulse)

  const hitNormalSurfaceSpeed = surfaceVelocityX * contact.hitNormalX
    + surfaceVelocityY * contact.hitNormalY
    + surfaceVelocityZ * contact.hitNormalZ
  let tangentX = surfaceVelocityX - hitNormalSurfaceSpeed * contact.meshNormalX
  let tangentY = surfaceVelocityY - hitNormalSurfaceSpeed * contact.meshNormalY
  let tangentZ = surfaceVelocityZ - hitNormalSurfaceSpeed * contact.meshNormalZ

  ball.vx += normalImpulse * contact.meshNormalX
  ball.vy += normalImpulse * contact.meshNormalY
  ball.vz += normalImpulse * contact.meshNormalZ

  const tangentLength = Math.hypot(tangentX, tangentY, tangentZ)
  if (tangentLength > 1e-6) {
    tangentX /= tangentLength
    tangentY /= tangentLength
    tangentZ /= tangentLength
    const tangentSpeed = surfaceVelocityX * tangentX
      + surfaceVelocityY * tangentY
      + surfaceVelocityZ * tangentZ
    const crossX = surfacePointY * tangentZ - surfacePointZ * tangentY
    const crossY = surfacePointZ * tangentX - surfacePointX * tangentZ
    const crossZ = surfacePointX * tangentY - surfacePointY * tangentX
    const inertia = SOLID_SPHERE_INERTIA_FACTOR * ball.radius * ball.radius
    const effectiveMass = 1 + (crossX * crossX + crossY * crossY + crossZ * crossZ) / inertia
    const maximumFrictionImpulse = 0.3 * reactionImpulse
    const tangentImpulse = Math.max(
      -maximumFrictionImpulse,
      Math.min(maximumFrictionImpulse, -tangentSpeed / effectiveMass),
    )
    ball.vx += tangentImpulse * tangentX
    ball.vy += tangentImpulse * tangentY
    ball.vz += tangentImpulse * tangentZ
    ball.angularVelocityX += tangentImpulse * crossX / inertia
    ball.angularVelocityY += tangentImpulse * crossY / inertia
    ball.angularVelocity += tangentImpulse * crossZ / inertia
  }
  return { normalSpeed: meshSpeed, normalImpulse: reactionImpulse } satisfies VpxContactResult
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
