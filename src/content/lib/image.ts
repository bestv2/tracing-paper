import { t } from '@/shared/i18n'
import type { RenderMode } from '@/shared/types'
import { loadImageSize } from '@/shared/utils'

export interface PreparedImage {
  src: string
  mode: RenderMode
  width: number
  height: number
  bitmap?: ImageBitmap
}

const cache = new Map<string, Promise<PreparedImage>>()
const bitmaps = new Map<string, ImageBitmap>()

/** canvas 降级渲染时按图层 id 保存位图 */
export function registerBitmap(key: string, bitmap?: ImageBitmap): void {
  if (bitmap) bitmaps.set(key, bitmap)
}

export function getRegisteredBitmap(key: string): ImageBitmap | undefined {
  return bitmaps.get(key)
}

/** dataURL 手动转 Blob：不经过 fetch，避免被页面 connect-src CSP 拦掉 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, body] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(header)?.[1] ?? 'image/png'
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function canLoad(src: string, timeout = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const img = new Image()
    img.onload = () => done(img.naturalWidth > 0 && img.naturalHeight > 0)
    img.onerror = () => done(false)
    img.src = src
    window.setTimeout(() => done(false), timeout)
  })
}

/**
 * 逐级降级加载设计稿：
 * 1. dataURL（大多数页面可用）
 * 2. blobURL（页面 img-src 禁止 data: 时）
 * 3. ImageBitmap + canvas（CSP 同时禁止 data: 与 blob: 时）
 */
export function prepareImage(dataUrl: string): Promise<PreparedImage> {
  const cached = cache.get(dataUrl)
  if (cached) return cached

  const task = (async (): Promise<PreparedImage> => {
    const size = await loadImageSize(dataUrl).catch(() => null)
    if (size) {
      return { src: dataUrl, mode: 'img', width: size.width, height: size.height }
    }

    let blob: Blob
    try {
      blob = dataUrlToBlob(dataUrl)
    } catch {
      throw new Error(t('import.err.parse'))
    }

    const blobUrl = URL.createObjectURL(blob)
    if (await canLoad(blobUrl)) {
      const dimension = await loadImageSize(blobUrl)
      return { src: blobUrl, mode: 'img', width: dimension.width, height: dimension.height }
    }

    try {
      const bitmap = await createImageBitmap(blob)
      return {
        src: '',
        mode: 'canvas',
        width: bitmap.width,
        height: bitmap.height,
        bitmap,
      }
    } catch {
      URL.revokeObjectURL(blobUrl)
      throw new Error(t('import.err.csp'))
    }
  })()

  cache.set(dataUrl, task)
  return task
}

/** 从剪贴板/拖拽数据里挑出图片文件 */
export function pickImageFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  if (data.items?.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (!files.length) {
    for (const file of Array.from(data.files ?? [])) {
      if (file.type.startsWith('image/')) files.push(file)
    }
  }
  return files
}

export function drawBitmap(canvas: HTMLCanvasElement, bitmap: ImageBitmap): void {
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.drawImage(bitmap, 0, 0)
}
