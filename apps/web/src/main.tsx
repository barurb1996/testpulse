import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'
import './index.css'
import { installAuthFetch, purgeLegacyCredentials } from './auth.js'

purgeLegacyCredentials()
installAuthFetch()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
