import { useSceneStore } from '../store'
import { Icon } from '@/shared/Icon'
import { useT } from '@/shared/i18n'

export function GuideOverlay() {
  const guides = useSceneStore((state) => state.guides)
  if (!guides.x.length && !guides.y.length) return null
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  return (
    <>
      {guides.x.map((x) => (
        <div key={`x-${x}`} className="tp-guide tp-guide--x" style={{ left: Math.round(x - scrollX) }} />
      ))}
      {guides.y.map((y) => (
        <div key={`y-${y}`} className="tp-guide tp-guide--y" style={{ top: Math.round(y - scrollY) }} />
      ))}
    </>
  )
}

export function ToastView() {
  const toast = useSceneStore((state) => state.toast)
  if (!toast) return null
  return (
    <div className="tp-toast" data-tone={toast.tone} key={toast.id}>
      {toast.message}
    </div>
  )
}

export function EmptyState({ onPick }: { onPick: () => void }) {
  const t = useT()
  return (
    <div className="tp-empty">
      <div className="tp-empty__mark">
        <Icon name="target" size={20} />
      </div>
      <h4>{t('empty.title')}</h4>
      <p>
        {t('empty.desc1')}
        <br />
        {t('empty.desc2')}
      </p>
      <div className="tp-empty__actions">
        <button className="tp-primary" onClick={onPick}>
          {t('empty.pick')}
        </button>
      </div>
      <div className="tp-empty__hints">
        <kbd>⌘/Ctrl</kbd>
        <span>+</span>
        <kbd>V</kbd>
        <span>{t('empty.paste')}</span>
        <span className="tp-sep-dot">·</span>
        <kbd>?</kbd>
        <span>{t('empty.shortcuts')}</span>
      </div>
    </div>
  )
}

export function DropHint() {
  const t = useT()
  return (
    <div className="tp-drop">
      <div>{t('drop.hint')}</div>
    </div>
  )
}

export function MiniButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <button
      className="tp-mini"
      onClick={onClick}
      data-tip={t('toolbar.mini.tip')}
      aria-label={t('toolbar.mini.tip')}
    >
      <span className="tp-mini__mark">
        <Icon name="target" size={14} />
      </span>
      <span className="tp-mini__label">{t('toolbar.brand')}</span>
      <kbd>⇧F</kbd>
    </button>
  )
}
