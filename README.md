# vue-native-social-login

<p align="center">

[![npm](https://img.shields.io/npm/v/@franciscodlxdev/vue-native-auth-core?label=npm&color=cb3837)](https://www.npmjs.com/package/@franciscodlxdev/vue-native-auth-core) [![CI](https://github.com/franciscodlx/vue-native-social-login/actions/workflows/ci.yml/badge.svg)](https://github.com/franciscodlx/vue-native-social-login/actions/workflows/ci.yml) [![Licencia MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

</p>

**Agrega "Iniciar sesión con GitHub, X, LinkedIn, TikTok…" a tu app de [Vue Native](https://www.vue-native.dev) con una sola API: navegador del sistema, PKCE y cero secrets en la app.**

Sin WebView: el usuario inicia sesión en `ASWebAuthenticationSession` (iOS) o Custom Tabs (Android), con las cookies y gestores de contraseñas que ya usa. El `client_secret` se queda en tu backend, y los errores llegan normalizados (`CANCELLED`, `NETWORK`, `PROVIDER_ERROR`…) sin importar el proveedor.

> Es para el framework de [vue-native.dev](https://www.vue-native.dev) (Vue 3 que renderiza a UIKit y Android Views), no para el Vue Native de GeekyAnts, que corría sobre React Native y está abandonado desde 2021.

## Instalación

```sh
pnpm add @franciscodlxdev/vue-native-auth-core @franciscodlxdev/vue-native-x-login
npx vue-native-social-login setup --scheme miapp
```

Vue Native solo genera código nativo desde los `.vue` de tu app, así que `setup` copia el módulo nativo a `app/native/` y, en Android, declara tu esquema en el manifiesto. Después vuelve a compilar (`vue-native run ios` / `android`). Detalles en [`vue-native-auth-core`](packages/auth-core#instalación).

## Ejemplo mínimo

```vue
<script setup lang="ts">
import { useProviderLogin } from '@franciscodlxdev/vue-native-auth-core';
import { xLogin } from '@franciscodlxdev/vue-native-x-login';

const x = useProviderLogin(xLogin, {
  clientId: 'TU_CLIENT_ID', // portal de X → OAuth 2.0, app tipo "Native App"
  redirectUri: 'miapp://callback', // regístrala tal cual en X
  exchangeCode: true, // cliente público: el canje se hace en el dispositivo con PKCE
});
</script>

<template>
  <VButton :disabled="x.loading.value" :onPress="() => x.signIn()">
    <VText>Continuar con X</VText>
  </VButton>
  <VText v-if="x.error.value">{{ x.error.value.code }}</VText>
</template>
```

X es un cliente público, así que este ejemplo no necesita backend. LinkedIn, GitHub, TikTok y los demás devuelven un `code` que tu backend canjea con el secret; cada paquete trae el canje listo en Node. Detalles de X en [`packages/x-login`](packages/x-login).

## Paquetes

| Paquete                                                                         | Qué hace                                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [`@franciscodlxdev/vue-native-auth-core`](packages/auth-core)                   | PKCE, `state`/`nonce`, navegador del sistema, errores, composable `useProviderLogin` y `setup` |
| [`@franciscodlxdev/vue-native-linkedin-login`](packages/linkedin-login)         | LinkedIn con OpenID Connect                                                                    |
| [`@franciscodlxdev/vue-native-x-login`](packages/x-login)                       | X con OAuth 2.0 + PKCE                                                                         |
| [`@franciscodlxdev/vue-native-mercadolibre-login`](packages/mercadolibre-login) | Mercado Libre con selector de país                                                             |
| [`@franciscodlxdev/vue-native-twitch-login`](packages/twitch-login)             | Twitch con OIDC                                                                                |
| [`@franciscodlxdev/vue-native-oauth-presets`](packages/oauth-presets)           | GitHub, Discord, Slack y Strava                                                                |
| [`@franciscodlxdev/vue-native-telegram-login`](packages/telegram-login)         | Telegram con OpenID Connect                                                                    |
| [`@franciscodlxdev/vue-native-tiktok-login`](packages/tiktok-login)             | TikTok Login Kit (flujo web)                                                                   |
| [`@franciscodlxdev/vue-native-entra-native-auth`](packages/entra-native-auth)   | Entra External ID: alta, login y reset sin navegador                                           |

**Estado:** todos probados contra los mocks de `tools/` en el emulador de Android (los 10 proveedores, Entra y la cancelación) y en el simulador de iOS (X y GitHub). Todavía no se han probado con cuentas reales en esta plataforma; la lógica de proveedores es la misma que en las otras cuatro, donde sí se probó con LinkedIn, X, GitHub, Discord, Telegram y TikTok.

Cada proveedor es un paquete independiente (versión, changelog y publicación propios) que solo aporta endpoints, scopes y mapeo de perfil; el flujo y la seguridad viven en el núcleo.

## Limitaciones conocidas de Vue Native 0.23.3

Vue Native es pre-1.0. Dos problemas del framework que encontramos al hacer esta librería:

- **Android: los toques no llegan a ningún componente.** `NativeBridge.setRootView` pone encima del contenido un contenedor transparente a pantalla completa con `isClickable = true`, que se queda con todos los toques. Afecta a cualquier app de Vue Native en Android, no solo a esta librería. Mientras se corrige, en tu copia de `native/` puedes cambiar ese `isClickable = true` del `modalContainer` (en `NativeBridge.kt`) a `false`.
- **`invokeNativeModule(…, 0)`** ("sin timeout") pierde la respuesta en Android porque el runtime llama `clearTimeout(undefined)`. La librería ya lo evita: usa un timeout de 10 minutos.

## Estructura

```
packages/auth-core          núcleo (TypeScript) + native/SocialLoginAuthSession.vue (Swift y Kotlin) + bin/setup.mjs
packages/<proveedor>        un paquete TypeScript por proveedor sobre el núcleo
examples/demo               app de Vue Native con todos los proveedores
tools/mock-idp              proveedor OAuth/OIDC local, sin credenciales reales
tools/mock-entra            imita la API de native authentication de Entra
tools/<proveedor>-backend   backends de ejemplo: redirect https y canje con el secret
```

## Desarrollo

Requiere Node 24, pnpm 12, Bun (lo usa el CLI de Vue Native), Xcode con XcodeGen, y Android SDK con JDK 17.

```sh
pnpm install
pnpm test          # pruebas unitarias (vitest)
pnpm typecheck
pnpm lint
pnpm build
```

Probar el flujo completo, sin cuenta en ningún proveedor: ver [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilidades: [SECURITY.md](SECURITY.md).

## La familia

La misma API, los mismos proveedores y los mismos códigos de error en cada plataforma:

| Plataforma                  | Repositorio                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------- |
| React Native (y Expo)       | [rn-social-login](https://github.com/franciscodlx/rn-social-login)                     |
| Flutter                     | [flutter_social_login](https://github.com/franciscodlx/flutter_social_login)           |
| Capacitor / Ionic           | [capacitor-social-login](https://github.com/franciscodlx/capacitor-social-login)       |
| NativeScript (Angular, Vue) | [nativescript-social-login](https://github.com/franciscodlx/nativescript-social-login) |
| NativePHP Mobile            | [nativephp-social-login](https://github.com/franciscodlx/nativephp-social-login)       |
| Vue Native (vue-native.dev) | **este repo**                                                                          |

## Licencia

MIT
