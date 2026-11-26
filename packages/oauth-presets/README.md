# @franciscodlxdev/vue-native-oauth-presets

Login con GitHub, Discord, Slack y Strava para Vue Native ([vue-native.dev](https://www.vue-native.dev), iOS y Android) sobre [`@franciscodlxdev/vue-native-auth-core`](../auth-core): navegador del sistema, sin WebView y sin `client_secret` en la app.

## Compatibilidad

| Paquete | Vue Native       | iOS    | Android        |
| ------- | ---------------- | ------ | -------------- |
| 0.1.x   | 0.23.3 (probado) | ≥ 16.0 | ≥ 5.0 (API 21) |

## Instalación

```sh
pnpm add @franciscodlxdev/vue-native-oauth-presets @franciscodlxdev/vue-native-auth-core
npx vue-native-social-login setup --scheme miapp
```

`setup` agrega a tu app el módulo nativo del núcleo y, en Android, el esquema de tu redirect; detalles en [`vue-native-auth-core`](../auth-core#instalación).

## Presets

| Preset    | Scopes por defecto          | Protección además de `state`    | Dónde se registra el redirect                |
| --------- | --------------------------- | ------------------------------- | -------------------------------------------- |
| `github`  | `read:user user:email`      | PKCE (S256)                     | OAuth App → Authorization callback URL       |
| `discord` | `identify email`            | PKCE (S256), `iss` del redirect | Developer Portal → OAuth2 → Redirects        |
| `slack`   | `openid profile email`      | `nonce` (OpenID Connect)        | App → OAuth & Permissions → Redirect URLs    |
| `strava`  | `read` (separados por coma) | ninguna documentada             | API settings → Authorization Callback Domain |

Los cuatro exigen el `client_secret` para cambiar el código por tokens, así que el canje va en tu backend. [`tools/presets-backend`](../../tools/presets-backend) lo implementa para los cuatro.

```
app ──signIn()──▶ proveedor ──https──▶ tu backend /callback ──miapp://callback──▶ app
app ──code + codeVerifier | nonce──▶ tu backend /exchange ──+ secret──▶ proveedor ──▶ perfil
```

## Uso

```ts
import { githubLogin } from '@franciscodlxdev/vue-native-oauth-presets';

const result = await githubLogin.signIn({
  clientId: 'TU_CLIENT_ID',
  redirectUri: 'https://api.miapp.com/auth/github/callback',
  callbackUri: 'miapp://callback',
});
await fetch('https://api.miapp.com/auth/github/exchange', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: result.code,
    codeVerifier: result.codeVerifier, // GitHub y Discord
    nonce: result.nonce, // Slack
    redirectUri: result.redirectUri,
  }),
});
```

También: `discordLogin`, `slackLogin`, `stravaLogin`.

| Exporta                                                                        | Para qué                                                                |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `githubLogin`, `discordLogin`, `slackLogin`, `stravaLogin`                     | `signIn`, `signOut`, `isAvailable`                                      |
| `createPresetLogin(name, overrides)`                                           | Otra instancia: otros scopes, parámetros extra o un servidor de pruebas |
| `presets.<name>.backend`                                                       | Endpoints de token, usuario, revocación y JWKS para tu backend          |
| `mapGitHubProfile`, `mapDiscordProfile`, `mapSlackProfile`, `mapStravaProfile` | Perfil normalizado `{ id, username, name, email, picture, raw }`        |

Ejemplos de ajustes:

```ts
createPresetLogin('strava', { defaultScopes: ['read', 'activity:read'] });
createPresetLogin('strava', { extraAuthParams: { approval_prompt: 'force' } });
createPresetLogin('github', { extraAuthParams: { prompt: 'select_account' } });
createPresetLogin('slack', { extraAuthParams: { team: 'T0123456' } });
```

Otro proveedor: pasa tu propio objeto en vez del nombre, `createPresetLogin({ id, authorizationEndpoint, defaultScopes, backend: { tokenEndpoint } })`.

## Backend (canje del código)

Node, completo y con pruebas: [`tools/presets-backend/server.mjs`](../../tools/presets-backend/server.mjs). Laravel, con GitHub como ejemplo:

```php
Route::get('/auth/github/callback', fn (Request $r) =>
    redirect()->away('miapp://callback?' . $r->getQueryString()));

Route::post('/auth/github/exchange', function (Request $r) {
    $tokens = Http::asForm()->acceptJson()->post('https://github.com/login/oauth/access_token', [
        'code' => $r->input('code'),
        'code_verifier' => $r->input('codeVerifier'),
        'redirect_uri' => config('services.github.redirect'), // fijo, no el que mande la app
        'client_id' => config('services.github.client_id'),
        'client_secret' => config('services.github.client_secret'),
    ])->throw()->json();

    $user = Http::withToken($tokens['access_token'])
        ->get('https://api.github.com/user')->throw()->json();

    // Crea aquí tu propia sesión para $user['id'].
    return ['profile' => $user];
});
```

Diferencias por proveedor:

- **GitHub**: pide `Accept: application/json` en el token (si no, responde form-encoded). `email` viene `null` si es privado; el principal está en `/user/emails` (scope `user:email`). El código caduca a los 10 minutos.
- **Discord**: el token solo acepta `application/x-www-form-urlencoded`.
- **Slack**: las respuestas traen `ok: true/false`; revisa `ok` además del estado HTTP. Verifica el `id_token` con `https://slack.com/openid/connect/keys`, emisor `https://slack.com` y el `nonce`.
- **Strava**: el perfil (`athlete`) llega en la respuesta de tokens. El access token dura 6 horas y el refresh token puede cambiar en cada renovación.

## Errores normalizados

`CANCELLED | NETWORK | INVALID_CONFIG | PROVIDER_ERROR | NOT_SUPPORTED`, en `error.code`; el código original del proveedor queda en `error.providerError`.

## Seguridad

- El `client_secret` y los tokens viven solo en tu backend.
- `state` siempre; PKCE donde el proveedor lo documenta (GitHub, Discord) y `nonce` en Slack.
- Discord incluye `iss` en el redirect: el paquete rechaza la respuesta si no es `https://discord.com`.
- En tu backend, el destino del reenvío y el `redirect_uri` del canje deben ser fijos, no tomados de la petición.

## Sin verificar contra los proveedores reales

- Si GitHub, Discord, Slack o Strava aceptan esquemas propios (`miapp://`) como redirect: la documentación no lo dice, y con el redirect https al backend no hace falta.
- El código de error al rechazar en GitHub, Discord y Slack (se asume `access_denied`; Strava sí lo documenta).
- Slack acepta `code_verifier` en el token pero no documenta `code_challenge` en la autorización, así que PKCE queda apagado en ese preset. Para probarlo: `createPresetLogin('slack', { usePKCE: true })`.
- Con la app de Strava instalada, el endpoint móvil puede abrir la app en vez del navegador; ese camino no se probó.

## Probar sin credenciales

`examples/demo` (Vue Native) corre todos los proveedores contra `tools/mock-idp` y los backends de `tools/`. Ver [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licencia

MIT.
