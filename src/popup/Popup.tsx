import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '@/shared/Icon'
import { DEFAULT_SETTINGS, type ImagePayload, type Settings, type TabState } from '@/shared/types'
import {
  addImage,
  deleteImage,
  getImageData,
  getSettings,
  listImages,
  saveSettings,
  type ImageMeta,
} from '@/shared/storage'
import { sendToTab } from '@/shared/messaging'
import { useT } from '@/shared/i18n'
import { usePrefs } from '@/shared/prefs'
import { ensureSiteAccess } from '@/shared/hostaccess'
import { baseName, fileToDataUrl, formatBytes, loadImageSize, makeThumbnail } from '@/shared/utils'
import './popup.css'

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

/** chrome:// 等特权页面无法注入脚本 */
const isInjectableUrl = (url: string) => /^https?:/i.test(url)

/** 优先取当前窗口的活动页；活动页不可注入时（扩展页/设置页）退回到最近访问的网页 */
async function resolveTargetTab(): Promise<chrome.tabs.Tab | undefined> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (active?.id && isInjectableUrl(active.url ?? '')) return active
  const tabs = await chrome.tabs.query({ currentWindow: true })
  return tabs
    .filter((tab) => tab.id !== undefined && isInjectableUrl(tab.url ?? ''))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]
}

interface Notice {
  text: string
  tone: 'ok' | 'warn'
}

export function Popup() {
  const t = useT()
  const locale = usePrefs((state) => state.locale)
  const setLocale = usePrefs((state) => state.setLocale)
  const [tabId, setTabId] = useState<number | null>(null)
  const [tabTitle, setTabTitle] = useState('')
  const [state, setState] = useState<TabState | null>(null)
  const [supported, setSupported] = useState(true)
  const [images, setImages] = useState<ImageMeta[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [opacity, setOpacity] = useState(100)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const noticeTimer = useRef<number>()
  const tabUrlRef = useRef('')

  const version = chrome.runtime.getManifest().version

  const showNotice = useCallback((text: string, tone: Notice['tone'] = 'ok') => {
    setNotice({ text, tone })
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2600)
  }, [])

  const refreshState = useCallback(async (id: number) => {
    const response = await sendToTab<TabState | null>(id, { type: 'TP_GET_STATE' })
    if (!response.ok) {
      // 安装/更新扩展前就打开的页面没有 content script，但 overlay 仍可按需注入
      setSupported(isInjectableUrl(tabUrlRef.current))
      setState(null)
      return false
    }
    setSupported(true)
    if (response.data?.active) {
      setState(response.data)
      setOpacity(Math.round(response.data.opacity * 100))
      return true
    }
    setState(null)
    return false
  }, [])

  const refreshLibrary = useCallback(async () => {
    setImages(await listImages())
  }, [])

  useEffect(() => {
    void (async () => {
      const tab = await resolveTargetTab()
      if (tab?.id) {
        tabUrlRef.current = tab.url ?? ''
        setTabId(tab.id)
        setTabTitle(tab.title ?? '')
        await refreshState(tab.id)
      } else {
        setSupported(false)
      }
      setSettings(await getSettings())
      await refreshLibrary()
    })()
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    }
  }, [refreshLibrary, refreshState])

  /** 确保当前页已经注入走查 UI */
  const ensureInjected = async (): Promise<boolean> => {
    if (!tabId) {
      showNotice(t('popup.notice.noTab'), 'warn')
      return false
    }
    if (state?.active) return true
    if (!(await ensureSiteAccess())) {
      showNotice(t('popup.notice.needAccess'), 'warn')
      return false
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] })
      await wait(150)
      await refreshState(tabId)
      return true
    } catch {
      showNotice(t('popup.notice.unsupported'), 'warn')
      return false
    }
  }

  const toggleTool = async () => {
    if (!tabId || busy) return
    setBusy(true)
    try {
      if (state?.active) {
        await sendToTab(tabId, { type: 'TP_CLOSE' })
        await refreshState(tabId)
        showNotice(t('popup.notice.closed'))
      } else if (await ensureInjected()) {
        showNotice(t('popup.notice.opened'))
      }
    } finally {
      setBusy(false)
    }
  }

  const insertPayloads = async (payloads: ImagePayload[]) => {
    if (!payloads.length || !tabId) return
    if (!(await ensureInjected())) return
    const result = await sendToTab<{ count: number }>(tabId, {
      type: 'TP_ADD_IMAGES',
      images: payloads,
    })
    if (result.ok) {
      showNotice(t('popup.notice.inserted', { count: payloads.length }))
      await refreshState(tabId)
      await refreshLibrary()
    } else {
      showNotice(result.error ?? t('toast.insertFailed'), 'warn')
    }
  }

  const handleFiles = async (files: File[]) => {
    const usable = files.filter((file) => file.type.startsWith('image/'))
    if (!usable.length) {
      showNotice(t('popup.notice.pickImage'), 'warn')
      return
    }
    setBusy(true)
    try {
      const payloads: ImagePayload[] = []
      for (const file of usable) {
        try {
          const dataUrl = await fileToDataUrl(file)
          const size = await loadImageSize(dataUrl)
          await addImage(
            {
              name: baseName(file.name),
              dataUrl,
              width: size.width,
              height: size.height,
            },
            await makeThumbnail(dataUrl),
          )
          payloads.push({ name: file.name, dataUrl, width: size.width, height: size.height })
        } catch {
          showNotice(t('popup.notice.readFail', { name: file.name }), 'warn')
        }
      }
      await insertPayloads(payloads)
    } finally {
      setBusy(false)
    }
  }

  const insertFromLibrary = async (meta: ImageMeta) => {
    if (busy) return
    setBusy(true)
    try {
      const dataUrl = await getImageData(meta.id)
      if (!dataUrl) {
        showNotice(t('popup.notice.stale'), 'warn')
        return
      }
      await insertPayloads([
        { name: meta.name, dataUrl, width: meta.width, height: meta.height },
      ])
    } finally {
      setBusy(false)
    }
  }

  const removeFromLibrary = async (meta: ImageMeta) => {
    await deleteImage(meta.id)
    await refreshLibrary()
    showNotice(t('popup.notice.deleted', { name: meta.name }))
  }

  const updateOpacity = async (value: number) => {
    setOpacity(value)
    if (!tabId || !state?.active) return
    const response = await sendToTab(tabId, { type: 'TP_SET_OPACITY', value: value / 100 })
    if (!response.ok) showNotice(response.error ?? t('popup.notice.opacityFail'), 'warn')
  }

  const toggleAutoRestore = async () => {
    const next = await saveSettings({ autoRestore: !settings.autoRestore })
    setSettings(next)
    showNotice(next.autoRestore ? t('popup.notice.restoreOn') : t('popup.notice.restoreOff'))
  }

  const clearCurrentPage = async () => {
    if (!tabId || !state?.active) return
    await sendToTab(tabId, { type: 'TP_CLEAR' })
    await refreshState(tabId)
    showNotice(t('popup.notice.cleared'))
  }

  const openHelp = async () => {
    if (!tabId) return
    if (!(await ensureInjected())) return
    await sendToTab(tabId, { type: 'TP_OPEN_HELP' })
    window.close()
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith('image/'),
      )
      if (!files.length) return
      event.preventDefault()
      void handleFiles(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  const active = !!state?.active
  const hasLayers = (state?.layerCount ?? 0) > 0

  return (
    <div className="app">
      <header className="header">
        <div className="mark">
          <Icon name="target" size={17} />
        </div>
        <div className="brand">
          <h1>描图纸 <span className="brand-en">Tracing Paper</span></h1>
          <p>{t('popup.brand.sub')}</p>
        </div>
        <span className="version">v{version}</span>
      </header>

      <div className="status">
        <span className="dot" data-on={active} />
        <div className="status-text">
          <b>{active ? t('popup.status.on') : t('popup.status.off')}</b>
          <span>
            {!supported
              ? t('popup.status.unsupported')
              : active
                ? t('popup.status.layers', {
                    count: state?.layerCount ?? 0,
                    title: tabTitle || t('popup.status.currentTab'),
                  })
                : t('popup.status.hint')}
          </span>
        </div>
        <button className="toggle" data-on={active} disabled={!supported || busy} onClick={toggleTool}>
          {busy ? t('popup.toggle.busy') : active ? t('popup.toggle.on') : t('popup.toggle.off')}
        </button>
      </div>

      {notice ? (
        <div className="notice" data-tone={notice.tone}>
          {notice.text}
        </div>
      ) : null}

      <div className="scroll">
        <button
          className="uploader"
          data-drag={dragging}
          disabled={!supported || busy}
          onClick={() => fileRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void handleFiles(Array.from(event.dataTransfer.files))
          }}
        >
          <span className="uploader__icon">
            <Icon name="image" size={17} />
          </span>
          <span>
            <b>{t('popup.upload.title')}</b>
            <span>{t('popup.upload.sub')}</span>
          </span>
        </button>
        <input
          ref={fileRef}
          className="input-file"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            void handleFiles(files)
          }}
        />

        <section className="section">
          <div className="section-head">
            <b>{t('popup.section.opacity')}</b>
            {hasLayers ? <button onClick={clearCurrentPage}>{t('popup.clear')}</button> : null}
          </div>
          <div className="opacity">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={opacity}
              disabled={!hasLayers}
              style={{ '--fill': `${opacity}%` } as CSSProperties}
              onChange={(event) => void updateOpacity(Number(event.target.value))}
            />
            <output>{opacity}%</output>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <b>{t('popup.section.library', { count: images.length })}</b>
            <span className="section-note">
              {images.length
                ? t('popup.library.size', {
                    size: formatBytes(images.reduce((sum, item) => sum + item.bytes, 0)),
                  })
                : ''}
            </span>
          </div>
          <div className="library">
            {images.length === 0 ? (
              <div className="empty-library">
                {t('popup.library.empty1')}
                <br />
                {t('popup.library.empty2')}
              </div>
            ) : (
              images.map((meta) => (
                <div
                  key={meta.id}
                  className="shot"
                  role="button"
                  tabIndex={0}
                  title={`${meta.name} · ${meta.width}×${meta.height}`}
                  onClick={() => void insertFromLibrary(meta)}
                >
                  {meta.thumb ? (
                    <img src={meta.thumb} alt={meta.name} />
                  ) : (
                    <span className="shot__fallback">{meta.name.slice(0, 2)}</span>
                  )}
                  <span className="shot__meta">{meta.name}</span>
                  <span
                    className="shot__del"
                    role="button"
                    data-tip={t('popup.library.delete')}
                    onClick={(event) => {
                      event.stopPropagation()
                      void removeFromLibrary(meta)
                    }}
                  >
                    <Icon name="close" size={10} />
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <b>{t('popup.section.settings')}</b>
          </div>
          <div className="settings">
            <button className="setting" onClick={toggleAutoRestore}>
              <div className="setting__text">
                <b>{t('popup.setting.restore')}</b>
                <span>{t('popup.setting.restore.desc')}</span>
              </div>
              <span className="switch" data-on={settings.autoRestore} />
            </button>
            <div className="setting">
              <div className="setting__text">
                <b>{t('popup.setting.locale')}</b>
                <span>{t('popup.setting.locale.desc')}</span>
              </div>
              <div className="locale-options">
                <button
                  className="locale-chip"
                  data-active={locale === 'zh'}
                  onClick={() => setLocale('zh')}
                >
                  中文
                </button>
                <button
                  className="locale-chip"
                  data-active={locale === 'en'}
                  onClick={() => setLocale('en')}
                >
                  EN
                </button>
              </div>
            </div>
            <button className="setting" onClick={openHelp}>
              <div className="setting__text">
                <b>{t('popup.setting.help')}</b>
                <span>{t('popup.setting.help.desc')}</span>
              </div>
              <Icon name="chevron-down" size={14} className="chevron" />
            </button>
          </div>
        </section>
      </div>

      <footer className="footer">
        <span className="kbd">
          <em>Alt</em>
          <em>Shift</em>
          <em>V</em>
          <span>{t('popup.footer.toggle')}</span>
        </span>
        <span>{t('popup.footer.tips')}</span>
      </footer>
    </div>
  )
}
