import { GetIncidentDetail } from '../src/application/incidents/GetIncidentDetail';
import { ListIncidents } from '../src/application/incidents/ListIncidents';
import type { Incident } from '../src/domain/incidents/Incident';
import type { IncidentRepository } from '../src/domain/incidents/IncidentRepository';

const replacementIncident: Incident = {
  id: 'TEST-001',
  title: 'Proveedor sustituido',
  description: 'Dato controlado para comprobar la inyección del puerto.',
  category: 'Prueba',
  location: 'Campus ficticio',
  status: 'open',
  priority: 'low',
  reportedAt: '2026-09-14T12:00:00-06:00',
};

class StubIncidentRepository implements IncidentRepository {
  async list(): Promise<readonly Incident[]> {
    return [replacementIncident];
  }

  async getById(id: string): Promise<Incident | null> {
    return id === replacementIncident.id ? replacementIncident : null;
  }
}

test('application use cases accept a replacement repository through the domain port', async () => {
  const repository = new StubIncidentRepository();
  const listIncidents = new ListIncidents(repository);
  const getIncidentDetail = new GetIncidentDetail(repository);

  await expect(listIncidents.execute()).resolves.toEqual([
    expect.objectContaining({ id: 'TEST-001', title: 'Proveedor sustituido' }),
  ]);
  await expect(getIncidentDetail.execute('TEST-001')).resolves.toEqual(
    replacementIncident,
  );
  await expect(getIncidentDetail.execute('missing')).resolves.toBeNull();
});
