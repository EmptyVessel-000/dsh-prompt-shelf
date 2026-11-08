import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

export const name = '@emptyvessel_003/dsh-prompt-shelf'
export const inject = ['connection', 'dshHomePath']

const CHANNEL = '/dsh-prompt-shelf'

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validState(value) {
  if (!isRecord(value) || !Array.isArray(value.cards) || !isRecord(value.sessions)) return false
  for (const card of value.cards) {
    if (!isRecord(card) || typeof card.id !== 'string' || typeof card.title !== 'string' || typeof card.content !== 'string') return false
    if (card.tags !== undefined && (!Array.isArray(card.tags) || card.tags.some(tag => typeof tag !== 'string'))) return false
    if (card.pinned !== undefined && typeof card.pinned !== 'boolean') return false
  }
  for (const cardIds of Object.values(value.sessions)) {
    if (!Array.isArray(cardIds) || cardIds.some(id => typeof id !== 'string')) return false
  }
  return true
}

export function apply(ctx) {
  const file = ctx.dshHomePath('dsh-prompt-shelf', 'data.json')

  ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
    try {
      if (endpoint === 'load') {
        let text
        try {
          text = await readFile(file, 'utf8')
        } catch (error) {
          if (error && error.code === 'ENOENT') return { ok: true, value: null }
          throw error
        }
        const value = JSON.parse(text)
        if (!validState(value)) throw new Error('指令架数据结构无效，已停止读取以保护原文件')
        return { ok: true, value }
      }
      if (endpoint === 'save') {
        if (!validState(payload)) return { ok: false, error: { code: 'invalid-state', message: '指令架数据结构无效' } }
        await mkdir(dirname(file), { recursive: true })
        const temporary = join(dirname(file), '.' + randomUUID() + '.tmp')
        try {
          const handle = await open(temporary, 'wx')
          try {
            await handle.writeFile(JSON.stringify(payload, null, 2) + '\n', 'utf8')
            await handle.sync()
          } finally {
            await handle.close()
          }
          await rename(temporary, file)
        } catch (error) {
          await rm(temporary, { force: true })
          throw error
        }
        return { ok: true, value: { saved: true } }
      }
      return { ok: false, error: { code: 'unknown-endpoint', message: 'unknown endpoint ' + String(endpoint) } }
    } catch (error) {
      return { ok: false, error: { code: 'storage-error', message: error && error.message ? error.message : String(error) } }
    }
  }))
}
