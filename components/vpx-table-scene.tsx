'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VPX_TABLE } from '@/lib/vpx-robocop-table'

type Props = { className?: string }

export function VpxTableScene({ className }: Props) {
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
    let disposed = false
    const render = () => {
      if (!host.clientWidth || !host.clientHeight) return
      renderer.setSize(host.clientWidth, host.clientHeight, false)
      renderer.render(scene, camera)
    }
    const resizeObserver = new ResizeObserver(render)
    resizeObserver.observe(host)

    new GLTFLoader().load(VPX_TABLE.modelPath, ({ scene: loadedScene }) => {
      if (disposed) return
      tableScene = loadedScene
      scene.add(loadedScene)
      render()
      renderer.domElement.style.opacity = '1'
    })

    return () => {
      disposed = true
      resizeObserver.disconnect()
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
