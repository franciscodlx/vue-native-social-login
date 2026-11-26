# Backend de ejemplo para Telegram

Servidor Node sin dependencias que hace las dos cosas que Telegram no permite hacer desde la app:

| Ruta                           | Qué hace                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/telegram/callback`  | Recibe el redirect https de Telegram y reenvía `code` y `state` a la app (`APP_CALLBACK`)                                 |
| `POST /auth/telegram/exchange` | Cambia el `code` por tokens (Client Secret por HTTP Basic + `code_verifier`), verifica el `id_token` y devuelve el perfil |

Telegram no tiene endpoint de userinfo: el perfil son los claims del `id_token` verificado.

## Con el proveedor local

```sh
pnpm --filter @franciscodlxdev/mock-idp start
pnpm --filter @franciscodlxdev/telegram-backend-example start   # puerto 4500
```

## Con Telegram real

1. En @BotFather elige tu bot → "Login Widget". Ahí aparecen el Client ID y el Client Secret.
2. Expón este servidor por https (Cloudflare Tunnel, ngrok).
3. En "Allowed URLs" agrega `<PUBLIC_URL>/auth/telegram/callback`.
4. Copia `.env.example` a `.env`, complétalo y arranca con `node --env-file=.env server.mjs`.
5. En `examples/telegram-login-example/src/config.ts` pon `USE_MOCK = false`, el Client ID y la URL pública.

El `.env` está en `.gitignore`: el secret nunca se sube ni viaja a la app.

Este ejemplo solo verifica firmas RS256, que es el algoritmo por defecto de Telegram. Si en BotFather eliges ES256, EdDSA o ES256K, usa una librería JOSE.

## Qué cambiar en un backend real

- Devuelve tu propia sesión (cookie o JWT tuyo), no el perfil tal cual.
- Limita intentos en `/exchange`.
