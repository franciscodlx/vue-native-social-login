# Backend de ejemplo para los presets

Servidor Node sin dependencias para GitHub, Discord, Slack y Strava. Los cuatro exigen el `client_secret` para cambiar el código por tokens, así que por cada proveedor hay dos rutas:

| Ruta                              | Qué hace                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `GET /auth/<proveedor>/callback`  | Recibe el redirect https y reenvía `code` y `state` a la app (`APP_CALLBACK`) |
| `POST /auth/<proveedor>/exchange` | Cambia el `code` por tokens con el secret y devuelve el perfil                |

Lo que la app debe mandar junto con el `code`:

| Proveedor | Además del `code` y `redirectUri` | Perfil                                                         |
| --------- | --------------------------------- | -------------------------------------------------------------- |
| GitHub    | `codeVerifier` (PKCE)             | `/user`, y el correo principal de `/user/emails` si es privado |
| Discord   | `codeVerifier` (PKCE)             | `/users/@me`                                                   |
| Slack     | `nonce`                           | `id_token` verificado (firma, emisor, audiencia, `nonce`)      |
| Strava    | nada                              | `athlete` de la respuesta de tokens                            |

## Con el proveedor local

```sh
pnpm --filter @franciscodlxdev/mock-idp start
pnpm --filter @franciscodlxdev/presets-backend-example start   # puerto 4400
```

## Con proveedores reales

Puedes activar uno a la vez: un proveedor con `*_CLIENT_ID` y `*_CLIENT_SECRET` en `.env` usa el servicio real y los demás siguen contra el proveedor local.

1. Expón este servidor por https (Cloudflare Tunnel, ngrok) y pon la URL en `PUBLIC_URL`.
2. Registra `<PUBLIC_URL>/auth/<proveedor>/callback` en el proveedor:
   - GitHub: Settings → Developer settings → OAuth Apps → "Authorization callback URL".
   - Discord: Developer Portal → OAuth2 → Redirects.
   - Slack: api.slack.com/apps → OAuth & Permissions → Redirect URLs, con los scopes de usuario `openid`, `profile`, `email`.
   - Strava: strava.com/settings/api → "Authorization Callback Domain" (solo el dominio).
3. Copia `.env.example` a `.env`, complétalo y arranca con `node --env-file=.env server.mjs`.
4. En `examples/oauth-presets-example/src/config.ts` pon el Client ID del proveedor y la URL pública.

El `.env` está en `.gitignore`: los secrets nunca se suben ni viajan a la app.

## Qué cambiar en un backend real

- Devuelve tu propia sesión (cookie o JWT tuyo), no el perfil tal cual.
- Guarda los tokens del proveedor en el servidor; no los mandes a la app.
- Limita intentos en `/exchange`.
