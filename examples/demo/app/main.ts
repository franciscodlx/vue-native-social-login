import { createApp } from '@thelacanians/vue-native-runtime'
import { createRouter } from '@thelacanians/vue-native-navigation'
import App from './App.vue'
import Home from './pages/Home.vue'

const router = createRouter([
  { name: 'Home', component: Home },
])

const app = createApp(App)
app.use(router)
app.start()
