import { useEffect, useState, type CSSProperties } from 'react'
import type { Baseline, Finding, FindingKind, Severity } from '@/shared/diff'
import { findingsMarkdown, subsetReport, toJson } from '@/shared/diff'
import { useSceneStore } from '../store'
import { Icon } from '@/shared/Icon'
import { useT, type StringKey } from '@/shared/i18n'
import {
  alignBaselineAndRerun,
  DIFF_FILE_NAME,
  findingRect,
  pickLayer,
  runDiffFlow,
  type DiffCrop,
  type DiffSession,
} from '../lib/diff'
import { runAutoFitFlow } from '../lib/autofit'
import { copyText, downloadDataUrl, downloadText } from '../lib/raster'

const SEVERITY_ORDER: Severity[] = ['blocker', 'major', 'minor', 'info']
const SEVERITY_KEY: Record<Severity, StringKey> = {
  blocker: 'diff.severity.blocker',
  major: 'diff.severity.major',
  minor: 'diff.severity.minor',
  info: 'diff.severity.info',
}
const KIND_KEY: Record<FindingKind, StringKey> = {
  shift: 'diff.kind.shift',
  color: 'diff.kind.color',
  size: 'diff.kind.size',
  missing: 'diff.kind.missing',
  extra: 'diff.kind.extra',
  content: 'diff.kind.content',
}
const EXPORT_FORMATS = ['json', 'md', 'sarif', 'png'] as const
type ExportFormat = (typeof EXPORT_FORMATS)[number]

const BASELINE_LABEL: Record<Baseline['verdict'], StringKey> = {
  ok: 'diff.baseline.ok',
  drift: 'diff.baseline.drift',
  weak: 'diff.baseline.weak',
}
const BASELINE_HINT: Record<Baseline['verdict'], StringKey> = {
  ok: 'diff.baseline.hint.ok',
  drift: 'diff.baseline.hint.drift',
  weak: 'diff.baseline.hint.weak',
}

interface LightboxImage {
  label: string
  src: string
}

/** 差异大图：单张细看或三联并排，← → 切换，Esc 关闭 */
function Lightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: LightboxImage[]
  index: number
  onIndex: (next: number) => void
  onClose: () => void
}) {
  const t = useT()
  const [side, setSide] = useState(items.length > 1)
  // 差异裁剪常常是十几像素高的细长条，1:1 铺开根本看不清，给几档像素放大
  const [zoom, setZoom] = useState(1)
  const multi = items.length > 1
  const item = items[Math.min(index, items.length - 1)]

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (!multi) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const step = event.key === 'ArrowLeft' ? -1 : 1
        onIndex((index + step + items.length) % items.length)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, items.length, multi, onClose, onIndex])

  if (!item) return null
  const showSide = side && multi

  return (
    <div className="tp-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="tp-lightbox__stage"
        style={{ '--lb-zoom': String(zoom) } as CSSProperties}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="tp-lightbox__bar">
          <span className="tp-lightbox__label">{showSide ? t('diff.lightbox.side') : item.label}</span>
          {multi ? <span className="tp-lightbox__hint">{t('diff.lightbox.hint')}</span> : null}
          <div className="tp-lightbox__tools">
            {[1, 2, 4].map((level) => (
              <button
                key={level}
                className="tp-chip tp-lightbox__zoom"
                data-active={zoom === level}
                onClick={() => setZoom(level)}
              >
                {level}×
              </button>
            ))}
            {multi ? (
              <button
                className="tp-chip"
                data-active={showSide}
                onClick={() => setSide((value) => !value)}
              >
                {showSide ? t('diff.lightbox.single') : t('diff.lightbox.side')}
              </button>
            ) : null}
            <button className="tp-icon-btn" data-tip={t('diff.lightbox.close')} onClick={onClose}>
              <Icon name="close" size={13} />
            </button>
          </div>
        </header>

        {showSide ? (
          <div className="tp-lightbox__side">
            {items.map((entry, i) => (
              <figure key={entry.label} data-active={i === index} onClick={() => onIndex(i)}>
                <img src={entry.src} alt={entry.label} />
                <figcaption>{entry.label}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <figure className="tp-lightbox__one">
            <img src={item.src} alt={item.label} />
          </figure>
        )}
        {multi ? (
          <div className="tp-lightbox__pager">
            <button onClick={() => onIndex((index - 1 + items.length) % items.length)}>‹</button>
            {items.map((entry, i) => (
              <button key={entry.label} data-on={i === index} onClick={() => onIndex(i)}>
                {i + 1}
              </button>
            ))}
            <button onClick={() => onIndex((index + 1) % items.length)}>›</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 基准自检卡片：位置/尺寸不可信的时候，结论也就不可信，先对齐再读数字 */
function BaselineCard({ session }: { session: DiffSession }) {
  const t = useT()
  const store = useSceneStore()
  const { baseline } = session
  const trouble = baseline.verdict !== 'ok'

  return (
    <div className="tp-baseline" data-verdict={baseline.verdict}>
      <div className="tp-baseline__head">
        <span className="tp-baseline__label">{t('diff.baseline.title')}</span>
        <b>{t(BASELINE_LABEL[baseline.verdict])}</b>
        <span className="tp-baseline__score">
          {t('diff.baseline.score', { score: baseline.score.toFixed(2) })}
        </span>
      </div>
      <div className="tp-baseline__facts">
        <span>{t('diff.baseline.driftValue', baseline.drift)}</span>
        <span>{t('diff.baseline.scaleValue', { percent: Math.round(baseline.scaleRatio * 100) })}</span>
      </div>
      <p className="tp-baseline__hint">{t(BASELINE_HINT[baseline.verdict])}</p>
      {trouble ? (
        <button
          className="tp-baseline__fix"
          disabled={store.diffBusy}
          onClick={() => void alignBaselineAndRerun(session)}
        >
          <Icon name="target" size={12} />
          {t('diff.baseline.fix')}
        </button>
      ) : null}
    </div>
  )
}

/** 图层动过之后旧结果就不成立了，提示一句比让人误读强 */
function StaleNotice({ session }: { session: DiffSession }) {
  const t = useT()
  return (
    <div className="tp-stale">
      <div>
        <b>{t('diff.stale.title')}</b>
        <p>{t('diff.stale.hint')}</p>
      </div>
      <button onClick={() => void runDiffFlow({ layerId: session.basis.layerId })}>
        {t('diff.stale.action')}
      </button>
    </div>
  )
}

function stampOf(time: number): string {
  return new Date(time)
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, '')
}

function FindingDetail({
  finding,
  crop,
  onZoom,
}: {
  finding: Finding
  crop?: DiffCrop
  onZoom: (index: number) => void
}) {
  const t = useT()
  return (
    <div className="tp-report__detail">
      {crop ? (
        <div className="tp-crops">
          {([
            [t('diff.crop.expected'), crop.expected],
            [t('diff.crop.actual'), crop.actual],
            [t('diff.crop.diff'), crop.diff],
          ] as const).map(([label, src], index) => (
            <button
              key={label}
              className="tp-crop"
              data-tip={t('diff.lightbox.zoom')}
              onClick={() => onZoom(index)}
            >
              <img src={src} alt={label} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <dl className="tp-report__facts">
        <div>
          <dt>{t('diff.detail.region')}</dt>
          <dd>
            {finding.box.x},{finding.box.y} · {finding.box.w}×{finding.box.h}
          </dd>
        </div>
        {finding.element ? (
          <div>
            <dt>{t('diff.detail.element')}</dt>
            <dd>
              <code>{finding.element.selector}</code>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t('diff.detail.color')}</dt>
          <dd>
            <i className="tp-swatch" style={{ background: finding.expected.hex }} />
            {finding.expected.hex}
            <span className="tp-arrow">→</span>
            <i className="tp-swatch" style={{ background: finding.actual.hex }} />
            {finding.actual.hex}
          </dd>
        </div>
        <div>
          <dt>{t('diff.detail.metrics')}</dt>
          <dd>
            {t('diff.detail.metricsValue', {
              de: finding.metrics.deltaE,
              ssim: finding.metrics.ssim,
              ratio: Math.round(finding.metrics.pixelRatio * 100),
            })}
          </dd>
        </div>
        {finding.suggestion ? (
          <div>
            <dt>{t('diff.detail.suggestion')}</dt>
            <dd>
              <code>
                {finding.suggestion.property}: {finding.suggestion.to}
              </code>
            </dd>
          </div>
        ) : null}
      </dl>
      {finding.note ? <p className="tp-report__note">{finding.note}</p> : null}
    </div>
  )
}

export function DiffPanel() {
  const t = useT()
  const session = useSceneStore((state) => state.diff)
  const busy = useSceneStore((state) => state.diffBusy)
  const focusId = useSceneStore((state) => state.diffFocus)
  const setFocus = useSceneStore((state) => state.setDiffFocus)
  const setPanel = useSceneStore((state) => state.setPanel)
  const notify = useSceneStore((state) => state.notify)
  const fitBusy = useSceneStore((state) => state.fitBusy)
  const layers = useSceneStore((state) => state.layers)
  const layer = useSceneStore((state) => pickLayer(state.layers, state.selectedId))
  const setLightbox = useSceneStore((state) => state.setLightbox)
  const [viewer, setViewer] = useState<{ items: LightboxImage[]; index: number } | null>(null)
  // 勾选的差异块：单块复制、批量复制与导出的依据
  const [picked, setPicked] = useState<Set<string>>(new Set())

  // 重新比对后旧 id 已经不存在，勾选跟着作废
  useEffect(() => {
    setPicked(new Set())
  }, [session?.createdAt])

  // 大图打开时暂停全局快捷键，避免方向键把图层播了
  useEffect(() => {
    setLightbox(Boolean(viewer))
    return () => setLightbox(false)
  }, [setLightbox, viewer])

  const summary = session?.report.summary
  const stamp = session ? stampOf(session.createdAt) : 'now'

  // 结果算完又拖动了图层：旧数字已经对不上当前页面
  const basis = session?.basis
  const basisLayer = basis ? layers.find((item) => item.id === basis.layerId) : undefined
  const stale =
    !!basis &&
    (!basisLayer ||
      Math.abs(basisLayer.x - basis.rect.x) > 0.5 ||
      Math.abs(basisLayer.y - basis.rect.y) > 0.5 ||
      Math.abs(basisLayer.width - basis.rect.w) > 0.5 ||
      Math.abs(basisLayer.height - basis.rect.h) > 0.5)

  const openCrops = (crop: DiffCrop, index: number) => {
    setViewer({
      items: [
        { label: t('diff.crop.expected'), src: crop.expected },
        { label: t('diff.crop.actual'), src: crop.actual },
        { label: t('diff.crop.diff'), src: crop.diff },
      ],
      index,
    })
  }

  const openDiffImage = () => {
    if (!session?.diffImage) return
    setViewer({ items: [{ label: t('diff.export.image'), src: session.diffImage }], index: 0 })
  }

  const focusOn = (finding: Finding) => {
    setFocus(finding.id)
    if (!session) return
    const rect = findingRect(session, finding.id)
    if (!rect) return
    const top = window.scrollY
    const visible = rect.y >= top && rect.y + rect.h <= top + window.innerHeight
    if (!visible) {
      window.scrollTo({ top: Math.max(0, rect.y - window.innerHeight / 2), behavior: 'smooth' })
    }
  }

  const exportAs = (format: ExportFormat) => {
    if (!session) return
    const base = `${DIFF_FILE_NAME}-${stamp}`
    if (format === 'json') downloadText(`${base}.json`, session.json, 'application/json')
    if (format === 'md') downloadText(`${base}.md`, session.markdown, 'text/markdown')
    if (format === 'sarif') downloadText(`${base}.sarif`, session.sarif, 'application/json')
    if (format === 'png') {
      if (!session.diffImage) {
        notify(t('diff.export.none'), 'warn')
        return
      }
      downloadDataUrl(`${base}-diff.png`, session.diffImage)
    }
    notify(
      t('diff.export.done', {
        name: format === 'png' ? t('diff.export.image') : format.toUpperCase(),
      }),
    )
  }

  const copyJson = async () => {
    if (!session) return
    const copied = await copyText(session.json)
    notify(copied ? t('diff.copy.done') : t('diff.copy.blocked'), copied ? 'info' : 'warn')
  }

  const allFindings = session?.report.findings ?? []
  const pickedFindings = allFindings.filter((finding) => picked.has(finding.id))
  const allPicked = allFindings.length > 0 && pickedFindings.length === allFindings.length

  const togglePick = (id: string) => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const togglePickAll = () => {
    setPicked(allPicked ? new Set() : new Set(allFindings.map((finding) => finding.id)))
  }

  const copyFinding = async (finding: Finding) => {
    if (!session) return
    const no = session.report.findings.findIndex((item) => item.id === finding.id) + 1
    const copied = await copyText(findingsMarkdown(session.report, [finding]))
    notify(
      copied ? t('diff.copy.block.done', { no }) : t('diff.copy.blocked'),
      copied ? 'info' : 'warn',
    )
  }

  const copyPicked = async () => {
    if (!session || !pickedFindings.length) return
    const copied = await copyText(findingsMarkdown(session.report, pickedFindings, true))
    notify(
      copied ? t('diff.copy.picked.done', { count: pickedFindings.length }) : t('diff.copy.blocked'),
      copied ? 'info' : 'warn',
    )
  }

  const exportPicked = (format: 'md' | 'json') => {
    if (!session || !pickedFindings.length) return
    const base = `${DIFF_FILE_NAME}-${stamp}-selection`
    if (format === 'md') {
      downloadText(`${base}.md`, findingsMarkdown(session.report, pickedFindings, true), 'text/markdown')
    } else {
      downloadText(`${base}.json`, toJson(subsetReport(session.report, pickedFindings)), 'application/json')
    }
    notify(t('diff.export.done', { name: `${format.toUpperCase()} · ${pickedFindings.length}` }))
  }

  return (
    <section className="tp-report">
      <header className="tp-report__head">
        <div className="tp-report__title">
          <span className="tp-report__badge">{t('diff.badge')}</span>
          <b>
            {busy
              ? t('diff.busy')
              : !summary
                ? t('diff.title')
                : summary.verdict === 'clean'
                  ? t('diff.clean')
                  : t('diff.count', { count: summary.findings })}
          </b>
        </div>
        <button
          className="tp-icon-btn"
          data-tip={t('diff.collapse')}
          onClick={() => setPanel(null)}
        >
          <Icon name="chevron-down" size={13} />
        </button>
      </header>

      {busy ? (
        <div className="tp-report__busy">
          <span className="tp-spinner" />
          <span>{t('diff.busy.hint')}</span>
        </div>
      ) : null}

      {!busy && !session ? (
        <div className="tp-report__empty">
          <p>{t('diff.empty.line1')}</p>
          <p>{t('diff.empty.line2')}</p>
        </div>
      ) : null}

      {session && summary ? (
        <>
          {stale ? <StaleNotice session={session} /> : null}

          <div className="tp-report__meta">
            <span>{session.report.inputs.expected.name}</span>
            <span className="tp-sep-dot">·</span>
            <span>
              {session.report.inputs.expected.width}×{session.report.inputs.expected.height}
            </span>
            <span className="tp-sep-dot">·</span>
            <span>{t('diff.changed', { percent: (summary.changedRatio * 100).toFixed(1) })}</span>
            <span className="tp-sep-dot">·</span>
            <span>DPR {session.dpr}</span>
          </div>

          <BaselineCard session={session} />

          {summary.findings ? (
            <div className="tp-report__bars">
              {SEVERITY_ORDER.map((severity) => {
                const count = summary.bySeverity[severity] ?? 0
                if (!count) return null
                return (
                  <i
                    key={severity}
                    data-sev={severity}
                    style={{ flexGrow: count }}
                    title={`${t(SEVERITY_KEY[severity])} ${count}`}
                  />
                )
              })}
            </div>
          ) : null}

          {summary.findings ? (
            <div className="tp-report__legend">
              {SEVERITY_ORDER.map((severity) => {
                const count = summary.bySeverity[severity] ?? 0
                if (!count) return null
                return (
                  <span key={severity}>
                    <i data-sev={severity} />
                    {t(SEVERITY_KEY[severity])} {count}
                  </span>
                )
              })}
              {session.report.inputs.alignment.dx || session.report.inputs.alignment.dy ? (
                <span className="tp-report__align">
                  {t('diff.offset', {
                    dx: session.report.inputs.alignment.dx,
                    dy: session.report.inputs.alignment.dy,
                  })}
                </span>
              ) : null}
            </div>
          ) : null}

          {summary.findings ? (
            <button
              className="tp-report__autofit"
              disabled={fitBusy || !layer}
              onClick={() => void runAutoFitFlow({ layerId: layer?.id, rerun: true })}
            >
              <Icon name="wand" size={13} className={fitBusy ? 'tp-spin' : undefined} />
              <b>{fitBusy ? t('fit.auto.busy') : t('diff.autofit')}</b>
              <small>{t('diff.autofit.hint')}</small>
            </button>
          ) : null}

          {session.diffImage ? (
            <button className="tp-report__preview" onClick={openDiffImage}>
              <img src={session.diffImage} alt={t('diff.export.image')} />
              <span>
                <Icon name="compare" size={11} />
                {t('diff.lightbox.zoom')}
              </span>
            </button>
          ) : null}

          {summary.findings ? (
            <>
              <div className="tp-report__pick">
                <button
                  className="tp-chip"
                  data-active={allPicked}
                  onClick={togglePickAll}
                >
                  {allPicked ? t('diff.pick.none') : t('diff.pick.all')}
                </button>
                <span className="tp-report__pickcount">
                  {t('diff.pick.count', { count: pickedFindings.length, total: allFindings.length })}
                </span>
                <button
                  className="tp-chip"
                  disabled={!pickedFindings.length}
                  onClick={() => void copyPicked()}
                >
                  <Icon name="copy" size={10} /> {t('diff.pick.copy')}
                </button>
                <button
                  className="tp-chip"
                  disabled={!pickedFindings.length}
                  data-tip={t('diff.pick.export.tip')}
                  onClick={() => exportPicked('md')}
                >
                  MD
                </button>
                <button
                  className="tp-chip"
                  disabled={!pickedFindings.length}
                  data-tip={t('diff.pick.export.tip')}
                  onClick={() => exportPicked('json')}
                >
                  JSON
                </button>
              </div>

              <ol className="tp-report__list">
                {session.report.findings.map((finding, index) => {
                  const isPicked = picked.has(finding.id)
                  return (
                    <li key={finding.id}>
                      <div
                        className="tp-report__row"
                        data-active={finding.id === focusId}
                        data-picked={isPicked}
                      >
                        <button
                          className="tp-check"
                          role="checkbox"
                          aria-checked={isPicked}
                          data-on={isPicked}
                          aria-label={t(isPicked ? 'diff.pick.off' : 'diff.pick.on')}
                          data-tip={t(isPicked ? 'diff.pick.off' : 'diff.pick.on')}
                          onClick={() => togglePick(finding.id)}
                        >
                          {isPicked ? <Icon name="check" size={9} /> : null}
                        </button>
                        <button className="tp-report__main" onClick={() => focusOn(finding)}>
                          <i className="tp-report__dot" data-sev={finding.severity} />
                          <span className="tp-report__no">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="tp-report__kind">{t(KIND_KEY[finding.kind])}</span>
                          <span className="tp-report__where">
                            {finding.element?.selector ?? `${finding.box.x},${finding.box.y}`}
                          </span>
                          <span className="tp-report__de">
                            ΔE {finding.metrics.deltaE.toFixed(1)}
                          </span>
                        </button>
                        <button
                          className="tp-icon-btn tp-report__copy"
                          aria-label={t('diff.copy.block')}
                          data-tip={t('diff.copy.block')}
                          onClick={() => void copyFinding(finding)}
                        >
                          <Icon name="copy" size={11} />
                        </button>
                      </div>
                      {finding.id === focusId ? (
                        <FindingDetail
                          finding={finding}
                          crop={session.crops.find((item) => item.id === finding.id)}
                          onZoom={(index) => {
                            const crop = session.crops.find((item) => item.id === finding.id)
                            if (crop) openCrops(crop, index)
                          }}
                        />
                      ) : null}
                    </li>
                  )
                })}
              </ol>
            </>
          ) : (
            <div className="tp-report__clean">
              <Icon name="check" size={14} />
              {t('diff.clean.hint', { tiles: summary.tiles })}
            </div>
          )}

          <footer className="tp-report__foot">
            <div className="tp-report__exports">
              {EXPORT_FORMATS.map((format) => (
                <button key={format} className="tp-chip" onClick={() => exportAs(format)}>
                  {format.toUpperCase()}
                </button>
              ))}
              <button className="tp-chip" onClick={() => void copyJson()} data-tip={t('diff.copy.tip')}>
                <Icon name="copy" size={10} /> JSON
              </button>
            </div>
            {session.report.notes.length ? (
              <p className="tp-report__notes">{session.report.notes.slice(-2).join(' · ')}</p>
            ) : null}
          </footer>
        </>
      ) : null}

      {viewer ? (
        <Lightbox
          items={viewer.items}
          index={viewer.index}
          onIndex={(next) => setViewer((current) => (current ? { ...current, index: next } : current))}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </section>
  )
}

/** 差异框画回页面：位置用文档坐标，滚动时不会跑掉 */
export function DiffMarkers() {
  const session = useSceneStore((state) => state.diff)
  const focusId = useSceneStore((state) => state.diffFocus)
  const panel = useSceneStore((state) => state.panel)
  if (!session || panel !== 'diff') return null

  return (
    <div className="tp-markers" aria-hidden="true">
      {session.report.findings.map((finding, index) => (
        <div
          key={finding.id}
          className="tp-marker"
          data-sev={finding.severity}
          data-focus={finding.id === focusId}
          style={{
            left: Math.round(session.anchor.x + finding.box.x),
            top: Math.round(session.anchor.y + finding.box.y),
            width: Math.round(finding.box.w),
            height: Math.round(finding.box.h),
          }}
        >
          {finding.id === focusId ? <span className="tp-marker__tag">{index + 1}</span> : null}
        </div>
      ))}
    </div>
  )
}
