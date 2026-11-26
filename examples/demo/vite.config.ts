import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueNative from '@thelacanians/vue-native-vite-plugin'

export default defineConfig({
  plugins: [vue(), vueNative({
    nativeOutputDirs: {
      typescript: 'app/generated',
    },
  })],
})
