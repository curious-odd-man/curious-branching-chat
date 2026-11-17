import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../App'
import { setLanguage } from '@shared/i18n'
import './styles.css'

// FR-293: the language of this window is fixed when it opens
setLanguage(window.branchchat.language)
document.documentElement.lang = window.branchchat.language

const root = document.getElementById('root')
if (!root) throw new Error('root element missing')
createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>
)
