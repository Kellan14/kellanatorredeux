// Minimal reader for Visual Pinball .vpx files.
//
// A .vpx is an OLE2 compound file (CFBF). Table geometry lives under the
// GameStg storage as "GameItem<N>" streams, each of which is a 4-byte item
// type followed by VPX's BIFF-style tagged records:
//
//   uint32 size | 4-byte ASCII tag | (size - 4) bytes of payload
//
// This exists so the ported physics tables can be checked against, and
// regenerated from, the original table rather than hand-tuned numbers.

import { readFile } from 'node:fs/promises'

const SIGNATURE = 'd0cf11e0a1b11ae1'
const FREESECT = 0xffffffff
const ENDOFCHAIN = 0xfffffffe

/** Reads the compound-file container and returns its streams by path. */
export async function readCompoundFile(path) {
  const data = await readFile(path)
  if (data.subarray(0, 8).toString('hex') !== SIGNATURE) throw new Error('not an OLE compound file')

  const sectorSize = 1 << data.readUInt16LE(30)
  const miniSectorSize = 1 << data.readUInt16LE(32)
  const miniCutoff = data.readUInt32LE(56)
  const sectorOffset = (sector) => (sector + 1) * sectorSize

  // --- FAT -----------------------------------------------------------------
  const difat = []
  for (let index = 0; index < 109; index += 1) {
    const sector = data.readUInt32LE(76 + index * 4)
    if (sector === FREESECT) break
    difat.push(sector)
  }
  let difatSector = data.readUInt32LE(68)
  const difatCount = data.readUInt32LE(72)
  for (let index = 0; index < difatCount && difatSector !== ENDOFCHAIN && difatSector !== FREESECT; index += 1) {
    const base = sectorOffset(difatSector)
    const perSector = sectorSize / 4 - 1
    for (let entry = 0; entry < perSector; entry += 1) {
      const sector = data.readUInt32LE(base + entry * 4)
      if (sector !== FREESECT) difat.push(sector)
    }
    difatSector = data.readUInt32LE(base + perSector * 4)
  }

  const fat = []
  for (const sector of difat) {
    const base = sectorOffset(sector)
    for (let entry = 0; entry < sectorSize / 4; entry += 1) fat.push(data.readUInt32LE(base + entry * 4))
  }

  const chain = (start, table) => {
    const sectors = []
    let sector = start
    while (sector !== ENDOFCHAIN && sector !== FREESECT && sector < table.length) {
      sectors.push(sector)
      sector = table[sector]
      if (sectors.length > table.length) throw new Error('cyclic sector chain')
    }
    return sectors
  }

  const readChain = (start, size) => {
    const parts = chain(start, fat).map((sector) => data.subarray(sectorOffset(sector), sectorOffset(sector) + sectorSize))
    return Buffer.concat(parts).subarray(0, size)
  }

  // --- MiniFAT -------------------------------------------------------------
  const miniFat = []
  for (const sector of chain(data.readUInt32LE(60), fat)) {
    const base = sectorOffset(sector)
    for (let entry = 0; entry < sectorSize / 4; entry += 1) miniFat.push(data.readUInt32LE(base + entry * 4))
  }

  // --- Directory -----------------------------------------------------------
  const directoryBytes = readChain(data.readUInt32LE(48), Number.MAX_SAFE_INTEGER)
  const entries = []
  for (let offset = 0; offset + 128 <= directoryBytes.length; offset += 128) {
    const nameLength = directoryBytes.readUInt16LE(offset + 64)
    const name = nameLength > 2
      ? directoryBytes.subarray(offset, offset + nameLength - 2).toString('utf16le')
      : ''
    entries.push({
      name,
      type: directoryBytes.readUInt8(offset + 66), // 1 storage, 2 stream, 5 root
      child: directoryBytes.readInt32LE(offset + 76),
      left: directoryBytes.readInt32LE(offset + 68),
      right: directoryBytes.readInt32LE(offset + 72),
      start: directoryBytes.readUInt32LE(offset + 116),
      size: Number(directoryBytes.readBigUInt64LE(offset + 120)),
    })
  }

  const root = entries[0]
  const miniStream = readChain(root.start, root.size)
  const readMini = (start, size) => {
    const parts = chain(start, miniFat)
      .map((sector) => miniStream.subarray(sector * miniSectorSize, (sector + 1) * miniSectorSize))
    return Buffer.concat(parts).subarray(0, size)
  }

  // Walk the red-black directory tree into flat "Storage/Stream" paths.
  const streams = new Map()
  const walkSiblings = (index, prefix) => {
    if (index < 0 || index >= entries.length) return
    const entry = entries[index]
    walkSiblings(entry.left, prefix)
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.type === 2) {
      streams.set(path, entry.size < miniCutoff ? readMini(entry.start, entry.size) : readChain(entry.start, entry.size))
    } else if (entry.type === 1) {
      walkSiblings(entry.child, path)
    }
    walkSiblings(entry.right, prefix)
  }
  walkSiblings(root.child, '')
  return streams
}

/**
 * Splits a VPX BIFF stream into records. Tags repeat (drag points, for
 * example), so this returns an ordered list rather than an object.
 */
export function parseBiff(buffer, startOffset = 0) {
  const records = []
  let offset = startOffset
  while (offset + 4 <= buffer.length) {
    const size = buffer.readUInt32LE(offset)
    offset += 4
    if (size < 4 || offset + size > buffer.length) break
    const tag = buffer.subarray(offset, offset + 4).toString('latin1')
    const data = buffer.subarray(offset + 4, offset + size)
    offset += size
    records.push({ tag, data })
    if (tag === 'ENDB') break
  }
  return records
}

const asFloat = (record) => (record.data.length >= 4 ? record.data.readFloatLE(0) : null)
const asInt = (record) => (record.data.length >= 4 ? record.data.readInt32LE(0) : null)
const asString = (record) => (record.data.length >= 4
  ? record.data.subarray(4, 4 + record.data.readUInt32LE(0)).toString('utf16le').replace(/\0+$/, '')
  : '')

/** Convenience view over one game item: name, type, and first-value-per-tag. */
export function readGameItem(buffer) {
  const type = buffer.readInt32LE(0)
  const records = parseBiff(buffer, 4)
  const item = { type, records, name: '' }
  for (const record of records) {
    if (record.tag === 'NAME') {
      // NAME is a raw UTF-16 blob in most items and a length-prefixed string
      // in others; the raw form has no sane 4-byte length prefix.
      const prefix = record.data.length >= 4 ? record.data.readUInt32LE(0) : 0
      item.name = prefix > 0 && prefix + 4 <= record.data.length
        ? asString(record)
        : record.data.toString('utf16le').replace(/\0+$/, '')
      break
    }
  }
  return item
}

export const biff = { asFloat, asInt, asString }
