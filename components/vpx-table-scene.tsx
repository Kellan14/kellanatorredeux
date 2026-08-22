'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VPX_TABLE } from '@/lib/vpx-robocop-table'
import { getRoboCopLampLevel, type RoboCopRulesState } from '@/lib/robocop-rules'

type Props = {
  className?: string
  getRulesStates?: () => readonly RoboCopRulesState[]
}

type VpxLampVisual = {
  lampNumber: number | null
  isFlasher: boolean
  materials: THREE.MeshStandardMaterial[]
  baseColors: THREE.Color[]
  halo: THREE.Sprite
}

const VPX_ARTWORK_PATTERN = /(?:logo|decal|texture|targett1round|image_spinner|image_emkicker|deflipper|flipper-[lr]2|ramp[_ ]floor|left ramp|bridge-sidepart|smallwalldecal|scoop_decal|ed209map|gunbulbmap)/i

function configureVpxVisualLayers(mesh: THREE.Mesh) {
  const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const materialNames = sourceMaterials.map((material) => material.name).join(' ')
  const artwork = VPX_ARTWORK_PATTERN.test(`${mesh.name} ${materialNames}`)
  const playfieldArtwork = mesh.name === 'playfield_mesh' || /(?:^|\s)Playfield_pf(?:\s|$)/i.test(materialNames)

  // glTF's BLEND materials default to writing the depth buffer. On a VPX
  // table that lets an early transparent plastic or decal hide art rendered
  // later, even where the earlier pixels are transparent.
  const materials = sourceMaterials.map((sourceMaterial) => {
    const material = sourceMaterial.clone()
    if (material.transparent) material.depthWrite = false

    if (artwork) {
      // VPX draws image layers on the owning object's top surface. The glTF
      // export often leaves both surfaces coplanar, so give the artwork a
      // stable depth bias instead of relying on traversal order or z-fighting.
      material.depthWrite = false
      material.polygonOffset = true
      material.polygonOffsetFactor = -4
      material.polygonOffsetUnits = -4
      material.depthTest = false
    }

    if (playfieldArtwork) {
      // The exporter leaves the textured playfield exactly coplanar with the
      // opaque playfield body. Treat the texture as the body's top skin.
      material.transparent = false
      material.opacity = 1
      material.depthWrite = true
      material.depthTest = true
      material.polygonOffset = true
      material.polygonOffsetFactor = -8
      material.polygonOffsetUnits = -8
    }
    return material
  })

  mesh.material = Array.isArray(mesh.material) ? materials : materials[0]
  if (artwork) mesh.renderOrder = 500
  else if (playfieldArtwork) mesh.renderOrder = 100
  else if (materials.some((material) => material.transparent)) mesh.renderOrder = 200
}

function makeLampHaloTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) return null
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,.92)')
  gradient.addColorStop(0.18, 'rgba(255,255,255,.62)')
  gradient.addColorStop(0.48, 'rgba(255,255,255,.18)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function parseLampNumber(name: string) {
  const match = name.match(/^L(\d+)[a-z]?_insert$/i)
  return match ? Number(match[1]) : null
}

function configureLampInsert(mesh: THREE.Mesh) {
  const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    .filter((material): material is THREE.MeshStandardMaterial => material instanceof THREE.MeshStandardMaterial)
  materials.forEach((material) => {
    material.transparent = true
    material.opacity = 0
    material.depthWrite = false
    material.polygonOffset = true
    material.polygonOffsetFactor = -6
    material.polygonOffsetUnits = -6
    material.emissive.copy(material.color)
    material.emissiveIntensity = 0
  })
  mesh.renderOrder = 400
  mesh.visible = true
  return materials
}

export function VpxTableScene({ className, getRulesStates }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x020617, 1)
    renderer.domElement.className = 'absolute inset-0 h-full w-full'
    renderer.domElement.style.opacity = '0'
    renderer.domElement.style.transition = 'opacity 180ms ease-out'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-476, 476, 1128, -1128, 0.1, 10000)
    // vpxtool maps VPX x/y/z to glTF x/z/y. This camera looks straight down
    // the height axis with the lockbar at the bottom of the screen.
    camera.position.set(476, 5000, 1128)
    camera.up.set(0, 0, -1)
    camera.lookAt(476, 0, 1128)
    camera.updateProjectionMatrix()

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.4))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8)
    keyLight.position.set(250, 1800, 700)
    scene.add(keyLight)

    let tableScene: THREE.Object3D | null = null
    let animationFrame: number | null = null
    let haloTexture: THREE.CanvasTexture | null = null
    const lampVisuals: VpxLampVisual[] = []
    let disposed = false
    const render = () => {
      if (!host.clientWidth || !host.clientHeight) return
      renderer.setSize(host.clientWidth, host.clientHeight, false)
      renderer.render(scene, camera)
    }
    const resizeObserver = new ResizeObserver(render)
    resizeObserver.observe(host)

    const updateLamps = (time: number) => {
      const states = getRulesStates?.() ?? []
      lampVisuals.forEach((lamp) => {
        let level = 0
        if (lamp.lampNumber != null) {
          states.forEach((state) => {
            level = Math.max(level, getRoboCopLampLevel(state, lamp.lampNumber!, time))
          })
        } else if (lamp.isFlasher) {
          const awardActive = states.some((state) => state.lastAwardUntil > time)
          level = awardActive && Math.floor(time / 75) % 2 === 0 ? 0.9 : 0
        }

        lamp.materials.forEach((material, index) => {
          material.opacity = level * 0.78
          material.emissive.copy(lamp.baseColors[index])
          material.emissiveIntensity = level * 3.2
        })
        const haloMaterial = lamp.halo.material as THREE.SpriteMaterial
        haloMaterial.opacity = level * 0.52
      })
    }

    let lastLampFrame = 0
    const animateLamps = (time: number) => {
      if (disposed) return
      if (time - lastLampFrame >= 1000 / 30) {
        lastLampFrame = time
        updateLamps(time)
        render()
      }
      animationFrame = window.requestAnimationFrame(animateLamps)
    }

    new GLTFLoader().load(VPX_TABLE.modelPath, ({ scene: loadedScene }) => {
      if (disposed) return
      const inserts: THREE.Mesh[] = []
      loadedScene.traverse((object) => {
        const insert = object instanceof THREE.Mesh && /_insert$/i.test(object.name)
        if (!insert && /(?:light|bulb|flasher)/i.test(object.name)) object.visible = false
        if (object instanceof THREE.Mesh) {
          configureVpxVisualLayers(object)
          if (insert) inserts.push(object)
        }
      })
      tableScene = loadedScene
      scene.add(loadedScene)
      loadedScene.updateMatrixWorld(true)
      haloTexture = makeLampHaloTexture()

      if (haloTexture) inserts.forEach((mesh) => {
        const materials = configureLampInsert(mesh)
        if (materials.length === 0) return
        const bounds = new THREE.Box3().setFromObject(mesh)
        const center = bounds.getCenter(new THREE.Vector3())
        const size = bounds.getSize(new THREE.Vector3())
        const radius = Math.max(size.x, size.z, 14)
        const baseColor = materials[0].color.clone()
        const haloMaterial = new THREE.SpriteMaterial({
          map: haloTexture,
          color: baseColor,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
        })
        const halo = new THREE.Sprite(haloMaterial)
        halo.position.set(center.x, center.y + 0.45, center.z)
        halo.scale.set(radius * 2.3, radius * 2.3, 1)
        halo.renderOrder = 390
        scene.add(halo)
        lampVisuals.push({
          lampNumber: parseLampNumber(mesh.name),
          isFlasher: /^F\d+/i.test(mesh.name),
          materials,
          baseColors: materials.map((material) => material.color.clone()),
          halo,
        })
      })

      updateLamps(performance.now())
      render()
      renderer.domElement.style.opacity = '1'
      animationFrame = window.requestAnimationFrame(animateLamps)
    })

    return () => {
      disposed = true
      resizeObserver.disconnect()
      if (animationFrame != null) window.cancelAnimationFrame(animationFrame)
      lampVisuals.forEach(({ halo }) => {
        ;(halo.material as THREE.SpriteMaterial).dispose()
        scene.remove(halo)
      })
      haloTexture?.dispose()
      if (tableScene) {
        tableScene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        })
      }
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className={className}
      aria-hidden="true"
      style={{ background: "#020617 url('/robocop-playfield-base.webp') center / 100% 100% no-repeat" }}
    />
  )
}
