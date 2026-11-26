# Backend de ejemplo para Mercado Libre

Servidor Node sin dependencias que hace las dos cosas que Mercado Libre no permite hacer desde la app:

| Ruta                               | Qué hace                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /auth/mercadolibre/callback`  | Recibe el redirect https de Mercado Libre y reenvía `code` y `state` a la app (`APP_CALLBACK`)      |
| `POST /auth/mercadolibre/exchange` | Cambia el `code` por tokens con el `client_secret` y el `code_verifier` (PKCE) y devuelve el perfil |

## Con el proveedor local

```sh
pnpm --filter @franciscodlxdev/mock-idp start
pnpm --filter @franciscodlxdev/mercadolibre-backend-example start   # puerto 4200
```

## Con Mercado Libre real

1. Crea la aplicación en el DevCenter de Mercado Libre (Mis aplicaciones) con la cuenta del país que vas a probar.
2. Expón este servidor por https (Cloudflare Tunnel, ngrok).
3. Registra `<PUBLIC_URL>/auth/mercadolibre/callback` como URI de redirect y activa PKCE en la aplicación.
4. Copia `.env.example` a `.env`, complétalo y arranca con `node --env-file=.env server.mjs`.
5. En `examples/mercadolibre-login-example/src/config.ts` pon `USE_MOCK = false`, el App ID, la URL pública y el país.

El `.env` está en `.gitignore`: el secret nunca se sube ni viaja a la app.

## Qué cambiar en un backend real

- Devuelve tu propia sesión (cookie o JWT tuyo), no el perfil tal cual.
- Guarda access y refresh token de Mercado Libre en el servidor; el refresh token es de un solo uso, guarda el nuevo en cada renovación.
- Limita intentos en `/exchange`.
