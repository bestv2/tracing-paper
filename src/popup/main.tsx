import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initPrefs } from '@/shared/prefs'
import { Popup } from './Popup'

const container = document.getElementById('root')

void (async () => {
  await initPrefs()
  if (!container) return
  createRoot(container).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  )
})()
