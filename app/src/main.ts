import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { initStore } from './stores/app'
import { registerServiceWorker } from './lib/sw-client'
import './styles/main.css'

initStore()

createApp(App).use(router).mount('#app')

registerServiceWorker()
