/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from '@thelacanians/vue-native-runtime'
  const component: DefineComponent<{}, {}, any>
  export default component
}
declare const __DEV__: boolean
declare const __PLATFORM__: 'ios' | 'android' | 'macos'
