# ADR-001: Arquitectura interna por capas con puertos y adaptadores

- Estado: aceptada
- Fecha: 2026-09-14
- Alcance: esqueleto de CampusOps para la semana 2

## Contexto

CampusOps debe crecer desde una lista y un detalle de incidencias hacia sesión,
persistencia, trabajo sin conexión y ubicación. La interfaz no debe conocer los
detalles de almacenamiento, transporte ni SDK externos. Además, el equipo
necesita probar los casos de uso sin levantar Expo o un proveedor real.

React Native, Expo y TypeScript ya están fijados por la actividad; esta decisión
se limita a la organización interna y a la dirección de sus dependencias.

## Alternativas consideradas

### Alternativa A: componentes de UI con acceso directo a proveedores

Cada pantalla obtiene datos desde una implementación concreta, por ejemplo un
repositorio en memoria hoy y un cliente HTTP o almacenamiento local después.

- Facilidad de prueba: baja. Las pruebas de presentación tendrían que preparar o
  simular cada proveedor concreto.
- Complejidad inicial: baja, porque requiere menos interfaces y archivos.
- Cambio de proveedor: costoso. Las pantallas y posiblemente la navegación
  cambiarían junto con la infraestructura.
- Riesgo: mezcla presentación, coordinación y acceso a datos, y permite una
  dependencia directa `UI -> infrastructure`.

### Alternativa B: capas con puertos del dominio y adaptadores

La UI invoca casos de uso de `application`; los casos de uso dependen de
contratos de `domain`; los adaptadores de `infrastructure` implementan esos
contratos. Un punto de composición selecciona las implementaciones concretas.

- Facilidad de prueba: alta. Un caso de uso acepta un doble que implemente
  `IncidentRepository` sin renderizar una pantalla ni usar red.
- Complejidad inicial: media. Se agregan contratos, casos de uso y un punto de
  composición incluso para un flujo pequeño.
- Cambio de proveedor: localizado. Es posible sustituir el repositorio en memoria
  por persistencia o transporte sin cambiar las pantallas ni los casos de uso.
- Riesgo: crear abstracciones anticipadas para servicios todavía fuera de alcance.
  Se mitiga implementando sólo el puerto de incidencias necesario esta semana.

## Decisión

Se adopta la alternativa B. Las dependencias permitidas son:

```text
UI -> application -> domain <- infrastructure
```

`src/composition/createAppDependencies.ts` es la raíz de composición y el único
lugar que selecciona el `InMemoryIncidentRepository`. `App.tsx` actúa como punto
de entrada: obtiene los casos de uso ya construidos y los entrega a las pantallas.
La UI no importa el adaptador concreto.

El alcance ejecutable de la semana 2 incluye `ListIncidents`,
`GetIncidentDetail`, `Incident`, `IncidentRepository`, las dos pantallas y el
adaptador en memoria. Los límites de sesión, persistencia duradera y ubicación se
documentan como previstos, pero no se implementan antes de sus hitos.

## Consecuencias y trade-off

Como beneficio, los casos de uso se prueban con implementaciones sustituibles y
un proveedor futuro puede cambiarse en la raíz de composición. También es
posible comprobar la dirección de imports de forma automática. El costo es una
estructura más explícita, con más archivos y conceptos que una pantalla conectada
directamente a los datos. El equipo acepta ese costo porque reduce el acoplamiento
en los límites que CampusOps deberá modificar en semanas posteriores.

## Comprobación

- `node tools/check-architecture.mjs` contrasta los imports entre las cuatro
  capas y rechaza, entre otras, una dependencia directa de UI a infraestructura.
- `npm run test:architecture` comprueba además que los casos de uso aceptan un
  reemplazo de `IncidentRepository`.
- `course-tests/smoke.test.tsx` comprueba la lista y el detalle con datos
  sintéticos.

