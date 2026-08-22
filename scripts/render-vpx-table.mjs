// Bakes the VPX table's fixed top-down view to a still image.
//
// The picker no longer loads the 30 MB glTF at runtime; it draws this image
// and overlays the animated lamp inserts in 2D (components/vpx-table-lamps.tsx,
// scripts/extract-vpx-lamps.mjs). That means this bake IS the table now, so it
// has to reproduce what components/vpx-table-scene.tsx rendered -- including
// the depth and render-order handling VPX's coplanar layers need. An earlier
// version of this script flattened every material to MeshBasicMaterial and
// silently lost every ramp, plastic, slingshot and pop bumper.
//
// Usage: node scripts/render-vpx-table.mjs <table.glb> <output.webp>
// Then open the printed URL in a browser with WebGL; it POSTs the result back.

import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve } from 'node:path'

const [, , glbArgument, outputArgument] = process.argv
if (!glbArgument || !outputArgument) {
  throw new Error('Usage: node scripts/render-vpx-table.mjs <table.glb> <output.webp>')
}

const glbPath = resolve(glbArgument)
const outputPath = resolve(outputArgument)
const glbSize = (await stat(glbPath)).size
let saved = false

const page = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>VPX table renderer</title>
  <script type="importmap">
    {"imports":{"three":"/three/build/three.module.js","three/":"/three/"}}
  </script>
</head>
<body style="margin:0;background:#000"><div id="status" style="position:fixed;top:0;left:0;color:#0f0;font:14px monospace;z-index:9">loading</div>
<script type="module">
  import * as THREE from 'three'
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

  const status = document.querySelector('#status')
  const width = 1536
  const height = Math.round(width * 2256 / 952)
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // Match the picker's backdrop so the baked edges blend into the card.
  renderer.setClearColor(0x020617, 1)
  document.body.replaceChildren(renderer.domElement, status)

  const scene = new THREE.Scene()
  // vpxtool's glTF export maps VPX x/y/z to glTF x/z/y. Look straight down
  // the height axis while keeping VPX y=0 at the top of the rendered image.
  const camera = new THREE.OrthographicCamera(-476, 476, 1128, -1128, 0.1, 10000)
  camera.position.set(476, 5000, 1128)
  camera.up.set(0, 0, -1)
  camera.lookAt(476, 0, 1128)
  camera.updateProjectionMatrix()

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.4))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8)
  keyLight.position.set(250, 1800, 700)
  scene.add(keyLight)

  // --- kept in sync with components/vpx-table-scene.tsx ---------------------
  const ARTWORK_PATTERN = /(?:logo|decal|texture|targett1round|image_spinner|image_emkicker|deflipper|flipper-[lr]2|ramp[_ ]floor|left ramp|bridge-sidepart|smallwalldecal|scoop_decal|ed209map|gunbulbmap)/i

  function configureVisualLayers(mesh) {
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const materialNames = sourceMaterials.map((material) => material.name).join(' ')
    const artwork = ARTWORK_PATTERN.test(mesh.name + ' ' + materialNames)
    const playfieldArtwork = mesh.name === 'playfield_mesh' || /(?:^|\s)Playfield_pf(?:\s|$)/i.test(materialNames)

    const materials = sourceMaterials.map((sourceMaterial) => {
      const material = sourceMaterial.clone()
      if (material.transparent) material.depthWrite = false
      if (artwork) {
        material.depthWrite = false
        material.polygonOffset = true
        material.polygonOffsetFactor = -4
        material.polygonOffsetUnits = -4
        material.depthTest = false
      }
      if (playfieldArtwork) {
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

  // Inserts are baked dark; the runtime overlay draws the lit state.
  function darkenLampInsert(mesh) {
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      .filter((material) => material.isMeshStandardMaterial)
    materials.forEach((material) => {
      material.transparent = true
      material.opacity = 0
      material.depthWrite = false
      material.emissiveIntensity = 0
    })
    mesh.renderOrder = 400
  }
  // -------------------------------------------------------------------------

  // Bulbs and flashers are drawn by the runtime lamp overlay instead. The
  // *Kicker meshes are the hole cylinders VPX never draws during play, and the
  // Drain* meshes sit under the apron where the ball disappears -- DrainPlate
  // in particular is a flat 46.7-unit disc that baked as an opaque grey circle
  // over the ROBOCOP apron logo. The other *Plate meshes are the visible scoop
  // plates out on the playfield and are kept.
  const HIDDEN = /(?:light|bulb|flasher)|kicker$|^drain/i

  new GLTFLoader().load('/table.glb', async ({ scene: table }) => {
    let meshes = 0
    let hidden = 0
    table.traverse((object) => {
      const insert = object.isMesh && /_insert$/i.test(object.name)
      if (!insert && HIDDEN.test(object.name)) { object.visible = false; hidden += 1 }
      if (!object.isMesh) return
      meshes += 1
      configureVisualLayers(object)
      if (insert) darkenLampInsert(object)
    })
    scene.add(table)
    table.updateMatrixWorld(true)
    status.textContent = 'rendering ' + meshes + ' meshes (' + hidden + ' hidden)'

    // Render twice so any texture that only finished decoding during the first
    // pass is present in the second. Deliberately NOT gated on
    // requestAnimationFrame: rAF never fires in a backgrounded tab, which
    // silently hangs the bake forever.
    renderer.render(scene, camera)
    await new Promise((done) => setTimeout(done, 250))
    renderer.render(scene, camera)

    const blob = await new Promise((toBlob) => renderer.domElement.toBlob(toBlob, 'image/webp', 0.94))
    const response = await fetch('/save', { method: 'POST', body: blob })
    status.textContent = response.ok ? 'saved ' + meshes + ' meshes' : 'failed'
  }, (progress) => {
    status.textContent = 'loading ' + Math.round(progress.loaded / 1048576) + 'MB'
  }, (error) => {
    status.textContent = 'failed: ' + error.message
  })
</script>
</body>
</html>`

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' }

const server = createServer((request, response) => {
  const url = decodeURIComponent((request.url ?? '').split('?')[0])
  if (url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page)
    return
  }
  if (url === '/table.glb') {
    response.writeHead(200, {
      'content-type': 'model/gltf-binary',
      'content-length': glbSize,
      'cache-control': 'no-store',
    })
    createReadStream(glbPath).pipe(response)
    return
  }
  // Serve three from node_modules so the bake does not depend on a CDN.
  if (url.startsWith('/three/') && !url.includes('..')) {
    const file = resolve('node_modules/three', url.slice('/three/'.length))
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).on('error', () => {
      response.destroy()
    }).pipe(response)
    return
  }
  if (url === '/save' && request.method === 'POST') {
    const output = createWriteStream(outputPath)
    request.pipe(output)
    output.on('finish', () => {
      saved = true
      response.writeHead(204)
      response.end()
      setTimeout(() => server.close(), 250)
    })
    output.on('error', (error) => {
      response.writeHead(500)
      response.end(error.message)
    })
    return
  }
  response.writeHead(404)
  response.end()
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  console.log(`VPX_RENDER_URL=http://127.0.0.1:${address.port}/`)
})

server.on('close', () => {
  if (!saved) process.exitCode = 1
})
