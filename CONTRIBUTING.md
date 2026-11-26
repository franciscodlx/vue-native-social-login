# Contribuir

## Preparar el entorno

Node 24 (ver `.nvmrc`), pnpm 12, Bun (el CLI de Vue Native compila con él), Xcode con XcodeGen (`brew install xcodegen`), y Android SDK con JDK 17.

```sh
pnpm install
pnpm build                                   # la demo consume los paquetes compilados
pnpm --filter ./examples/demo setup:native   # copia el framework nativo y corre `vue-native-social-login setup`
```

`setup:native` copia en `examples/demo/native/` el framework que trae `@thelacanians/vue-native-cli` (no se versiona: son 13 MB) y después corre `vue-native-social-login setup`, igual que lo haría una app. Vuelve a correrlo si cambias `packages/auth-core/native/SocialLoginAuthSession.vue`.

**Android:** Vue Native 0.23.3 tapa la pantalla con un contenedor que se come los toques (ver el README). Para probar la demo a mano, cambia a `false` el `isClickable = true` del `modalContainer` en `examples/demo/native/android/VueNativeCore/src/main/kotlin/com/vuenative/core/Bridge/NativeBridge.kt`. Como `native/` no se versiona, el cambio se queda en tu máquina, y `setup:native` lo deshace.

## Correr la demo contra los mocks

1. Proveedor local: `node tools/mock-idp/server.mjs`. Con `MOCK_IDP_AUTO=approve` redirige sin mostrar la pantalla de consentimiento; con `MOCK_IDP_AUTO=deny` siempre rechaza.
2. Backends (cada uno en su puerto, en modo mock si no tiene `.env`):

   | Backend                      | Puerto | Proveedores                    |
   | ---------------------------- | ------ | ------------------------------ |
   | `tools/linkedin-backend`     | 4100   | LinkedIn                       |
   | `tools/mercadolibre-backend` | 4200   | Mercado Libre                  |
   | `tools/twitch-backend`       | 4300   | Twitch                         |
   | `tools/presets-backend`      | 4400   | GitHub, Discord, Slack, Strava |
   | `tools/telegram-backend`     | 4500   | Telegram                       |
   | `tools/tiktok-backend`       | 4600   | TikTok                         |
   | `tools/mock-entra`           | 4700   | Entra (código `12345678`)      |

   `node server.mjs` en cada carpeta (`node server.js` en `mock-entra`). X no necesita backend: es cliente público.

3. App: `pnpm --filter @franciscodlxdev/vue-native-social-login-demo ios` o `android` (`vue-native run`: compila y abre en el simulador o emulador; en iOS elige uno con `-- --simulator "iPhone 17"`).

En el emulador de Android la demo llega a los mocks por `10.0.2.2`; en el simulador de iOS, por `localhost`.

## Probar con cuentas reales

1. Llena el `client ID` del proveedor en `examples/demo/app/config.ts` y la URL pública del túnel de su backend en `BACKEND_PUBLIC_URLS` (X no usa backend).
2. Copia `tools/<proveedor>-backend/.env.example` a `.env` y llena el secret. Nunca lo subas.
3. Levanta el backend y un túnel: `cloudflared tunnel --url http://localhost:<puerto>`. Registra `<URL del túnel>/auth/<proveedor>/callback` en el proveedor (la URL cambia en cada arranque).

La demo usa los mismos esquemas que los ejemplos de React Native, Flutter y NativeScript (`linkedinexample://`, `xloginexample://`, …), así que los `APP_CALLBACK` de los backends y los redirect ya registrados en los proveedores siguen sirviendo.

## Qué probar en dispositivo antes de abrir un PR

| Caso                            | Resultado esperado                             |
| ------------------------------- | ---------------------------------------------- |
| "Sign in with …" y aprobar      | `SIGNED IN (<proveedor>)` con `id` y `email`   |
| Cerrar el navegador sin aprobar | `ERROR CANCELLED: The user closed the browser` |
| Pulsar "Deny" en el mock        | `ERROR CANCELLED: …`                           |
| Entra con `ada@example.com`     | `SIGNED IN (Entra)`                            |

Las demos de la familia registran los mismos esquemas: en Android deja instalada solo una a la vez.

## Antes de enviar

```sh
pnpm lint && pnpm typecheck && pnpm test
pnpm changeset   # describe el cambio; genera la entrada del CHANGELOG
```

- Commits con [Conventional Commits](https://www.conventionalcommits.org/): `feat(auth-core): …`, `fix(linkedin): …`.
- Código y comentarios en inglés; documentación en español.
- Un cambio de comportamiento lleva su prueba.

## Publicar

Se publica solo al hacer merge a `main`:

1. En tu PR, `pnpm changeset` describe el cambio (patch, minor o major) y `pnpm version-packages` sube las versiones y escribe los `CHANGELOG.md`. Haz commit de ambos.
2. En el PR, el CI empaqueta todo y hace un dry run de lo que se publicaría (`node scripts/release.mjs --dry-run`).
3. Al hacer merge, el workflow `Release` publica en npm cada paquete cuya versión aún no está ahí, con trusted publishing (OIDC, sin token) y provenance, y crea el tag `<paquete>@<versión>` con su release de GitHub.

Un PR sin cambio de versión no publica nada. Un paquete **nuevo** se publica la primera vez a mano (`pnpm pack` y `npm publish <tgz> --access public`), y después se le configura trusted publishing en npmjs.com.
