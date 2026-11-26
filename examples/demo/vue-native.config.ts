import { defineConfig } from '@thelacanians/vue-native-cli'

export default defineConfig({
  name: 'demo',
  bundleId: 'dev.franciscodlx.socialauth.vndemo',
  version: '1.0.0',
  ios: {
    deploymentTarget: '16.0',
  },
  android: {
    minSdk: 21,
    targetSdk: 35,
  },
  macos: {
    deploymentTarget: '15.0',
  },
})
