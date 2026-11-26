# @franciscodlxdev/vue-native-telegram-login

Log in with Telegram para Vue Native ([vue-native.dev](https://www.vue-native.dev), iOS y Android) con OpenID Connect + PKCE, en el navegador del sistema. Sin WebView y sin Client Secret en la app.

## Compatibilidad

| Paquete | Vue Native       | iOS    | Android        |
| ------- | ---------------- | ------ | -------------- |
| 0.1.x   | 0.23.3 (probado) | ≥ 16.0 | ≥ 5.0 (API 21) |

## Instalación

```sh
pnpm add @franciscodlxdev/vue-native-telegram-login @franciscodlxdev/vue-native-auth-core
npx vue-native-social-login setup --scheme miapp
```

`setup` agrega a tu app el módulo nativo del núcleo y, en Android, el esquema de tu redirect; detalles en [`vue-native-auth-core`](../auth-core#instalación).

## Configurar el proveedor

1. En [@BotFather](https://t.me/BotFather) elige tu bot → **Login Widget**. Ahí aparecen el Client ID y el Client Secret.
2. En "Allowed URLs" agrega una URL **https de tu backend**, por ejemplo `https://api.miapp.com/auth/telegram/callback`. Telegram solo redirige a URLs registradas.

El canje del código se autentica con el Client Secret, así que necesitas un backend con dos rutas: una que reenvíe el redirect a tu app y otra que haga el canje. [`tools/telegram-backend`](../../tools/telegram-backend) es una implementación completa.

```
app ──signIn()──▶ Telegram ──https──▶ tu backend /callback ──miapp://callback──▶ app
app ──code + codeVerifier──▶ tu backend /exchange ──+ secret──▶ Telegram ──▶ id_token verificado
```

## Uso

```ts
import { telegramLogin } from '@franciscodlxdev/vue-native-telegram-login';

const result = await telegramLogin.signIn({
  clientId: 'TU_CLIENT_ID',
  redirectUri: 'https://api.miapp.com/auth/telegram/callback',
  callbackUri: 'miapp://callback',
});
await fetch('https://api.miapp.com/auth/telegram/exchange', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: result.code,
    codeVerifier: result.codeVerifier,
    redirectUri: result.redirectUri,
  }),
});
```

Scopes:

| Scope                 | Qué agrega                                        |
| --------------------- | ------------------------------------------------- |
| `openid`              | Obligatorio: `sub`                                |
| `profile`             | `id`, `name`, `preferred_username`, `picture`     |
| `phone`               | `phone_number` (Telegram pide permiso al usuario) |
| `telegram:bot_access` | Tu bot puede escribirle al usuario tras el login  |

Por defecto se piden `openid profile`. Para el teléfono: `signIn({ scopes: ['openid', 'profile', 'phone'] })`.

| Exporta                                                           | Para qué                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `telegramLogin`                                                   | `signIn`, `signOut`, `isAvailable`                       |
| `createTelegramLogin(overrides)`                                  | Otra instancia: otros scopes o un servidor de pruebas    |
| `mapTelegramProfile(claims)`                                      | Convierte los claims del `id_token` en `TelegramProfile` |
| `TELEGRAM_TOKEN_ENDPOINT`, `TELEGRAM_JWKS_URI`, `TELEGRAM_ISSUER` | Constantes para tu backend                               |

## Backend (canje del código)

Node, completo y con pruebas: [`tools/telegram-backend/server.mjs`](../../tools/telegram-backend/server.mjs). Laravel:

```php
// Reenvía el redirect de Telegram a la app.
Route::get('/auth/telegram/callback', fn (Request $r) =>
    redirect()->away('miapp://callback?' . $r->getQueryString()));

Route::post('/auth/telegram/exchange', function (Request $r) {
    $tokens = Http::asForm()
        ->withBasicAuth(config('services.telegram.client_id'), config('services.telegram.client_secret'))
        ->post('https://oauth.telegram.org/token', [
            'grant_type' => 'authorization_code',
            'code' => $r->input('code'),
            'code_verifier' => $r->input('codeVerifier'),
            'redirect_uri' => config('services.telegram.redirect'), // fijo, no el que mande la app
            'client_id' => config('services.telegram.client_id'),
        ])->throw()->json();

    // Verifica el id_token: firma con https://oauth.telegram.org/.well-known/jwks.json,
    // iss = https://oauth.telegram.org, aud = tu Client ID y exp.
    $claims = verifyTelegramIdToken($tokens['id_token']);

    // Crea aquí tu propia sesión para $claims->sub.
    return ['profile' => $claims];
});
```

Telegram no tiene endpoint de userinfo: el perfil son los claims del `id_token`. Firma con RS256 por defecto; otros algoritmos se eligen en BotFather (EdDSA y ES256K solo admiten el scope `openid`).

## Errores normalizados

`CANCELLED | NETWORK | INVALID_CONFIG | PROVIDER_ERROR | NOT_SUPPORTED`, en `error.code`; el código original del proveedor queda en `error.providerError`.

## Seguridad

- El Client Secret vive solo en tu backend; la app nunca recibe un token de Telegram.
- `state` y PKCE (S256) se generan en el dispositivo; el `codeVerifier` viaja al backend junto con el código.
- El backend verifica firma, emisor, audiencia y caducidad del `id_token` antes de confiar en el perfil.
- En tu backend, el destino del reenvío y el `redirect_uri` del canje deben ser fijos, no tomados de la petición.

## Frente al widget clásico y a los SDK nativos

- El widget clásico (hash HMAC con el token del bot, `/setdomain`) es para sitios web y Telegram lo dejó como "legacy"; este paquete usa el flujo OpenID Connect actual.
- Telegram publica SDK nativos (`telegram-login-ios`, `telegram-login-android`) que abren la app de Telegram en vez del navegador. Este paquete no los envuelve.

## Sin verificar contra Telegram real

- Si acepta esquemas propios (`miapp://`) en "Allowed URLs": la documentación no lo dice, y con el redirect https al backend no hace falta.
- El código de error cuando el usuario rechaza (se asume `access_denied`).
- Si `client_id` es el id numérico del bot o un identificador aparte: la documentación usa ambos términos; usa el valor que muestre BotFather.

## Probar sin credenciales

`examples/demo` (Vue Native) corre todos los proveedores contra `tools/mock-idp` y los backends de `tools/`. Ver [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licencia

MIT.
