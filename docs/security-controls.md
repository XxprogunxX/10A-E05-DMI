# Controles de seguridad y privacidad — Semana 4

## Alcance

Estos controles implementan la reducción de TM-03 y refuerzan TM-04 del modelo de amenazas de CampusOps. Se aplican a objetos destinados a telemetría, archivos de configuración local y vistas de consulta de incidencias.

## Elección de almacenamiento seguro

Los secretos pequeños de sesión (`accessToken`, `refreshToken` y el actor asociado) se guardan mediante `expo-secure-store`, detrás del puerto `SessionStorage`. En Android, SecureStore usa almacenamiento cifrado respaldado por Android Keystore; en iOS usa Keychain. Se eligió en lugar de AsyncStorage, archivos JSON o variables `EXPO_PUBLIC_*`, porque esas alternativas no ofrecen protección adecuada para credenciales persistentes. La composición de la app usa `ExpoSecureSessionStorage` y falla de forma cerrada si el mecanismo nativo no está disponible: no existe una degradación automática a preferencias sin cifrar.

La configuración usa `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, limita el acceso al dispositivo desbloqueado y evita migrar el elemento mediante una restauración a otro equipo. El plugin configura el respaldo Android para excluir material que no podría descifrarse después de reinstalar. Sólo se conserva la sesión; incidencias, fotos y comentarios no deben colocarse en este almacén de valores pequeños.

## Clasificación mínima

| Categoría | Ejemplos | Tratamiento |
|---|---|---|
| Credenciales | `authorization`, contraseña, tokens, cookies, secretos y API keys | Sustituir el valor completo por `[REDACTED]`; nunca incluirlo en evidencia |
| Identidad | correo, nombre visible e identificadores de reportante o técnico | Redactar en telemetría |
| Datos de incidencia | ubicación, coordenadas, fotografías, evidencia, comentarios e historial de asignación | Redactar en telemetría y minimizar en vistas generales |
| Contexto técnico permitido | ID sintético de incidencia, correlación, estado, intento y duración | Conservar para diagnóstico |

## Control SC-04-01 — Sanitización antes de telemetría

- Punto común: `redactForTelemetry` en `src/course-evaluation/index.ts`.
- Profundidad: objetos y arreglos anidados.
- Variantes: las claves se comparan sin distinción de mayúsculas, guiones o guiones bajos.
- Integridad: se construye una copia y no se modifica el objeto recibido.
- Política: una clave sensible provoca la redacción de su valor completo, incluso si contiene un arreglo u objeto.
- Verificación: `course-tests/week-04-security.test.ts` y `course-tests/public/week-04.test.ts`.

## Control SC-04-02 — Exclusión de configuración privada

- `.env`, `.env.*`, keystores y llaves permanecen fuera de Git.
- La excepción `!.env.example` permite documentar únicamente nombres y valores públicos de demostración.
- Ningún nombre `EXPO_PUBLIC_*` debe contener secretos porque Expo incorpora esos valores en el cliente.
- Verificación: `git check-ignore --no-index` para variantes privadas y comprobación inversa para `.env.example`.

## Control SC-04-03 — Minimización de datos

- `IncidentSummary` contiene sólo los campos necesarios para reconocer y priorizar una incidencia.
- La ubicación no viaja al resumen ni se representa en la lista.
- El detalle conserva la ubicación, sujeto a la autorización del backend cuando se conecte la aplicación móvil al servicio.
- Verificación: prueba negativa que comprueba que el resultado de `ListIncidents` no tiene la propiedad `location`.

## Control SC-04-04 — Sesión en almacenamiento nativo seguro

- Puerto: `src/domain/session/SessionStorage.ts` evita que UI y aplicación dependan directamente de Expo y respeta `UI -> application -> domain <- infrastructure`.
- Adaptador: `ExpoSecureSessionStorage` guarda una sesión validada bajo una clave dedicada.
- Falla segura: si SecureStore no está disponible o rechaza una operación, no se usa almacenamiento plano y el error no contiene el valor, el actor ni el mensaje nativo.
- Recuperación: un valor incompleto o con formato inválido se elimina y no se convierte en una sesión autenticada.
- Cierre de sesión: `clear` elimina el elemento seguro.
- Verificación: `course-tests/week-04-session-storage.test.ts` usa un doble controlado; no usa credenciales reales.

## Pruebas negativas

El comando `npm run test:security:week4` comprueba:

1. Redacción de autorización, correo, nombre, ubicación, fotografías y comentarios.
2. Redacción dentro de arreglos y variantes con guion bajo.
3. Conservación de campos técnicos permitidos.
4. Inmutabilidad de la entrada.
5. Ausencia de ubicación en resúmenes.
6. Exclusión de variantes privadas de `.env` y conservación de `.env.example`.
7. Persistencia y eliminación mediante el puerto seguro de sesión.
8. Rechazo de una sesión corrupta y ausencia de secretos en el mensaje de error.

## Limitaciones

La lista de campos sensibles es un mínimo verificable, no autorización para registrar texto libre. Un dispositivo desbloqueado, comprometido o con una app maliciosa privilegiada todavía puede exponer información en memoria. SecureStore tampoco protege un token después de enviarlo a un servidor ni sustituye expiración, rotación, autorización o revocación. La sesión completa y la autorización por perfil todavía no están conectadas a la interfaz móvil; no deben usarse datos institucionales reales hasta completar y verificar esos controles.
