import { DEFAULT_SETTINGS, type Settings, type StoredImage, type StoredScene } from './types'

const SETTINGS_KEY = 'tp:settings'
const IMAGE_INDEX_KEY = 'tp:imageIndex'
const IMAGE_DATA_PREFIX = 'tp:image:'
const SCENES_KEY = 'tp:scenes'
const MAX_SCENES = 12
const MAX_THUMB_LENGTH = 24_000

export type ImageMeta = Omit<StoredImage, 'dataUrl'> & { bytes: number; thumb: string }

/** 同一页面（忽略 hash 与 query）的存储键 */
export function sceneKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return url
  }
}

async function get<T>(key: string, fallback: T): Promise<T> {
  try {
    const data = await chrome.storage.local.get(key)
    return (data[key] as T) ?? fallback
  } catch {
    return fallback
  }
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

export async function getSettings(): Promise<Settings> {
  const saved = await get<Partial<Settings>>(SETTINGS_KEY, {})
  return { ...DEFAULT_SETTINGS, ...saved }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await set(SETTINGS_KEY, next)
  return next
}

/* ------------------------------------------------------------------ 素材库 */

export async function listImages(): Promise<ImageMeta[]> {
  const index = await get<ImageMeta[]>(IMAGE_INDEX_KEY, [])
  return [...index].sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

export async function getImageData(id: string): Promise<string | null> {
  return get<string | null>(`${IMAGE_DATA_PREFIX}${id}`, null)
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function imageId(dataUrl: string): string {
  return `img_${fnv1a(dataUrl)}_${dataUrl.length.toString(36)}`
}

export async function addImage(
  image: { name: string; dataUrl: string; width: number; height: number },
  thumb: string,
): Promise<ImageMeta> {
  const id = imageId(image.dataUrl)
  const index = await get<ImageMeta[]>(IMAGE_INDEX_KEY, [])
  const existing = index.find((item) => item.id === id)
  const meta: ImageMeta = {
    id,
    name: image.name || '未命名设计稿',
    width: image.width,
    height: image.height,
    createdAt: existing?.createdAt ?? Date.now(),
    lastUsedAt: Date.now(),
    bytes: image.dataUrl.length,
    thumb: thumb.length > MAX_THUMB_LENGTH ? '' : thumb,
  }
  if (!existing) {
    await set(`${IMAGE_DATA_PREFIX}${id}`, image.dataUrl)
  }
  await set(IMAGE_INDEX_KEY, [meta, ...index.filter((item) => item.id !== id)])
  return meta
}

export async function touchImage(id: string): Promise<void> {
  const index = await get<ImageMeta[]>(IMAGE_INDEX_KEY, [])
  const hit = index.find((item) => item.id === id)
  if (!hit) return
  hit.lastUsedAt = Date.now()
  await set(IMAGE_INDEX_KEY, index)
}

export async function deleteImage(id: string): Promise<void> {
  const index = await get<ImageMeta[]>(IMAGE_INDEX_KEY, [])
  await chrome.storage.local.remove(`${IMAGE_DATA_PREFIX}${id}`)
  await set(
    IMAGE_INDEX_KEY,
    index.filter((item) => item.id !== id),
  )
}

/** 清理未被任何场景引用的旧素材，避免素材库无限膨胀 */
export async function gcImages(limit: number): Promise<void> {
  const [index, scenes] = await Promise.all([
    get<ImageMeta[]>(IMAGE_INDEX_KEY, []),
    get<Record<string, StoredScene>>(SCENES_KEY, {}),
  ])
  if (index.length <= limit) return
  const referenced = new Set<string>()
  Object.values(scenes).forEach((scene) => scene.layers.forEach((layer) => referenced.add(layer.imageId)))
  const removable = index
    .filter((item) => !referenced.has(item.id))
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
  const overflow = index.length - limit
  const doomed = removable.slice(0, overflow)
  if (!doomed.length) return
  await chrome.storage.local.remove(doomed.map((item) => `${IMAGE_DATA_PREFIX}${item.id}`))
  const doomedIds = new Set(doomed.map((item) => item.id))
  await set(
    IMAGE_INDEX_KEY,
    index.filter((item) => !doomedIds.has(item.id)),
  )
}

/* ------------------------------------------------------------------ 场景 */

export async function getScenes(): Promise<Record<string, StoredScene>> {
  return get<Record<string, StoredScene>>(SCENES_KEY, {})
}

export async function getScene(key: string): Promise<StoredScene | null> {
  const scenes = await getScenes()
  return scenes[key] ?? null
}

export async function saveScene(key: string, scene: StoredScene | null): Promise<void> {
  const scenes = await getScenes()
  if (!scene || (!scene.layers.length && !Object.keys(scenes).length)) {
    delete scenes[key]
  } else if (scene) {
    scenes[key] = { ...scene, updatedAt: Date.now() }
  }
  const entries = Object.entries(scenes).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  const trimmed = Object.fromEntries(entries.slice(0, MAX_SCENES))
  await set(SCENES_KEY, trimmed)
}

/* ------------------------------------------------------------------ 其他 */

export async function getTotalUsage(): Promise<number> {
  try {
    const bytes = await chrome.storage.local.getBytesInUse(null)
    return bytes
  } catch {
    return 0
  }
}

export async function clearAll(): Promise<void> {
  await chrome.storage.local.clear()
}
