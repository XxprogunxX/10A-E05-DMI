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
    expect(view.getByTestId('incident-INC-002')).toBeTruthy(),
  );
  await act(async () => fireEvent.press(view.getByTestId('incident-INC-002')));

  await waitFor(() =>
    expect(view.getByTestId('incident-detail-screen')).toBeTruthy(),
  );
  expect(view.getByText('Fuga en bebedero')).toBeTruthy();
  expect(
    view.getByText(
      'El bebedero mantiene un goteo constante y moja el pasillo.',
    ),
  ).toBeTruthy();

  await act(async () =>
    fireEvent.press(view.getByText('← Volver a incidencias')),
  );
  await waitFor(() =>
    expect(view.getByTestId('incident-list-screen')).toBeTruthy(),
  );
});
