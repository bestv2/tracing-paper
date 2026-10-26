import type { ImagePayload, MockupLayer } from '@/shared/types'
import { baseName, fileToDataUrl, loadImageSize, makeThumbnail, uid } from '@/shared/utils'
import { addImage, gcImages, getSettings, touchImage } from '@/shared/storage'
import { t } from '@/shared/i18n'
import { initialRect, useSceneStore } from '../store'
import { prepareImage, registerBitmap } from './image'

const ACCEPTED = /^image\/(png|jpe?g|webp|gif|avif|bmp|svg\+xml)$/

async function buildLayer(
  name: string,
  dataUrl: string,
  index: number,
): Promise<MockupLayer | null> {
  const store = useSceneStore.getState()
  try {
    const prepared = await prepareImage(dataUrl)
    const settings = await getSettings()
    const meta = await addImage(
      {
        name: baseName(name),
        dataUrl,
        width: prepared.width,
        height: prepared.height,
      },
      await makeThumbnail(prepared.src || dataUrl),
    )
    await touchImage(meta.id)
    await gcImages(settings.libraryLimit)
    const rect = initialRect(prepared.width, prepared.height, index * 28)
    const id = uid()
    registerBitmap(id, prepared.bitmap)
    return {
      id,
      imageId: meta.id,
      name: meta.name,
      src: prepared.src,
      renderMode: prepared.mode,
      naturalWidth: prepared.width,
      naturalHeight: prepared.height,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      opacity: settings.defaultOpacity,
      blend: 'normal',
      visible: true,
      locked: false,
    }
  } catch (error) {
    store.notify(error instanceof Error ? error.message : t('toast.importFailed'), 'warn')
    return null
  }
}

/** 文件/剪贴板图片 → 素材库 + 新图层，返回成功数量 */
export async function importFiles(files: File[]): Promise<number> {
  const usable = files.filter((file) => ACCEPTED.test(file.type))
  if (!usable.length) {
    useSceneStore.getState().notify(t('toast.importEmpty'), 'warn')
    return 0
  }

  const layers: MockupLayer[] = []
  for (let i = 0; i < usable.length; i += 1) {
    const file = usable[i]
    try {
      const dataUrl = await fileToDataUrl(file)
      const layer = await buildLayer(file.name, dataUrl, i)
      if (layer) layers.push(layer)
    } catch {
      useSceneStore.getState().notify(t('toast.importReadFail', { name: file.name }), 'warn')
    }
  }

  if (layers.length) {
    useSceneStore.getState().addLayers(layers)
    useSceneStore
      .getState()
      .notify(
        layers.length > 1
          ? t('toast.importInserted', { count: layers.length })
          : t('toast.importInsertedOne', { name: layers[0].name }),
      )
  }
  return layers.length
}

/** popup 上传的图片（已带尺寸） */
export async function importPayloads(payloads: ImagePayload[]): Promise<number> {
  const layers: MockupLayer[] = []
  for (let i = 0; i < payloads.length; i += 1) {
    const payload = payloads[i]
    try {
      const size =
        payload.width && payload.height
          ? { width: payload.width, height: payload.height }
          : await loadImageSize(payload.dataUrl)
      const prepared = await prepareImage(payload.dataUrl)
      const settings = await getSettings()
      const meta = await addImage(
        {
          name: baseName(payload.name),
          dataUrl: payload.dataUrl,
          width: size.width,
          height: size.height,
        },
        await makeThumbnail(prepared.src || payload.dataUrl),
      )
      const rect = initialRect(prepared.width, prepared.height, i * 28)
      const id = uid()
      registerBitmap(id, prepared.bitmap)
      await gcImages(settings.libraryLimit)
      layers.push({
        id,
        imageId: meta.id,
        name: meta.name,
        src: prepared.src,
        renderMode: prepared.mode,
        naturalWidth: prepared.width,
        naturalHeight: prepared.height,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        opacity: settings.defaultOpacity,
        blend: 'normal',
        visible: true,
        locked: false,
      })
    } catch {
      useSceneStore.getState().notify(t('toast.importReadFail', { name: payload.name }), 'warn')
    }
  }

  if (layers.length) {
    useSceneStore.getState().addLayers(layers)
    useSceneStore.getState().notify(t('toast.importInserted', { count: layers.length }))
  }
  return layers.length
}
