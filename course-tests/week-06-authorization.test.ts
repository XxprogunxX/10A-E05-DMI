import {
  IncidentAuthorization,
  IncidentAuthorizationFailure,
} from '../src/application/session/IncidentAuthorization';
import type { CloudIncident } from '../src/domain/incidents/CloudIncident';

const authorization = new IncidentAuthorization();

function incident(
  overrides: Partial<CloudIncident> = {},
): CloudIncident {
  return {
    id: 'campus-inc-001',
    version: 1,
    status: 'assigned',
    category: 'connectivity',
    description: 'Incidencia ficticia',
    location: 'Edificio de prueba A',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
    priority: 'medium',
    ...overrides,
  };
}

describe('Semana 6 - autorización de operaciones por perfil', () => {
  test('reportante crea y consulta sólo sus incidencias, sin operar estados', () => {
    expect(
      authorization.can({
        actorId: 'reporter-1',
        role: 'reporter',
        permission: 'create',
      }),
    ).toBe(true);
    expect(
      authorization.can({
        actorId: 'reporter-1',
        role: 'reporter',
        permission: 'view',
        incident: incident(),
      }),
    ).toBe(true);
    expect(
      authorization.can({
        actorId: 'reporter-2',
        role: 'reporter',
        permission: 'view',
        incident: incident(),
      }),
    ).toBe(false);

    for (const permission of [
      'start',
      'resolve',
      'assign',
      'prioritize',
      'close',
      'reopen',
    ] as const) {
      expect(
        authorization.can({
          actorId: 'reporter-1',
          role: 'reporter',
          permission,
          incident: incident(),
        }),
      ).toBe(false);
    }
  });

  test('técnico sólo inicia y resuelve incidencias que tiene asignadas', () => {
    expect(
      authorization.can({
        actorId: 'technician-1',
        role: 'technician',
        permission: 'start',
        incident: incident(),
      }),
    ).toBe(true);
    expect(
      authorization.can({
        actorId: 'technician-1',
        role: 'technician',
        permission: 'resolve',
        incident: incident({ status: 'in_progress' }),
      }),
    ).toBe(true);
    expect(
      authorization.can({
        actorId: 'technician-2',
        role: 'technician',
        permission: 'start',
        incident: incident(),
      }),
    ).toBe(false);
    expect(
      authorization.can({
        actorId: 'technician-1',
        role: 'technician',
        permission: 'close',
        incident: incident({ status: 'resolved' }),
      }),
    ).toBe(false);
  });

  test('coordinación asigna y prioriza; cierra resueltas y reabre resueltas o cerradas', () => {
    for (const permission of ['assign', 'prioritize'] as const) {
      expect(
        authorization.can({
          actorId: 'coordinator-1',
          role: 'coordinator',
          permission,
          incident: incident(),
        }),
      ).toBe(true);
    }
    expect(
      authorization.can({
        actorId: 'coordinator-1',
        role: 'coordinator',
        permission: 'close',
        incident: incident({ status: 'resolved' }),
      }),
    ).toBe(true);
    expect(
      authorization.can({
        actorId: 'coordinator-1',
        role: 'coordinator',
        permission: 'close',
        incident: incident({ status: 'assigned' }),
      }),
    ).toBe(false);
    for (const status of ['resolved', 'closed'] as const) {
      expect(
        authorization.can({
          actorId: 'coordinator-1',
          role: 'coordinator',
          permission: 'reopen',
          incident: incident({ status }),
        }),
      ).toBe(true);
    }
  });

  test('la validación explícita falla antes de ejecutar una operación prohibida', () => {
    expect(() =>
      authorization.assertAuthorized({
        actorId: 'reporter-1',
        role: 'reporter',
        permission: 'resolve',
        incident: incident({ status: 'in_progress' }),
      }),
    ).toThrow(
      expect.objectContaining<Partial<IncidentAuthorizationFailure>>({
        kind: 'forbidden',
      }),
    );
  });
});
