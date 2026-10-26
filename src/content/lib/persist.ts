import type { MockupLayer, StoredLayer, StoredScene } from '@/shared/types'
import { getImageData, getScene, getSettings, saveScene, sceneKey, touchImage } from '@/shared/storage'
import { uid } from '@/shared/utils'
import { prepareImage, registerBitmap } from './image'
import { useSceneStore } from '../store'

const toStored = (layer: MockupLayer): StoredLayer => ({
  id: layer.id,
  imageId: layer.imageId,
  name: layer.name,
  naturalWidth: layer.naturalWidth,
  naturalHeight: layer.naturalHeight,
  x: Math.round(layer.x),
  y: Math.round(layer.y),
  width: Math.round(layer.width),
  height: Math.round(layer.height),
  opacity: layer.opacity,
  blend: layer.blend,
  visible: layer.visible,
  locked: layer.locked,
})

/** 读取当前 URL 的场景并还原图层 */
export async function restoreScene(): Promise<boolean> {
  const settings = await getSettings()
  useSceneStore.getState().setSnapEnabled(settings.snapEnabled)
  if (!settings.autoRestore) return false

  const scene = await getScene(sceneKey(location.href))
  if (!scene?.layers.length) return false

  const layers: MockupLayer[] = []
  for (const stored of scene.layers) {
    const dataUrl = await getImageData(stored.imageId)
    if (!dataUrl) continue
    try {
      const prepared = await prepareImage(dataUrl)
      const id = stored.id || uid()
      registerBitmap(id, prepared.bitmap)
      layers.push({
        ...stored,
        id,
        src: prepared.src,
        renderMode: prepared.mode,
        naturalWidth: prepared.width,
        naturalHeight: prepared.height,
        opacity: stored.opacity,
      })
      void touchImage(stored.imageId)
    } catch {
      /* 单张图片损坏不影响其他图层 */
    }
  }

  if (!layers.length) return false
  const selectedId =
    scene.selectedId && layers.some((layer) => layer.id === scene.selectedId)
      ? scene.selectedId
      : layers[layers.length - 1].id
  useSceneStore.getState().replaceAll(layers, selectedId)
  return true
}

export async function saveCurrentScene(): Promise<void> {
  const settings = await getSettings()
  const key = sceneKey(location.href)
  const { layers, selectedId } = useSceneStore.getState()
  if (!settings.autoRestore || !layers.length) {
    await saveScene(key, null)
    return
  }
  const scene: StoredScene = {
    updatedAt: Date.now(),
    selectedId,
    layers: layers.map(toStored),
  }
  await saveScene(key, scene)
}

/** 场景变化时防抖落盘，返回 flush & 取消订阅函数 */
export function attachPersistence(): () => Promise<void> {
  let timer: number | undefined
  const schedule = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      void saveCurrentScene()
    }, 400)
  }

  const unsubscribe = useSceneStore.subscribe((state, previous) => {
    if (state.layers !== previous.layers || state.selectedId !== previous.selectedId) schedule()
  })

  return async () => {
    unsubscribe()
    if (timer) window.clearTimeout(timer)
    await saveCurrentScene()
  }
}
