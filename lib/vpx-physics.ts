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

const VPX_ONE_METER_IN_SPEED_UNITS = 18.53
const SOLID_SPHERE_INERTIA_FACTOR = 2 / 5

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
