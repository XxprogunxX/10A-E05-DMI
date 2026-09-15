# ADR-002: Inyección de dependencias mediante una raíz de composición

- Estado: aceptada
- Fecha: 2026-09-14

## Contexto

Los casos de uso necesitan un `IncidentRepository`, pero no deben decidir cuál
adaptador usar. Construir el repositorio dentro de cada pantalla ocultaría esa
decisión y acoplaría la UI a infraestructura.

## Alternativas

1. Instanciar el repositorio dentro de cada pantalla. Es sencillo al principio,
   pero duplica configuración y dificulta sustituir el proveedor en pruebas.
2. Usar un contenedor global de inyección. Facilita registrar muchos servicios,
   pero introduce una dependencia y resolución implícita innecesarias para el
   tamaño actual.
3. Aplicar inyección por constructor y una raíz de composición explícita. Hace
   visibles las dependencias con poco mecanismo adicional.

## Decisión

Se elige la tercera alternativa. `ListIncidents` y `GetIncidentDetail` reciben el
puerto `IncidentRepository` por constructor. La función
`createAppDependencies` construye un adaptador predeterminado y devuelve los
casos de uso que `App.tsx` entrega a las pantallas mediante propiedades.

La raíz de composición puede recibir otro repositorio; por ello una prueba o una
configuración futura puede sustituir la infraestructura sin modificar UI,
aplicación o dominio.

## Consecuencias

- Las dependencias son explícitas y se pueden sustituir de forma determinista.
- La selección del proveedor queda concentrada en un archivo.
- `App.tsx` conoce el punto de composición, pero las pantallas sólo conocen casos
  de uso de aplicación.
- Si aparecen muchos servicios, la construcción manual crecerá; antes de agregar
  un contenedor se evaluará si esa complejidad está justificada.

