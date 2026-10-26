import { create } from 'zustand'

export type Locale = 'zh' | 'en'
export type Theme = 'light' | 'dark'

const LOCALE_KEY = 'tp:locale'
const THEME_KEY = 'tp:theme'

/** 首次运行时按浏览器语言决定，之后跟随用户选择 */
function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh'
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return languages.some((lang) => /^zh/i.test(lang ?? '')) ? 'zh' : 'en'
}

function persist(key: string, value: string): void {
  try {
    void chrome.storage.local.set({ [key]: value })
  } catch {
    /* 非扩展环境（例如本地预览）下静默忽略 */
  }
}

interface PrefsStore {
  locale: Locale
  theme: Theme
  setLocale: (locale: Locale) => void
  setTheme: (theme: Theme) => void
}

export const usePrefs = create<PrefsStore>((set) => ({
  locale: detectLocale(),
  theme: 'light',
  setLocale: (locale) => {
    set({ locale })
    persist(LOCALE_KEY, locale)
  },
  setTheme: (theme) => {
    set({ theme })
    persist(THEME_KEY, theme)
  },
}))

/** 浮层 / 弹窗挂载前调用，把上次选择的语言与主题读回来 */
export async function initPrefs(): Promise<void> {
  try {
    const data = await chrome.storage.local.get([LOCALE_KEY, THEME_KEY])
    const locale = data[LOCALE_KEY]
    const theme = data[THEME_KEY]
    if (locale === 'zh' || locale === 'en') usePrefs.setState({ locale })
    if (theme === 'light' || theme === 'dark') usePrefs.setState({ theme })
  } catch {
    /* 读取失败时保持默认值 */
  }
}
