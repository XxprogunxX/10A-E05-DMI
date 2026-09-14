import type { Incident } from '../../domain/incidents/Incident';
import type { IncidentRepository } from '../../domain/incidents/IncidentRepository';

const FIXTURES: readonly Incident[] = [
  {
    id: 'INC-001',
    title: 'Proyector sin señal',
    description:
      'El proyector enciende, pero no detecta la computadora del aula.',
    category: 'Equipo',
    location: 'Edificio B · Aula 204',
    status: 'open',
    priority: 'medium',
    reportedAt: '2026-09-14T09:15:00-06:00',
  },
  {
    id: 'INC-002',
    title: 'Fuga en bebedero',
    description: 'El bebedero mantiene un goteo constante y moja el pasillo.',
    category: 'Agua',
    location: 'Edificio A · Planta baja',
    status: 'assigned',
    priority: 'high',
    reportedAt: '2026-09-14T10:40:00-06:00',
  },
  {
    id: 'INC-003',
    title: 'Punto de red intermitente',
    description:
      'La conexión cableada se pierde de forma intermitente durante la clase.',
    category: 'Conectividad',
    location: 'Laboratorio 3',
    status: 'in_progress',
    priority: 'low',
    reportedAt: '2026-09-13T16:20:00-06:00',
  },
];

export class InMemoryIncidentRepository implements IncidentRepository {
  constructor(private readonly incidents: readonly Incident[] = FIXTURES) {}

  async list(): Promise<readonly Incident[]> {
    return this.incidents.map((incident) => ({ ...incident }));
  }

  async getById(id: string): Promise<Incident | null> {
    const incident = this.incidents.find((candidate) => candidate.id === id);
    return incident ? { ...incident } : null;
  }
}
