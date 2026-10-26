import { useRef, useState } from 'react'
import { useSceneStore } from './store'
import { usePrefs } from '@/shared/prefs'
import { useT } from '@/shared/i18n'
import { LayerView } from './components/LayerView'
import { Toolbar } from './components/Toolbar'
import { DropHint, EmptyState, GuideOverlay, MiniButton, ToastView } from './components/Overlays'
import { DiffMarkers, DiffPanel } from './components/DiffPanel'
import { TooltipLayer } from './components/Tooltip'
import { useShortcuts } from './hooks/useShortcuts'
import { useFileInput } from './hooks/useFileInput'
import { importFiles } from './lib/import'

interface AppProps {
  onClose: () => void
  shadowRoot: ShadowRoot | null
}

const Z_BASE = 2147483000

export function App({ onClose, shadowRoot }: AppProps) {
  const t = useT()
  const layers = useSceneStore((state) => state.layers)
  const selectedId = useSceneStore((state) => state.selectedId)
  const frozen = useSceneStore((state) => state.frozen)
  const snapEnabled = useSceneStore((state) => state.snapEnabled)
  const toolbarVisible = useSceneStore((state) => state.toolbarVisible)
  const setToolbarVisible = useSceneStore((state) => state.setToolbarVisible)
  const panel = useSceneStore((state) => state.panel)
  const theme = usePrefs((state) => state.theme)
  const [dropActive, setDropActive] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useShortcuts(shadowRoot)
  useFileInput(setDropActive, shadowRoot)

  const pickImage = () => fileRef.current?.click()

  // X 只是收起：浮层和图层都留着，右下角迷你入口 / ⇧F 可以再打开
  const collapseToolbar = () => {
    useSceneStore.getState().collapseToolbar()
    useSceneStore.getState().notify(t('toolbar.collapsed'))
  }

  return (
    <div
      className="tp-root"
      data-theme={theme}
      onKeyDownCapture={(event) => event.stopPropagation()}
      onKeyUpCapture={(event) => event.stopPropagation()}
    >
      {layers.map((layer, index) => (
        <LayerView
          key={layer.id}
          layer={layer}
          zIndex={Z_BASE + index}
          selected={layer.id === selectedId}
          frozen={frozen}
          snapEnabled={snapEnabled}
          layers={layers}
        />
      ))}

      <GuideOverlay />
      <DiffMarkers />

      {layers.length === 0 ? <EmptyState onPick={pickImage} /> : null}

      {toolbarVisible ? (
        <Toolbar onCollapse={collapseToolbar} onClose={onClose} onPickImage={pickImage} />
      ) : (
        <MiniButton onClick={() => setToolbarVisible(true)} />
      )}

      {panel === 'diff' ? <DiffPanel /> : null}

      <ToastView />
      {dropActive ? <DropHint /> : null}
      <TooltipLayer root={shadowRoot} />

      <input
        ref={fileRef}
        className="tp-file-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length) void importFiles(files)
        }}
      />
    </div>
  )
}
