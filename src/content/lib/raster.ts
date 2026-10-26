/**
 * 浏览器侧栅格工具：把 dataURL / blobURL 解成共享层用的 Raster，再把结果编码回 PNG。
 * 与 CLI 的 node/png.ts 对应，一个走 canvas，一个走 zlib。
 */

import { t } from '@/shared/i18n'
import type { Raster } from '@/shared/diff'
import { dataUrlToBlob } from './image'

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

/** 等两帧 + 一个短延迟，确保截图前浏览器已经把改动合成到画面 */
export async function settle(frames = 2, delay = 60): Promise<void> {
  for (let i = 0; i < frames; i += 1) await nextFrame()
  await new Promise((resolve) => window.setTimeout(resolve, delay))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(t('import.err.decode')))
    image.src = src
  })
}

async function drawToCanvas(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error(t('import.err.canvas'))
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** dataURL / blobURL → Raster（按原始像素，不缩放） */
export async function decodeRaster(src: string): Promise<Raster> {
  if (!src) throw new Error(t('import.err.src'))

  let bitmap: ImageBitmap | null = null
  try {
    // dataURL 不走 fetch：页面 connect-src 经常禁止 data:，直接手工转 Blob 更稳
    const blob = src.startsWith('data:') ? dataUrlToBlob(src) : await (await fetch(src)).blob()
    bitmap = await createImageBitmap(blob)
  } catch {
    bitmap = null
  }

  try {
    if (bitmap) {
      const data = await drawToCanvas(bitmap, bitmap.width, bitmap.height)
      return finishRaster(data)
    }
    const image = await loadImage(src)
    const data = await drawToCanvas(image, image.naturalWidth, image.naturalHeight)
    return finishRaster(data)
  } finally {
    bitmap?.close()
  }
}

function finishRaster(data: ImageData): Raster {
  let hasAlpha = false
  for (let i = 3; i < data.data.length; i += 4) {
    if (data.data[i] < 255) {
      hasAlpha = true
      break
    }
  }
  return { width: data.width, height: data.height, data: data.data, hasAlpha }
}

/** Raster → PNG dataURL，用于面板预览与导出 */
export function rasterToDataUrl(raster: Raster): string {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, raster.width)
  canvas.height = Math.max(1, raster.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0)
  return canvas.toDataURL('image/png')
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function downloadText(name: string, text: string, mime = 'text/plain'): void {
  downloadBlob(name, new Blob([text], { type: `${mime};charset=utf-8` }))
}

export function downloadDataUrl(name: string, dataUrl: string): void {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  downloadBlob(name, new Blob([bytes], { type: 'image/png' }))
}

/** 剪贴板写入：先走异步 API，被权限拦掉时退回选区复制 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let copied = false
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    }
    area.remove()
    return copied
  }
}
