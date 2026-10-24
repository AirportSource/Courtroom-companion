import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startDesktopHeartbeat } from './desktop/desktopHeartbeat.ts'
import { DevDisplayProvider } from './dev/DevDisplayProvider.tsx'
import { SettingsProvider } from './settings/SettingsProvider.tsx'

// Standalone Windows build only: tells the local server a tab is still open (no-op in dev/web).
startDesktopHeartbeat()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <DevDisplayProvider>
        <App />
      </DevDisplayProvider>
    </SettingsProvider>
  </StrictMode>,
)
