import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useSceneStore, type PanelKind } from '../store'
import { runDiffFlow } from '../lib/diff'
import { runAutoFitFlow } from '../lib/autofit'
import { Icon } from '@/shared/Icon'
import { useT } from '@/shared/i18n'
import { Popover } from './Popover'
import {
  BlendPanel,
  FitPanel,
  LayersPanel,
  MorePanel,
  ShortcutsPanel,
  SizePanel,
} from './Panels'

interface ToolbarProps {
  /** 收起成迷你入口，随时可再展开 */
  onCollapse: () => void
  /** 真正卸载浮层，只从「更多」里触发 */
  onClose: () => void
  onPickImage: () => void
}

const IS_MAC = /mac/i.test(navigator.platform || navigator.userAgent)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

export function Toolbar({ onCollapse, onClose, onPickImage }: ToolbarProps) {
  const t = useT()
  const layers = useSceneStore((state) => state.layers)
  const selected = useSceneStore((state) => {
    const layer = state.layers.find((item) => item.id === state.selectedId)
    return layer ?? null
  })
  const selectedId = useSceneStore((state) => state.selectedId)
  const frozen = useSceneStore((state) => state.frozen)
  const snapEnabled = useSceneStore((state) => state.snapEnabled)
  const setSnapEnabled = useSceneStore((state) => state.setSnapEnabled)
  const canUndo = useSceneStore((state) => state.canUndo)
  const canRedo = useSceneStore((state) => state.canRedo)
  const patchLayer = useSceneStore((state) => state.patchLayer)
  const pushHistory = useSceneStore((state) => state.pushHistory)
  const undo = useSceneStore((state) => state.undo)
  const redo = useSceneStore((state) => state.redo)
  const setFrozen = useSceneStore((state) => state.setFrozen)
  const notify = useSceneStore((state) => state.notify)
  const diff = useSceneStore((state) => state.diff)
  const diffBusy = useSceneStore((state) => state.diffBusy)
  const fitBusy = useSceneStore((state) => state.fitBusy)

  const panel = useSceneStore((state) => state.panel)
  const setPanel = useSceneStore((state) => state.setPanel)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const blendRef = useRef<HTMLButtonElement>(null)
  const fitRef = useRef<HTMLButtonElement>(null)
  const sizeRef = useRef<HTMLButtonElement>(null)
  const layersRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)

  const percent = Math.round((selected?.opacity ?? 1) * 100)
  const blendLabel = t(`blend.${selected?.blend ?? 'normal'}`)

  const startDragToolbar = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const origin = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
    const onMove = (moveEvent: PointerEvent) => {
      setOffset({
        x: origin.ox + (moveEvent.clientX - origin.x),
        y: Math.max(
          -window.innerHeight + 120,
          Math.min(40, origin.oy + (moveEvent.clientY - origin.y)),
        ),
      })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const togglePanel = (kind: PanelKind) => setPanel(panel === kind ? null : kind)

  return (
    <>
      <div
        className="tp-toolbar"
        style={{ transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)` }}
      >
        <div
          className="tp-brand"
          onPointerDown={startDragToolbar}
          data-tip={t('toolbar.drag')}
          aria-label={t('toolbar.brand')}
          role="button"
        >
          <Icon name="target" size={15} />
        </div>

        <span className="tp-sep" />

        <div className="tp-group">
          <button
            className="tp-btn"
            onClick={onPickImage}
            data-tip={t('toolbar.insert.tip')}
            aria-label={t('toolbar.insert.tip')}
          >
            <Icon name="image" size={15} />
          </button>
          <button
            ref={layersRef}
            className="tp-btn"
            data-active={panel === 'layers'}
            onClick={() => togglePanel('layers')}
            data-tip={t('toolbar.layers.tip')}
            aria-label={t('toolbar.layers.tip')}
          >
            <Icon name="layers" size={15} />
            <span className="tp-count">{layers.length}</span>
          </button>
        </div>

        <span className="tp-sep" />

        <div className="tp-opacity">
          <input
            className="tp-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            disabled={!selected}
            aria-label={t('toolbar.opacity')}
            data-tip={t('toolbar.opacity.tip')}
            style={{ '--tp-fill': `${percent}%` } as React.CSSProperties}
            onPointerDown={() => pushHistory()}
            onChange={(event) => {
              if (!selected) return
              patchLayer(selected.id, { opacity: Number(event.target.value) / 100 })
            }}
          />
          <span className="tp-btn__value">{percent}%</span>
        </div>

        <div className="tp-group">
          <button
            ref={blendRef}
            className="tp-btn"
            data-active={panel === 'blend'}
            disabled={!selected}
            onClick={() => togglePanel('blend')}
            data-tip={t('toolbar.blend')}
          >
            {blendLabel}
            <Icon name="chevron-down" size={11} />
          </button>

          <button
            ref={fitRef}
            className="tp-btn"
            data-active={panel === 'fit'}
            disabled={!selected}
            onClick={() => togglePanel('fit')}
            data-tip={t('toolbar.fit.tip')}
          >
            {t('toolbar.fit')}
            <Icon name="chevron-down" size={11} />
          </button>

          <button
            ref={sizeRef}
            className="tp-btn tp-btn--icon"
            data-active={panel === 'size'}
            disabled={!selected}
            onClick={() => togglePanel('size')}
            data-tip={t('toolbar.size.tip')}
            aria-label={t('toolbar.size.tip')}
          >
            <Icon name="size" size={15} />
          </button>
        </div>

        <span className="tp-sep" />

        <button
          className="tp-btn tp-btn--icon"
          disabled={!layers.length || fitBusy}
          onClick={() => void runAutoFitFlow({ layerId: selected?.id })}
          data-tip={t('toolbar.autofit.tip')}
          aria-label={t('toolbar.autofit.tip')}
        >
          <Icon name="wand" size={15} className={fitBusy ? 'tp-spin' : undefined} />
        </button>

        <button
          className="tp-btn tp-btn--diff"
          data-active={panel === 'diff'}
          disabled={!layers.length || diffBusy}
          onClick={() => void runDiffFlow({ layerId: selected?.id })}
          data-tip={t('toolbar.diff.tip')}
        >
          <Icon name="diff" size={14} />
          {diff && diff.report.summary.findings ? (
            <span className="tp-count">{diff.report.summary.findings}</span>
          ) : null}
        </button>

        <span className="tp-sep" />

        <div className="tp-group">
          <button
            className="tp-btn tp-btn--icon"
            data-active={snapEnabled}
            onClick={() => setSnapEnabled(!snapEnabled)}
            data-tip={snapEnabled ? t('toolbar.snap.on') : t('toolbar.snap.off')}
            aria-label={t('toolbar.snap.off')}
          >
            <Icon name="magnet" size={15} />
          </button>

          <button
            className="tp-btn tp-btn--icon"
            data-active={frozen}
            onClick={() => {
              const next = !frozen
              setFrozen(next)
              notify(next ? t('toast.frozen') : t('toast.thawed'))
            }}
            data-tip={frozen ? t('toolbar.unfreeze') : t('toolbar.freeze')}
            aria-label={t('toolbar.freeze')}
          >
            <Icon name={frozen ? 'lock' : 'unlock'} size={15} />
          </button>

          <button
            className="tp-btn tp-btn--icon"
            data-active={!!selected && !selected.visible}
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              patchLayer(selected.id, { visible: !selected.visible }, true)
            }}
            data-tip={t('toolbar.visible.tip')}
            aria-label={t('toolbar.visible.tip')}
          >
            <Icon name={selected && !selected.visible ? 'eye-off' : 'eye'} size={15} />
          </button>

          <button
            className="tp-btn tp-btn--icon"
            disabled={!canUndo}
            onClick={undo}
            data-tip={t('toolbar.undo.tip', { keys: `${MOD}Z` })}
            aria-label={t('toolbar.undo.tip', { keys: `${MOD}Z` })}
          >
            <Icon name="undo" size={15} />
          </button>
          <button
            className="tp-btn tp-btn--icon"
            disabled={!canRedo}
            onClick={redo}
            data-tip={t('toolbar.redo.tip', { keys: IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z' })}
            aria-label={t('toolbar.redo.tip', { keys: IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z' })}
          >
            <Icon name="redo" size={15} />
          </button>
        </div>

        <span className="tp-sep" />

        <div className="tp-group">
          <button
            ref={moreRef}
            className="tp-btn tp-btn--icon"
            data-active={panel === 'more' || panel === 'help'}
            onClick={() => togglePanel('more')}
            data-tip={t('toolbar.more.tip')}
            aria-label={t('toolbar.more.tip')}
          >
            <Icon name="more" size={15} />
          </button>
          <button
            className="tp-btn tp-btn--icon"
            onClick={onCollapse}
            data-tip={t('toolbar.collapse.tip')}
            aria-label={t('toolbar.collapse.tip')}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>

      {panel === 'blend' && selected && blendRef.current ? (
        <Popover anchorRef={blendRef} onClose={() => setPanel(null)} width={252}>
          <BlendPanel
            current={selected.blend}
            onPick={(blend) => {
              patchLayer(selected.id, { blend }, true)
              setPanel(null)
            }}
          />
        </Popover>
      ) : null}

      {panel === 'fit' && selected && fitRef.current ? (
        <Popover anchorRef={fitRef} onClose={() => setPanel(null)} width={250}>
          <FitPanel layer={selected} />
        </Popover>
      ) : null}

      {panel === 'size' && selected && sizeRef.current ? (
        <Popover anchorRef={sizeRef} onClose={() => setPanel(null)} width={268}>
          <SizePanel layer={selected} />
        </Popover>
      ) : null}

      {panel === 'layers' && layersRef.current ? (
        <Popover anchorRef={layersRef} onClose={() => setPanel(null)} width={300}>
          <LayersPanel />
        </Popover>
      ) : null}

      {panel === 'more' && moreRef.current ? (
        <Popover anchorRef={moreRef} onClose={() => setPanel(null)} width={252}>
          <MorePanel onOpenShortcuts={() => setPanel('help')} onClose={onClose} />
        </Popover>
      ) : null}

      {panel === 'help' && moreRef.current ? (
        <Popover anchorRef={moreRef} onClose={() => setPanel(null)} width={310}>
          <ShortcutsPanel />
        </Popover>
      ) : null}

      {layers.length > 0 && !selectedId ? (
        <div className="tp-hint-float">{t('toolbar.noSelection')}</div>
      ) : null}
    </>
  )
}
