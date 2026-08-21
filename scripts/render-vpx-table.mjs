import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

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
    {"imports":{"three":"https://unpkg.com/three@0.180.0/build/three.module.js"}}
  </script>
</head>
<body style="margin:0;background:#000"><div id="status">loading</div>
<script type="module">
  import * as THREE from 'three'
  import { GLTFLoader } from 'https://unpkg.com/three@0.180.0/examples/jsm/loaders/GLTFLoader.js'

  const width = 1536
  const height = Math.round(width * 2256 / 952)
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 1)
  document.body.replaceChildren(renderer.domElement, document.querySelector('#status'))

  const scene = new THREE.Scene()
  // vpxtool's glTF export maps VPX x/y/z to glTF x/z/y. Look straight down
  // the height axis while keeping VPX y=0 at the top of the rendered image.
  const camera = new THREE.OrthographicCamera(-476, 476, 1128, -1128, 0.1, 10000)
  camera.position.set(476, 5000, 1128)
  camera.up.set(0, 0, -1)
  camera.lookAt(476, 0, 1128)
  camera.updateProjectionMatrix()

  const basicMaterial = (source) => new THREE.MeshBasicMaterial({
    color: source.color ?? new THREE.Color(0xffffff),
    map: source.map ?? null,
    alphaMap: source.alphaMap ?? null,
    transparent: source.transparent || source.opacity < 1,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: source.opacity >= 1,
  })

  new GLTFLoader().load('/table.glb', async ({ scene: table }) => {
    table.traverse((object) => {
      if (!object.isMesh) return
      object.material = Array.isArray(object.material)
        ? object.material.map(basicMaterial)
        : basicMaterial(object.material)
    })
    scene.add(table)
    renderer.render(scene, camera)
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame))
    renderer.render(scene, camera)
    const blob = await new Promise((resolveBlob) => renderer.domElement.toBlob(resolveBlob, 'image/webp', 0.94))
    const response = await fetch('/save', { method: 'POST', body: blob })
    document.querySelector('#status').textContent = response.ok ? 'saved' : 'failed'
  }, undefined, (error) => {
    document.querySelector('#status').textContent = 'failed: ' + error.message
  })
</script>
</body>
</html>`

const server = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page)
    return
  }
  if (request.url === '/table.glb') {
    response.writeHead(200, {
      'content-type': 'model/gltf-binary',
      'content-length': glbSize,
      'cache-control': 'no-store',
    })
    createReadStream(glbPath).pipe(response)
    return
  }
  if (request.url === '/save' && request.method === 'POST') {
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
