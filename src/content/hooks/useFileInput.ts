import { useEffect } from 'react'
import { isEditableTarget } from '@/shared/utils'
import { pickImageFiles } from '../lib/image'
import { importFiles } from '../lib/import'
import { useSceneStore } from '../store'

function hasImageItem(data: DataTransfer | null): boolean {
  if (!data) return false
  return Array.from(data.items ?? []).some(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  )
}

/** 拖拽插入 + 粘贴插入 */
export function useFileInput(setDropActive: (value: boolean) => void, shadowRoot: ShadowRoot | null) {
  useEffect(() => {
    let depth = 0

    const isTyping = () => {
      const active =
        (shadowRoot?.activeElement as HTMLElement | null) ??
        (document.activeElement as HTMLElement | null)
      return isEditableTarget(active)
    }

    const onDragEnter = (event: DragEvent) => {
      if (!hasImageItem(event.dataTransfer)) return
      event.preventDefault()
      depth += 1
      setDropActive(true)
    }

    const onDragOver = (event: DragEvent) => {
      if (!hasImageItem(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const onDragLeave = (event: DragEvent) => {
      if (!hasImageItem(event.dataTransfer)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDropActive(false)
    }

    const onDrop = (event: DragEvent) => {
      if (!hasImageItem(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      depth = 0
      setDropActive(false)
      const files = pickImageFiles(event.dataTransfer)
      if (files.length) void importFiles(files)
    }

    const onPaste = (event: ClipboardEvent) => {
      if (isTyping()) return
      const files = pickImageFiles(event.clipboardData)
      if (!files.length) return
      event.preventDefault()
      void importFiles(files)
    }

    document.addEventListener('dragenter', onDragEnter, true)
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('dragleave', onDragLeave, true)
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('paste', onPaste, true)

    return () => {
      document.removeEventListener('dragenter', onDragEnter, true)
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('dragleave', onDragLeave, true)
      document.removeEventListener('drop', onDrop, true)
      document.removeEventListener('paste', onPaste, true)
      useSceneStore.getState().setGuides({ x: [], y: [] })
    }
  }, [setDropActive, shadowRoot])
}
