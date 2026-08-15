import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AiDesktopApp } from './app/AiDesktopApp.tsx'
import { createDemoClient } from './client/demo-client.ts'
import './theme.css'

const client = createDemoClient(window.localStorage)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AiDesktopApp client={client} />
  </StrictMode>,
)
