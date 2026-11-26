# @franciscodlxdev/vue-native-tiktok-login

Login con TikTok para Vue Native ([vue-native.dev](https://www.vue-native.dev), iOS y Android) con el flujo web de Login Kit, en el navegador del sistema. Sin WebView y sin `client_secret` en la app.

## Compatibilidad

| Paquete | Vue Native       | iOS    | Android        |
| ------- | ---------------- | ------ | -------------- |
| 0.1.x   | 0.23.3 (probado) | ≥ 16.0 | ≥ 5.0 (API 21) |

## Instalación

```sh
pnpm add @franciscodlxdev/vue-native-tiktok-login @franciscodlxdev/vue-native-auth-core
npx vue-native-social-login setup --scheme miapp
```

`setup` agrega a tu app el módulo nativo del núcleo y, en Android, el esquema de tu redirect; detalles en [`vue-native-auth-core`](../auth-core#instalación).

## Configurar el proveedor

1. Crea la app en [TikTok for Developers](https://developers.tiktok.com) y agrega el producto **Login Kit**.
2. Registra como Redirect URI una URL **https de tu backend**, por ejemplo `https://api.miapp.com/auth/tiktok/callback`. Reglas de TikTok: https, estática (sin parámetros ni fragmento), hasta 10 URIs.
3. `user.info.basic` viene incluido; cualquier otro scope requiere aprobación previa en la configuración de la app.

El canje exige el `client_secret`, así que necesitas un backend con dos rutas: una que reenvíe el redirect a tu app y otra que haga el canje. [`tools/tiktok-backend`](../../tools/tiktok-backend) es una implementación completa.

```
app ──signIn()──▶ TikTok ──https──▶ tu backend /callback ──miapp://callback──▶ app
app ──code──▶ tu backend /exchange ──client_key + secret──▶ TikTok ──▶ perfil
```

## Uso

```ts
import {
  grantedTikTokScopes,
  tikTokLogin,
} from '@franciscodlxdev/vue-native-tiktok-login';

const result = await tikTokLogin.signIn({
  clientId: 'TU_CLIENT_KEY',
  redirectUri: 'https://api.miapp.com/auth/tiktok/callback',
  callbackUri: 'miapp://callback',
});
const scopes = grantedTikTokScopes(result); // lo que el usuario aceptó
await fetch('https://api.miapp.com/auth/tiktok/exchange', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: result.code,
    redirectUri: result.redirectUri,
  }),
});
```

`clientId` es el **Client key** de TikTok; el paquete lo envía como `client_key` y separa los scopes con coma, como pide TikTok.

| Exporta                                                                                                                            | Para qué                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `tikTokLogin`                                                                                                                      | `signIn`, `signOut`, `isAvailable`                                                     |
| `createTikTokLogin(overrides)`                                                                                                     | Otra instancia: `extraAuthParams: { disable_auto_auth: '1' }` o un servidor de pruebas |
| `grantedTikTokScopes(result)`                                                                                                      | Scopes concedidos, del parámetro `scopes` del redirect                                 |
| `mapTikTokProfile(response)`                                                                                                       | Convierte la respuesta de `/v2/user/info/` en `TikTokProfile`                          |
| `tikTokUserInfoUrl(fields)`, `TIKTOK_TOKEN_ENDPOINT`, `TIKTOK_REVOCATION_ENDPOINT`, `TIKTOK_BASIC_FIELDS`, `TIKTOK_PROFILE_FIELDS` | Utilidades y constantes para tu backend                                                |

| Scope               | Campos de `/v2/user/info/`                                        |
| ------------------- | ----------------------------------------------------------------- |
| `user.info.basic`   | `open_id`, `union_id`, `avatar_url`, `display_name`               |
| `user.info.profile` | `username`, `bio_description`, `profile_deep_link`, `is_verified` |
| `user.info.stats`   | `follower_count`, `following_count`, `likes_count`, `video_count` |

TikTok no entrega correo electrónico.

## Backend (canje del código)

Node, completo y con pruebas: [`tools/tiktok-backend/server.mjs`](../../tools/tiktok-backend/server.mjs). Laravel:

```php
// Reenvía el redirect de TikTok a la app.
Route::get('/auth/tiktok/callback', fn (Request $r) =>
    redirect()->away('miapp://callback?' . $r->getQueryString()));

Route::post('/auth/tiktok/exchange', function (Request $r) {
    $tokens = Http::asForm()->post('https://open.tiktokapis.com/v2/oauth/token/', [
        'grant_type' => 'authorization_code',
        'code' => $r->input('code'),
        'redirect_uri' => config('services.tiktok.redirect'), // fijo, no el que mande la app
        'client_key' => config('services.tiktok.client_key'),
        'client_secret' => config('services.tiktok.client_secret'),
    ])->throw()->json();

    $info = Http::withToken($tokens['access_token'])
        ->get('https://open.tiktokapis.com/v2/user/info/', [
            'fields' => 'open_id,union_id,avatar_url,display_name',
        ])->throw()->json();
    abort_unless(($info['error']['code'] ?? null) === 'ok', 502);

    // Guarda $tokens en el servidor y crea tu propia sesión para $info['data']['user']['open_id'].
    return ['profile' => $info['data']['user']];
});
```

- `/v2/user/info/` exige el parámetro `fields` y siempre trae un objeto `error`; solo `code: "ok"` es éxito.
- El access token dura 2 horas y el refresh token 180 días según la documentación; usa `expires_in` y `refresh_expires_in` de la respuesta. El refresh token rota en cada renovación.

## Errores normalizados

`CANCELLED | NETWORK | INVALID_CONFIG | PROVIDER_ERROR | NOT_SUPPORTED`, en `error.code`; el código original del proveedor queda en `error.providerError`.

## Seguridad

- El `client_secret` y los tokens de TikTok viven solo en tu backend.
- `state` se genera y verifica en el dispositivo. El flujo web de TikTok no tiene PKCE: lo define solo para escritorio y sus SDK nativos, y con el hash en hexadecimal en vez del formato estándar.
- En tu backend, el destino del reenvío y el `redirect_uri` del canje deben ser fijos, no tomados de la petición.

## Frente al SDK nativo de TikTok

El SDK oficial (TikTok OpenSDK) abre la app de TikTok y exige Universal Links en iOS y un redirect https en Android. Este paquete no lo envuelve: usa el flujo web en el navegador del sistema, que funciona aunque la app de TikTok no esté instalada pero pide iniciar sesión en el navegador.

## Sin verificar contra TikTok real

- El código de error cuando el usuario cancela (se asume `access_denied`; la documentación no lo dice).
- Si TikTok exige revisión de la app antes de que usuarios que no sean de prueba puedan iniciar sesión.
- Qué ocurre en Android si la app de TikTok intercepta la URL de autorización (el núcleo abre siempre el navegador).

## Probar sin credenciales

`examples/demo` (Vue Native) corre todos los proveedores contra `tools/mock-idp` y los backends de `tools/`. Ver [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licencia

MIT.
