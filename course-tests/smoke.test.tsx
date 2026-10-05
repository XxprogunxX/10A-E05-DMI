import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import App from '../App';

jest.setTimeout(30_000);

jest.mock('../src/api/courseBackend', () => ({
  getBackendHealth: jest.fn().mockResolvedValue({
    ok: true,
    service: 'dmi-controlled-backend',
    contractVersion: 1,
  }),
}));

jest.mock('../src/composition/createAppDependencies', () => ({
  createAppDependencies: jest.fn(() => ({
    listIncidents: { execute: jest.fn().mockResolvedValue([]) },
    getIncidentDetail: {
      execute: jest.fn().mockResolvedValue(null),
    },
    listCloudIncidents: {
      execute: jest.fn().mockResolvedValue({
        kind: 'available',
        incidents: [
          {
            id: 'campus-inc-001',
            version: 1,
            status: 'open',
            category: 'connectivity',
            description: 'Sin conexión en laboratorio ficticio',
            location: 'Laboratorio ficticio',
            priority: 'medium',
          },
        ],
      }),
    },
    getCloudIncident: {
      execute: jest.fn().mockResolvedValue({
        kind: 'available',
        incident: {
          id: 'campus-inc-001',
          version: 1,
          status: 'open',
          category: 'connectivity',
          description: 'Sin conexión en laboratorio ficticio',
          location: 'Laboratorio ficticio',
          priority: 'medium',
        },
      }),
    },
    createCloudIncident: {
      execute: jest.fn(),
    },
    sessionStorage: {
      getAccessToken: jest.fn(),
      getRefreshToken: jest.fn(),
      getActorId: jest.fn(),
      saveSession: jest.fn(),
      clear: jest.fn(),
    },
    reportTechnicalError: {
      execute: jest.fn(),
    },
  })),
}));

test('renders the reproducible baseline and resolves backend state', async () => {
  const view = await render(<App />);

  expect(view.getByText('CampusOps')).toBeTruthy();

  await waitFor(() =>
    expect(
      view.getByTestId('backend-status').props.children.join(''),
    ).toContain('available'),
  );

  await waitFor(() =>
    expect(view.getByTestId('incident-list-screen')).toBeTruthy(),
  );
});

test('opens the deterministic incident list and detail', async () => {
  const view = await render(<App />);

  await waitFor(() =>
    expect(view.getByTestId('incident-campus-inc-001')).toBeTruthy(),
  );

  await act(async () =>
    fireEvent.press(view.getByTestId('incident-campus-inc-001')),
  );

  await waitFor(() =>
    expect(view.getByTestId('incident-detail-screen')).toBeTruthy(),
  );

  expect(view.getByText('Sin conexión en laboratorio ficticio')).toBeTruthy();

  await act(async () =>
    fireEvent.press(view.getByText('← Volver a incidencias')),
  );

  await waitFor(() =>
    expect(view.getByTestId('incident-list-screen')).toBeTruthy(),
  );
});
