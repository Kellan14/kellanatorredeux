const assert = require('node:assert/strict')
const fs = require('node:fs')
const sharp = require('sharp')
;(async () => {
  const fallback = fs.readFileSync('public/opdb_backglass_images/AFM.jpg')
  for (const key of ['24', '4Aces']) {
    for (const folder of ['', 'thumbnails/']) {
      const path = `public/opdb_backglass_images/${folder}${key}.jpg`
      const bytes = fs.readFileSync(path)
      const metadata = await sharp(bytes).metadata()
      assert.equal(metadata.format, 'jpeg')
      assert.ok(metadata.width >= 200 && metadata.height > 100)
      assert.ok(!bytes.equals(fallback), `${key} must have its own artwork`)
      if (folder) assert.equal(metadata.width, 200)
    }
  }
  assert.ok(fs.existsSync('public/opdb_backglass_images/placeholder.svg'))
  const page = fs.readFileSync('app/machines/page.tsx', 'utf8')
  assert.ok(!page.includes("target.src = '/opdb_backglass_images/thumbnails/AFM.jpg'"))
  console.log('24 and 4 Aces backglass assets, thumbnails and neutral fallback passed')
})().catch(error => { console.error(error); process.exitCode = 1 })
