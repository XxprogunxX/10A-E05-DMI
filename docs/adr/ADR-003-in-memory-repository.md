# ADR-003: Repositorio determinista de incidencias en memoria

- Estado: aceptada temporalmente
- Fecha: 2026-09-14

## Contexto

La semana 2 exige una lista y un detalle ejecutables con información ficticia,
pero excluye integrar backend, persistencia real y cola sin conexión. Aun así, el
flujo debe ejercitar el mismo límite que usará un proveedor posterior.

## Alternativas

1. Declarar los datos directamente en las pantallas. Reduce archivos, pero evita
   comprobar el puerto y acopla la presentación al origen de datos.
2. Consumir desde ahora el backend del curso. Se acerca al escenario futuro, pero
   agrega red, errores y configuración fuera del alcance semanal.
3. Implementar `IncidentRepository` con datos sintéticos en memoria. Mantiene el
   flujo determinista y ejercita el contrato sin anticipar integraciones.

## Decisión

Se usa `InMemoryIncidentRepository`, que implementa el puerto del dominio y
contiene únicamente incidencias ficticias. `list` y `getById` devuelven copias
para impedir que un consumidor modifique accidentalmente las fixtures
compartidas. Un identificador inexistente produce `null` como resultado esperado.

## Consecuencias

- Las pruebas son rápidas, repetibles y no requieren conectividad.
- La lista y el detalle demuestran una ruta ejecutable a través de todas las
  capas.
- Los datos se reinician con cada instancia y no representan persistencia real.
- Cuando corresponda integrar almacenamiento o API, se añadirá otro adaptador del
  mismo puerto y se cambiará su selección en la raíz de composición.

