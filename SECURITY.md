# Seguridad

## Reportar una vulnerabilidad

No abras un issue público. Usa "Report a vulnerability" en la pestaña Security del repositorio (GitHub Security Advisories). Incluye versión del paquete, plataforma y pasos para reproducir.

Respuesta inicial: 7 días. Se publica la corrección y después el aviso.

## Versiones con soporte

Solo la última versión menor de cada paquete recibe correcciones de seguridad.

## Qué garantiza el núcleo

- El `clientSecret` nunca viaja en la app: el flujo es authorization code + PKCE (S256).
- `state` se genera con el CSPRNG de la plataforma y se verifica antes de aceptar un código.
- El redirect se compara con el `redirectUri` configurado (esquema, host y ruta).
- El login ocurre en el navegador del sistema; la app no ve la contraseña ni las cookies.

## Qué queda de tu lado

- Verificar la firma del `id_token` en tu backend (la app solo revisa `iss`, `aud`, `exp` y `nonce`).
- Guardar tokens en Keychain / Keystore, nunca en AsyncStorage.
- Preferir Universal Links / App Links a esquemas propios: otro app puede registrar el mismo esquema.
