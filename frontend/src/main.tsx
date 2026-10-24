import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DevDisplayProvider } from './dev/DevDisplayProvider.tsx'
import { SettingsProvider } from './settings/SettingsProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <DevDisplayProvider>
        <App />
      </DevDisplayProvider>
    </SettingsProvider>
  </StrictMode>,
)
