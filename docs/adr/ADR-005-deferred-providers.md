# ADR-005: Diferir sesión, persistencia y ubicación reales

- Estado: aceptada
- Fecha: 2026-09-14

## Contexto

CampusOps necesitará sesión para tres perfiles, persistencia y sincronización de
incidencias, y un proveedor de ubicación. La aclaración de la semana 2 pide
representar esos límites, pero señala que no deben implementarse todavía.

## Alternativas

1. Integrar inmediatamente autenticación, almacenamiento y geolocalización. Esto
   produciría más código ejecutable, pero mezclaría varios riesgos, permisos y
   fallas externas antes de definir sus contratos y pruebas.
2. Mostrar sus límites previstos en el diagrama y crear implementaciones sólo
   cuando un caso de uso del hito las necesite. Así se evita una abstracción sin
   comportamiento verificable.

## Decisión

Se difieren los proveedores reales. El diagrama reserva responsabilidades para:

- sesión de Reportante, Técnico y Coordinador mediante un puerto de sesión;
- persistencia local y sincronización detrás de puertos de repositorio;
- ubicación detrás de un puerto de ubicación, sin importar un SDK desde UI.

Esta semana sólo se implementa el puerto `IncidentRepository` y su adaptador en
memoria, porque son necesarios para la lista y el detalle. Los demás elementos se
marcan como previstos y no se simulan como si ya estuvieran terminados.

## Consecuencias

- El equipo mantiene el alcance y evita permisos, credenciales o datos reales.
- La dirección de dependencias futura queda explícita desde ahora.
- No existe aún autenticación, persistencia duradera, sincronización ni lectura de
  ubicación; el diagrama no debe interpretarse como evidencia de esas funciones.
- Cada integración futura deberá implementar un contrato interno, incluir dobles
  controlados y registrar su propia decisión técnica cuando se elija proveedor.

