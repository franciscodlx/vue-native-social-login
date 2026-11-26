# @franciscodlxdev/vue-native-linkedin-login

Login con LinkedIn para Vue Native ([vue-native.dev](https://www.vue-native.dev), iOS y Android) con OpenID Connect, en el navegador del sistema. Sin WebView y sin `clientSecret` en la app.

## Compatibilidad

| Paquete | Vue Native       | iOS    | Android        |
| ------- | ---------------- | ------ | -------------- |
| 0.1.x   | 0.23.3 (probado) | ≥ 16.0 | ≥ 5.0 (API 21) |

## Instalación

```sh
pnpm add @franciscodlxdev/vue-native-linkedin-login @franciscodlxdev/vue-native-auth-core
npx vue-native-social-login setup --scheme miapp
```

`setup` agrega a tu app el módulo nativo del núcleo y, en Android, el esquema de tu redirect; detalles en [`vue-native-auth-core`](../auth-core#instalación).

## Configurar el proveedor

1. Crea la app en [LinkedIn Developers](https://www.linkedin.com/developers/apps) y agrega el producto **Sign In with LinkedIn using OpenID Connect**.
2. En Auth → Authorized redirect URLs registra una URL **https de tu backend**, por ejemplo `https://api.miapp.com/auth/linkedin/callback`. LinkedIn no acepta esquemas propios (`miapp://`).
3. Scopes: `openid profile email` (los que usa el paquete por defecto).

LinkedIn exige el `client_secret` para cambiar el código por tokens, así que necesitas un backend con dos rutas: una que reenvíe el redirect a tu app y otra que haga el canje. [`tools/linkedin-backend`](../../tools/linkedin-backend) es una implementación completa.

```
app ──signIn()──▶ LinkedIn ──https──▶ tu backend /callback ──miapp://callback──▶ app
app ──code──▶ tu backend /exchange ──code + secret──▶ LinkedIn ──▶ perfil
```

## Uso

```ts
import { linkedInLogin } from '@franciscodlxdev/vue-native-linkedin-login';

const result = await linkedInLogin.signIn({
  clientId: 'TU_CLIENT_ID',
  redirectUri: 'https://api.miapp.com/auth/linkedin/callback',
  callbackUri: 'miapp://callback',
});
// AuthError con code CANCELLED si el usuario cerró el navegador.
await fetch('https://api.miapp.com/auth/linkedin/exchange', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: result.code,
    redirectUri: result.redirectUri,
  }),
});
```

| Exporta                                                                                         | Para qué                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `linkedInLogin`                                                                                 | `signIn`, `signOut`, `isAvailable`                                                                               |
| `createLinkedInLogin(overrides)`                                                                | Otra instancia: parámetros extra (`extraAuthParams: { enable_extended_login: 'true' }`) o un servidor de pruebas |
| `mapLinkedInProfile(userinfo)`                                                                  | Convierte la respuesta de `/v2/userinfo` en `LinkedInProfile`                                                    |
| `LINKEDIN_TOKEN_ENDPOINT`, `LINKEDIN_USERINFO_ENDPOINT`, `LINKEDIN_JWKS_URI`, `LINKEDIN_ISSUER` | Constantes para tu backend                                                                                       |

## Backend (canje del código)

Node, completo y con pruebas: [`tools/linkedin-backend/server.mjs`](../../tools/linkedin-backend/server.mjs). Laravel:

```php
// Reenvía el redirect de LinkedIn a la app.
Route::get('/auth/linkedin/callback', fn (Request $r) =>
    redirect()->away('miapp://callback?' . $r->getQueryString()));

Route::post('/auth/linkedin/exchange', function (Request $r) {
    $tokens = Http::asForm()->post('https://www.linkedin.com/oauth/v2/accessToken', [
        'grant_type' => 'authorization_code',
        'code' => $r->input('code'),
        'redirect_uri' => config('services.linkedin.redirect'), // fijo, no el que mande la app
        'client_id' => config('services.linkedin.client_id'),
        'client_secret' => config('services.linkedin.client_secret'),
    ])->throw()->json();

    $profile = Http::withToken($tokens['access_token'])
        ->get('https://api.linkedin.com/v2/userinfo')->throw()->json();

    // Crea aquí tu propia sesión para $profile['sub'].
    return ['profile' => $profile];
});
```

## Errores normalizados

`CANCELLED | NETWORK | INVALID_CONFIG | PROVIDER_ERROR | NOT_SUPPORTED`, en `error.code`. `user_cancelled_login` y `user_cancelled_authorize` de LinkedIn llegan como `CANCELLED`; el código original queda en `error.providerError`.

## Seguridad

- El `client_secret` vive solo en tu backend; la app nunca recibe un token de LinkedIn.
- `state` se genera y verifica en el dispositivo.
- LinkedIn no documenta PKCE ni `nonce` para este flujo, así que no se envían. El flujo "native PKCE" de LinkedIn solo admite redirect a `127.0.0.1` y requiere habilitación por parte de LinkedIn, por lo que no aplica a apps móviles.
- Verifica la firma del `id_token` en el backend con `LINKEDIN_JWKS_URI` (el ejemplo lo hace).
- En tu backend, el destino del reenvío y el `redirect_uri` del canje deben ser fijos, no tomados de la petición.

## Probar sin credenciales

`examples/demo` (Vue Native) corre todos los proveedores contra `tools/mock-idp` y los backends de `tools/`. Ver [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licencia y créditos

MIT. Reescritura de [GaelCO/react-native-linkedin](https://github.com/GaelCO/react-native-linkedin), a su vez fork de `xcarpentier/react-native-linkedin` (© 2017 Xavier Carpentier), cuyo copyright se conserva en `LICENSE`.
