# ADR-004: Navegación local para el flujo lista–detalle

- Estado: aceptada temporalmente
- Fecha: 2026-09-14

## Contexto

El producto mínimo semanal debe abrir una incidencia desde la lista y regresar
desde su detalle. No se pide todavía una biblioteca de navegación, enlaces
profundos, restauración de rutas ni sesión por perfil.

## Alternativas

1. Incorporar desde ahora un navegador completo. Prepararía rutas futuras, pero
   agrega configuración y dependencias que no ayudan a comprobar el límite de
   arquitectura de esta semana.
2. Mantener en `App.tsx` el identificador seleccionado y alternar entre las dos
   pantallas. Cubre el flujo exigido con estado local y sin acoplar las pantallas
   a infraestructura.

## Decisión

Se elige la segunda alternativa. `IncidentListScreen` comunica la selección con
`onSelectIncident`; `App.tsx` conserva el identificador; y
`IncidentDetailScreen` usa `onBack` para regresar. Los datos se solicitan mediante
los casos de uso inyectados.

## Consecuencias

- El flujo mínimo es pequeño, observable y fácil de probar.
- Las pantallas no conocen rutas, repositorios ni proveedores.
- El estado no conserva historial ni sobrevive al reinicio de la aplicación.
- Un navegador real podrá reemplazar esta coordinación cuando los flujos de
  sesión y perfiles requieran más rutas; esa adopción deberá tener su propio ADR.

