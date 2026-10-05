import type { CreateIncidentInput } from '../../domain/incidents/CloudIncident';

export const CLOUD_INCIDENT_CATEGORIES: readonly CreateIncidentInput['category'][] = [
  'electrical',
  'laboratory',
  'water',
  'connectivity',
  'equipment',
  'safety',
  'maintenance',
];
