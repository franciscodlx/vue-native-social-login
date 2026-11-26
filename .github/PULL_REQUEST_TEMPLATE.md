## Qué cambia

<!-- Una o dos líneas. Enlaza el issue si existe: "Cierra #123". -->

## Cómo lo probaste

- [ ] `pnpm test`, `pnpm typecheck` y `pnpm lint`
- [ ] En dispositivo o emulador con la app demo contra `tools/mock-idp` (aprobar, cerrar el navegador y rechazar)
- [ ] Con el proveedor real (indica cuál)

Plataformas: <!-- iOS / Android -->

## Checklist

- [ ] Un cambio de comportamiento lleva su prueba.
- [ ] Documentación actualizada (README del paquete) si cambia la API o la configuración.
- [ ] Changesets: cada PR con cambios publicables lleva su `pnpm changeset`.
- [ ] Sin secrets, tokens ni `.env` en el diff.
