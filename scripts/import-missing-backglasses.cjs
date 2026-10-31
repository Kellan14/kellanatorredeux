// Real OPDB backglass photos, identified using the corresponding Pinq game pages.
// No generated or substituted artwork. Run explicitly to restore these assets.
const fs = require('node:fs/promises')
const sharp = require('sharp')
const sources = {
  '24': 'https://img.opdb.org/7bc7b517-08c6-48bd-a361-64ba701d8f2a-large.jpg',
  '4Aces': 'https://img.opdb.org/114d4914-d234-47a5-b7ca-debd882f7581-large.jpg',
}
async function main() {
  for (const [key, url] of Object.entries(sources)) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${key}: image request failed (${response.status})`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const metadata = await sharp(bytes).metadata()
    if (!metadata.width || !metadata.height) throw new Error(`${key}: invalid image`)
    await sharp(bytes).jpeg({ quality: 92 }).toFile(`public/opdb_backglass_images/${key}.jpg`)
    await sharp(bytes).resize({ width: 200 }).jpeg({ quality: 80 }).toFile(`public/opdb_backglass_images/thumbnails/${key}.jpg`)
    console.log(`${key}: backglass and thumbnail imported (${metadata.width} x ${metadata.height})`)
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
