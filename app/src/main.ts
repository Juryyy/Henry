import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { initStore } from './stores/app'
import { loadAccount } from './stores/auth'
import { registerServiceWorker } from './lib/sw-client'
import './styles/main.css'

initStore()

// Nečeká se na odpověď – appka se vykreslí hned a přihlášení dorazí za ní.
// Jinak by při pomalé síti první vteřinu nebylo vidět vůbec nic.
void loadAccount()

createApp(App).use(router).mount('#app')

registerServiceWorker()
