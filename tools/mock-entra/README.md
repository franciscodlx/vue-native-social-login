# mock-entra

Servidor local que imita la API de native authentication de Microsoft Entra External ID (inicio de sesión, alta y restablecimiento de contraseña), para la app de ejemplo y las pruebas. Sigue la forma de las peticiones y respuestas de la referencia de Microsoft; no es Entra: no hay MFA, límites de intentos ni correo real.

```sh
pnpm --filter @franciscodlxdev/mock-entra start   # http://localhost:4700
```

| Dato                      | Valor                                   |
| ------------------------- | --------------------------------------- |
| Client ID                 | `mock-entra-client`                     |
| Código de un solo uso     | `12345678` (siempre el mismo)           |
| Cuenta con contraseña     | `ada@example.com` / `Passw0rd!`         |
| Cuenta con código         | `otp@example.com`                       |
| Cuenta que pide navegador | `sso@example.com` (responde `redirect`) |

El alta exige el atributo `displayName` y una contraseña de 8 caracteres o más con letras y números. `handler.js` es la lógica sin HTTP; las pruebas del paquete la usan directamente.
