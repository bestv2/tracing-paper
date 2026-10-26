import { useState } from 'react'
import { BLEND_MODES, type BlendMode, type MockupLayer } from '@/shared/types'
import { useSceneStore } from '../store'
import { applyFit, flashCompare, type FitKind } from '../lib/actions'
import { runAutoFitFlow } from '../lib/autofit'
import { Icon } from '@/shared/Icon'
import { useT, type StringKey } from '@/shared/i18n'
import { usePrefs } from '@/shared/prefs'
import { NumberField } from './NumberField'

const FIT_OPTIONS: { kind: FitKind; label: StringKey; hint: string }[] = [
  { kind: 'reset', label: 'fit.reset', hint: 'Alt 0' },
  { kind: 'natural', label: 'fit.natural', hint: 'Alt 1' },
  { kind: 'double', label: 'fit.double', hint: 'Alt 2' },
  { kind: 'half', label: 'fit.half', hint: 'Alt 3' },
  { kind: 'window', label: 'fit.window', hint: 'Alt 4' },
  { kind: 'center', label: 'fit.center', hint: 'Alt 5' },
]

const THEMES = [
  { value: 'light', label: 'toolbar.more.theme.light' },
  { value: 'dark', label: 'toolbar.more.theme.dark' },
] as const

export function BlendPanel({
  current,
  onPick,
}: {
  current: BlendMode
  onPick: (mode: BlendMode) => void
}) {
  const t = useT()
  return (
    <>
      <div className="tp-popover__title">
        <b>{t('blend.title')}</b>
        <span className="tp-hint">{t('blend.hint')}</span>
      </div>
      <div className="tp-blend-grid">
        {BLEND_MODES.map((mode) => (
          <button
            key={mode.value}
            className="tp-option"
            data-active={mode.value === current}
            onClick={() => onPick(mode.value)}
          >
            {t(`blend.${mode.value}`)}
            {mode.value === current ? <Icon name="check" size={12} /> : null}
          </button>
        ))}
      </div>
    </>
  )
}

export function FitPanel({ layer }: { layer: MockupLayer }) {
  const t = useT()
  const busy = useSceneStore((state) => state.fitBusy)
  return (
    <>
      <div className="tp-popover__title">
        <b>{t('fit.title')}</b>
        <span className="tp-hint">{t('fit.hint')}</span>
      </div>
      <div className="tp-popover__list">
        <button
          className="tp-option tp-option--accent"
          disabled={busy}
          onClick={() => void runAutoFitFlow({ layerId: layer.id })}
        >
          <Icon name="wand" size={13} className={busy ? 'tp-spin' : undefined} />
          {busy ? t('fit.auto.busy') : t('fit.auto')}
          <small>{t('fit.auto.hint')}</small>
        </button>
        <span className="tp-option__sep" />
        {FIT_OPTIONS.map((option) => (
          <button
            key={option.kind}
            className="tp-option"
            onClick={() => applyFit(option.kind, layer)}
          >
            {t(option.label)}
            <small>{option.hint}</small>
          </button>
        ))}
      </div>
    </>
  )
}

export function SizePanel({ layer }: { layer: MockupLayer }) {
  const t = useT()
  const patchLayer = useSceneStore((state) => state.patchLayer)
  const pushHistory = useSceneStore((state) => state.pushHistory)
  const [lockAspect, setLockAspect] = useState(false)
  const ratio = layer.naturalWidth / Math.max(1, layer.naturalHeight)

  const update = (patch: Partial<MockupLayer>) => {
    if (!lockAspect) {
      patchLayer(layer.id, patch)
      return
    }
    const next = { ...patch }
    if (typeof patch.width === 'number') next.height = Math.round(patch.width / ratio)
    if (typeof patch.height === 'number') next.width = Math.round(patch.height * ratio)
    patchLayer(layer.id, next)
  }

  return (
    <>
      <div className="tp-popover__title">
        <b>{t('size.title')}</b>
        <button
          className="tp-chip"
          data-active={lockAspect}
          onClick={() => setLockAspect((value) => !value)}
          data-tip={t('size.lock.tip')}
        >
          <Icon name="lock" size={10} /> {t('size.lock')}
        </button>
      </div>
      <div className="tp-size-grid">
        <NumberField
          label="W"
          value={layer.width}
          min={24}
          onChange={(width) => update({ width })}
          onGestureStart={pushHistory}
        />
        <NumberField
          label="H"
          value={layer.height}
          min={24}
          onChange={(height) => update({ height })}
          onGestureStart={pushHistory}
        />
        <NumberField
          label="X"
          value={layer.x}
          onChange={(x) => patchLayer(layer.id, { x })}
          onGestureStart={pushHistory}
        />
        <NumberField
          label="Y"
          value={layer.y}
          onChange={(y) => patchLayer(layer.id, { y })}
          onGestureStart={pushHistory}
        />
      </div>
      <div className="tp-mini-actions">
        <button className="tp-chip" onClick={() => applyFit('window', layer)}>
          {t('size.fill')}
        </button>
        <button className="tp-chip" onClick={() => applyFit('center', layer)}>
          {t('size.center')}
        </button>
        <button className="tp-chip" onClick={() => applyFit('natural', layer)}>
          {t('size.natural')}
        </button>
        <button
          className="tp-chip"
          onClick={() => flashCompare(layer.id)}
          data-tip={t('size.flash.tip')}
        >
          <Icon name="compare" size={11} /> {t('size.flash')}
        </button>
      </div>
    </>
  )
}

export function LayersPanel() {
  const t = useT()
  const layers = useSceneStore((state) => state.layers)
  const selectedId = useSceneStore((state) => state.selectedId)
  const select = useSceneStore((state) => state.select)
  const patchLayer = useSceneStore((state) => state.patchLayer)
  const removeLayer = useSceneStore((state) => state.removeLayer)
  const duplicateLayer = useSceneStore((state) => state.duplicateLayer)
  const moveLayerOrder = useSceneStore((state) => state.moveLayerOrder)

  return (
    <>
      <div className="tp-popover__title">
        <b>{t('layers.title', { count: layers.length })}</b>
        <span className="tp-hint">{t('layers.hint')}</span>
      </div>
      <div className="tp-popover__list">
        {[...layers].reverse().map((layer) => (
          <div
            key={layer.id}
            className="tp-layer-row"
            data-active={layer.id === selectedId}
            onClick={() => select(layer.id)}
          >
            <div className="tp-thumb">
              {layer.renderMode === 'img' ? <img src={layer.src} alt="" /> : null}
            </div>
            <div className="tp-layer-meta">
              <b>{layer.name}</b>
              <span>
                {layer.width}×{layer.height} · {Math.round(layer.opacity * 100)}%
              </span>
            </div>
            <div className="tp-row-actions">
              <button
                className="tp-icon-btn"
                data-on={!layer.visible}
                data-tip={layer.visible ? t('layers.hide') : t('layers.show')}
                onClick={(event) => {
                  event.stopPropagation()
                  patchLayer(layer.id, { visible: !layer.visible }, true)
                }}
              >
                <Icon name={layer.visible ? 'eye' : 'eye-off'} size={13} />
              </button>
              <button
                className="tp-icon-btn"
                data-on={layer.locked}
                data-tip={layer.locked ? t('layers.unlock') : t('layers.lock')}
                onClick={(event) => {
                  event.stopPropagation()
                  patchLayer(layer.id, { locked: !layer.locked })
                }}
              >
                <Icon name={layer.locked ? 'lock' : 'unlock'} size={13} />
              </button>
              <button
                className="tp-icon-btn"
                data-tip={t('layers.up')}
                onClick={(event) => {
                  event.stopPropagation()
                  moveLayerOrder(layer.id, 1)
                }}
              >
                <Icon name="chevron-up" size={13} />
              </button>
              <button
                className="tp-icon-btn"
                data-tip={t('layers.down')}
                onClick={(event) => {
                  event.stopPropagation()
                  moveLayerOrder(layer.id, -1)
                }}
              >
                <Icon name="chevron-down" size={13} />
              </button>
              <button
                className="tp-icon-btn"
                data-tip={t('layers.copy')}
                onClick={(event) => {
                  event.stopPropagation()
                  duplicateLayer(layer.id)
                }}
              >
                <Icon name="copy" size={13} />
              </button>
              <button
                className="tp-icon-btn tp-icon-btn--danger"
                data-tip={t('layers.delete')}
                onClick={(event) => {
                  event.stopPropagation()
                  removeLayer(layer.id)
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

const IS_MAC = /mac/i.test(navigator.platform || navigator.userAgent)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

const SHORTCUTS: { keys: string[]; label: StringKey }[] = [
  { keys: [MOD, 'V'], label: 'shortcut.paste' },
  { keys: ['Drop'], label: 'shortcut.drop' },
  { keys: ['←↑→↓'], label: 'shortcut.move' },
  { keys: ['[', ']'], label: 'shortcut.opacity' },
  { keys: ['0-9'], label: 'shortcut.digit' },
  { keys: ['H'], label: 'shortcut.toggleVisible' },
  { keys: ['L'], label: 'shortcut.toggleLock' },
  { keys: ['F'], label: 'shortcut.freeze' },
  { keys: ['S'], label: 'shortcut.snap' },
  { keys: ['D'], label: 'shortcut.diff' },
  { keys: ['A'], label: 'shortcut.autofit' },
  { keys: [MOD, 'Z'], label: 'shortcut.undo' },
  { keys: [MOD, 'D'], label: 'shortcut.duplicate' },
  { keys: ['Delete'], label: 'shortcut.delete' },
  { keys: ['Alt', '1/2/3'], label: 'shortcut.scale' },
  { keys: ['Alt', '4'], label: 'shortcut.window' },
  { keys: ['Alt', '0'], label: 'shortcut.reset' },
  { keys: ['Alt', 'Wheel'], label: 'shortcut.wheel' },
  { keys: ['Esc'], label: 'shortcut.escape' },
  { keys: ['⇧', 'F'], label: 'shortcut.collapse' },
]

export function ShortcutsPanel() {
  const t = useT()
  return (
    <>
      <div className="tp-popover__title">
        <b>{t('help.title')}</b>
        <span className="tp-hint">{t('help.hint')}</span>
      </div>
      <div className="tp-shortcuts">
        {SHORTCUTS.map((item) => (
          <div key={item.label} className="tp-shortcut">
            <b>{t(item.label)}</b>
            <span>
              {item.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

export function MorePanel({
  onOpenShortcuts,
  onClose,
}: {
  onOpenShortcuts: () => void
  onClose: () => void
}) {
  const t = useT()
  const theme = usePrefs((state) => state.theme)
  const setTheme = usePrefs((state) => state.setTheme)
  const locale = usePrefs((state) => state.locale)
  const setLocale = usePrefs((state) => state.setLocale)

  return (
    <>
      <div className="tp-popover__title">
        <b>{t('toolbar.more.title')}</b>
      </div>

      <div className="tp-setting">
        <span className="tp-setting__label">{t('toolbar.more.theme')}</span>
        <div className="tp-segment">
          {THEMES.map((item) => (
            <button
              key={item.value}
              className="tp-chip"
              data-active={theme === item.value}
              onClick={() => setTheme(item.value)}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="tp-setting">
        <span className="tp-setting__label">{t('toolbar.more.locale')}</span>
        <div className="tp-segment">
          <button className="tp-chip" data-active={locale === 'zh'} onClick={() => setLocale('zh')}>
            中文
          </button>
          <button className="tp-chip" data-active={locale === 'en'} onClick={() => setLocale('en')}>
            English
          </button>
        </div>
      </div>

      <button className="tp-option tp-option--link" onClick={onOpenShortcuts}>
        <Icon name="help" size={13} />
        {t('toolbar.more.shortcuts')}
        <small>{t('toolbar.more.shortcuts.hint')}</small>
      </button>

      <button className="tp-option tp-option--danger" onClick={onClose}>
        <Icon name="close" size={13} />
        {t('toolbar.more.close')}
        <small>{t('toolbar.more.close.hint')}</small>
      </button>
    </>
  )
}
