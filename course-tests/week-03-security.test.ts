import { readFileSync } from 'node:fs';

const model = readFileSync('docs/threat-model.md', 'utf8').toLowerCase();

test('threat model contains the four required traceable threats', () => {
  for (const id of ['tm-01', 'tm-02', 'tm-03', 'tm-04']) {
    expect(model).toContain(id);
  }

  for (const concept of [
    'activo',
    'frontera de confianza',
    'control',
    'verificación',
    'riesgo residual',
  ]) {
    expect(model).toContain(concept);
  }
});

test('threat model covers required scenarios using fictitious data', () => {
  for (const threat of [
    'consultar incidencias ajenas',
    'alterar asignaciones',
    'filtrar tokens',
    'exponer credenciales',
  ]) {
    expect(model).toContain(threat);
  }

  expect(model).toContain('datos completamente ficticios');
});
