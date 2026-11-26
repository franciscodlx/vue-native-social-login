# Backend de ejemplo para LinkedIn

Servidor Node sin dependencias que hace las dos cosas que LinkedIn no permite hacer desde la app:

| Ruta                           | Qué hace                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `GET /auth/linkedin/callback`  | Recibe el redirect https de LinkedIn y reenvía `code` y `state` a la app (`APP_CALLBACK`)                 |
| `POST /auth/linkedin/exchange` | Cambia el `code` por tokens con el `client_secret`, verifica la firma del `id_token` y devuelve el perfil |

## Con el proveedor local

```sh
pnpm --filter @franciscodlxdev/mock-idp start
pnpm --filter @franciscodlxdev/linkedin-backend-example start
```

## Con LinkedIn real

1. Crea la app en <https://www.linkedin.com/developers/apps> y agrega el producto "Sign In with LinkedIn using OpenID Connect".
2. Expón este servidor por https. Lo más rápido es un túnel temporal de Cloudflare (`brew install cloudflared`):

   ```sh
   cloudflared tunnel --url http://localhost:4100
   ```

   La URL `https://….trycloudflare.com` que imprime es tu `PUBLIC_URL`. Cambia cada vez que reinicias el túnel, y entonces hay que registrarla de nuevo en LinkedIn.

3. En Auth → "Authorized redirect URLs" registra `<PUBLIC_URL>/auth/linkedin/callback`.
4. Copia `.env.example` a `.env`, complétalo y arranca con `node --env-file=.env server.mjs`.
5. En `examples/linkedin-login-example/src/config.ts` pon `USE_MOCK = false`, el Client ID y la URL pública.

Si el navegador muestra `redirect_uri does not match the registered value`, la URL registrada en LinkedIn no es idéntica a `<PUBLIC_URL>/auth/linkedin/callback` (revisa `https`, la ruta y que no sobre una `/` al final). El backend imprime al arrancar la URL exacta que usa.

El `.env` está en `.gitignore`: el secret nunca se sube ni viaja a la app.

## Qué cambiar en un backend real

- Devuelve tu propia sesión (cookie o JWT tuyo), no el perfil tal cual.
- Guarda el access token de LinkedIn en el servidor si lo necesitas; no lo mandes a la app.
- Limita intentos en `/exchange`.
