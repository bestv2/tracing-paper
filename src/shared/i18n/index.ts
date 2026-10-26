import { useCallback } from 'react'
import { usePrefs, type Locale } from '../prefs'
import { zh, type StringKey } from './zh'
import { en } from './en'

export type { Locale, StringKey }

export type TParams = Record<string, string | number>

const DICTS: Record<Locale, Record<StringKey, string>> = { zh, en }

export function translate(locale: Locale, key: StringKey, params?: TParams): string {
  const template = DICTS[locale]?.[key] ?? zh[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

/** 组件外使用：toast、异常信息、报告备注等 */
export function t(key: StringKey, params?: TParams): string {
  return translate(usePrefs.getState().locale, key, params)
}

/** 组件内使用：语言切换后自动重渲染 */
export function useT() {
  const locale = usePrefs((state) => state.locale)
  return useCallback(
    (key: StringKey, params?: TParams) => translate(locale, key, params),
    [locale],
  )
}
