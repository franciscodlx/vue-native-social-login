# @franciscodlxdev/vue-native-entra-native-auth

Native authentication de Microsoft Entra External ID para Vue Native ([vue-native.dev](https://www.vue-native.dev), iOS y Android): alta, inicio de sesión y restablecimiento de contraseña con tus propias pantallas, sin abrir el navegador. Es un cliente de la API de Microsoft, no un envoltorio de los SDK MSAL nativos.

## Compatibilidad

| Paquete | Vue Native       | iOS    | Android        |
| ------- | ---------------- | ------ | -------------- |
| 0.1.x   | 0.23.3 (probado) | ≥ 16.0 | ≥ 5.0 (API 21) |

## Instalación

```sh
pnpm add @franciscodlxdev/vue-native-entra-native-auth @franciscodlxdev/vue-native-auth-core
npx vue-native-social-login setup --scheme miapp
```

`setup` agrega a tu app el módulo nativo del núcleo y, en Android, el esquema de tu redirect; detalles en [`vue-native-auth-core`](../auth-core#instalación).

## Configurar el proveedor

Solo funciona con **tenants externos** (External ID), no con tenants de empleados.

1. Registra la app en el tenant externo y concede el consentimiento de administrador.
2. En Authentication activa **Allow public client flows** y **Enable native authentication**.
3. Crea un user flow (correo con contraseña o correo con código de un solo uso) y asócialo a la app.
4. Para restablecer contraseñas, activa el self-service password reset para clientes.
5. Para el fallback al navegador, registra un redirect URI (`miapp://callback`).

## Uso

Cada llamada devuelve el siguiente paso; tu pantalla muestra lo que ese paso pide y devuelve el paso completo a la siguiente función.

```ts
import { createEntraNativeAuth } from '@franciscodlxdev/react-native-entra-native-auth';

const auth = createEntraNativeAuth({
  tenantSubdomain: 'contoso', // contoso.onmicrosoft.com
  clientId: 'TU_CLIENT_ID',
});

let step = await auth.signIn({ username: email, password });

switch (step.type) {
  case 'signed_in': // step.tokens: accessToken, idToken, refreshToken, profile
    break;
  case 'code_required': // se envió un código a step.sentTo
    step = await auth.submitCode(step, codigo);
    break;
  case 'password_required':
    step = await auth.submitPassword(step, password);
    break;
  case 'browser_required': // Entra pide continuar en el navegador
    const tokens = await auth.signInWithBrowser({
      redirectUri: 'miapp://callback',
      loginHint: step.username,
    });
    break;
}
```

| Método                                           | Qué hace                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `signIn({ username, password? })`                | Con contraseña, o con código por correo si se omite                  |
| `signUp({ username, password?, attributes? })`   | Alta; envía un código al correo                                      |
| `resetPassword({ username })`                    | Envía el código para restablecer                                     |
| `submitCode(step, code)` / `resendCode(step)`    | Responde a `code_required`                                           |
| `submitPassword(step, password)`                 | Responde a `password_required`                                       |
| `submitAttributes(step, attributes)`             | Responde a `attributes_required` (ver `step.requiredAttributes`)     |
| `submitNewPassword(step, newPassword)`           | Responde a `new_password_required`; espera al cambio e inicia sesión |
| `refresh(refreshToken)`                          | Nuevo access token                                                   |
| `signInWithBrowser({ redirectUri, loginHint? })` | Fallback: código de autorización + PKCE en el navegador del sistema  |

| Paso (`step.type`)      | Qué mostrar                                   |
| ----------------------- | --------------------------------------------- |
| `code_required`         | Campo para el código (`sentTo`, `codeLength`) |
| `password_required`     | Campo de contraseña                           |
| `attributes_required`   | Los campos de `requiredAttributes`            |
| `new_password_required` | Campo de contraseña nueva                     |
| `browser_required`      | Botón para continuar en el navegador          |
| `signed_in`             | Nada: ya hay tokens                           |

Los scopes por defecto son `openid offline_access` (id_token y refresh token); cámbialos con `scopes`.

### Cerrar sesión

La API no tiene llamada de cierre de sesión: borra los tokens que guardaste.

## Errores

`EntraAuthError` extiende el `AuthError` de la familia (`CANCELLED | NETWORK | INVALID_CONFIG | PROVIDER_ERROR | NOT_SUPPORTED`) y agrega el detalle de Entra. `error.reason` sirve para un `switch`:

| `reason`                                                                                                                      | Significado                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `user_not_found`                                                                                                              | No existe la cuenta                             |
| `user_already_exists`                                                                                                         | El correo ya está registrado                    |
| `invalid_grant`                                                                                                               | Usuario o contraseña incorrectos                |
| `invalid_grant:invalid_oob_value`                                                                                             | Código incorrecto                               |
| `invalid_grant:password_too_weak`, `:password_too_short`, `:password_too_long`, `:password_recently_used`, `:password_banned` | La contraseña no cumple la política             |
| `invalid_grant:attribute_validation_failed`                                                                                   | Atributos inválidos (`error.invalidAttributes`) |
| `expired_token`                                                                                                               | El paso caducó: empieza el flujo de nuevo       |

Un `client_id` o tenant incorrecto, o native authentication sin activar, llega como `INVALID_CONFIG`. `error.traceId` y `error.correlationId` sirven para soporte de Microsoft.

## Backend

No hace falta backend para iniciar sesión: la app es un cliente público. Tu API debe validar el access token (firma con las claves del tenant, `aud` y `exp`) como con cualquier token de Entra. El paquete solo decodifica el `id_token` para armar `profile`; no verifica su firma.

## Seguridad

- Con native authentication la contraseña pasa por tu app: no la guardes ni la registres en logs, y envíala solo a través de este cliente (HTTPS).
- Guarda los tokens en Keychain/Keystore, no en AsyncStorage.
- El `continuationToken` de cada paso es de un solo uso y de vida corta; no lo persistas.
- Todas las peticiones ofrecen `redirect`, como exige Microsoft: si Entra no puede terminar por API, responde `browser_required` en vez de fallar.

## Límites de esta versión

- **MFA**: el cliente no declara la capacidad `mfa_required`, así que si la política exige segundo factor Entra responde `browser_required` y el flujo termina en el navegador.
- **Restablecimiento de contraseña**: los parámetros de `start`, `challenge`, `continue` y `submit` no pudieron contrastarse con la referencia de Microsoft (esa parte de la página no se pudo leer); están implementados según el mismo patrón que alta e inicio de sesión.
- No hay SSO entre apps a través del navegador con native authentication.
- No funciona en web: la API no admite CORS.
- Nada se ha probado contra un tenant real.

## Probar sin tenant

`examples/demo` (Vue Native) corre contra [`tools/mock-entra`](../../tools/mock-entra), un servidor local que imita la API. Ver [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licencia

MIT.
