# Backend de ejemplo para Twitch

Servidor Node sin dependencias que hace las dos cosas que Twitch no permite hacer desde la app:

| Ruta                         | Qué hace                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/twitch/callback`  | Recibe el redirect https de Twitch y reenvía `code` y `state` a la app (`APP_CALLBACK`)                                |
| `POST /auth/twitch/exchange` | Cambia el `code` por tokens con el `client_secret`, verifica la firma y el `nonce` del `id_token` y devuelve el perfil |

## Con el proveedor local

```sh
pnpm --filter @franciscodlxdev/mock-idp start
pnpm --filter @franciscodlxdev/twitch-backend-example start
```

## Con Twitch real

1. Registra la aplicación en <https://dev.twitch.tv/console/apps> (tipo de cliente Confidential) y genera un Client Secret.
2. Expón este servidor por https (Cloudflare Tunnel, ngrok).
3. En "OAuth Redirect URLs" registra `<PUBLIC_URL>/auth/twitch/callback`.
4. Copia `.env.example` a `.env`, complétalo y arranca con `node --env-file=.env server.mjs`.
5. En `examples/twitch-login-example/src/config.ts` pon `USE_MOCK = false`, el Client ID y la URL pública.

El `.env` está en `.gitignore`: el secret nunca se sube ni viaja a la app.

## Qué cambiar en un backend real

- Devuelve tu propia sesión (cookie o JWT tuyo), no el perfil tal cual.
- Guarda el access token de Twitch en el servidor si lo necesitas; no lo mandes a la app.
- Twitch pide validar el access token al arrancar y cada hora (`GET https://id.twitch.tv/oauth2/validate`) si lo sigues usando.
- Limita intentos en `/exchange`.
