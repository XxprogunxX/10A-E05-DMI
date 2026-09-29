import fs from 'node:fs';
import path from 'node:path';

const repository = path.resolve(__dirname, '..');

const readRepositoryFile = (relativePath: string) =>
  fs.readFileSync(path.join(repository, relativePath), 'utf8');

test('workflow de semana 04 usa el ref solicitado y fetch-depth 2', () => {
  const workflow = readRepositoryFile(
    '.github/workflows/week-04-seguridad-privacidad-feedback.yml',
  );

  expect(workflow).toContain(
    'ref: ${{ github.event.pull_request.head.sha || github.sha }}',
  );
  expect(workflow).toContain('fetch-depth: 2');
});

test('SecureStore permanece declarado como dependencia de producción', () => {
  const packageJson = JSON.parse(readRepositoryFile('package.json')) as {
    dependencies?: Record<string, string>;
  };

  expect(packageJson.dependencies?.['expo-secure-store']).toBeTruthy();
});

test('no existen mecanismos de bypass de almacenamiento seguro', () => {
  const sessionStorage = readRepositoryFile(
    'src/infrastructure/session/ExpoSecureSessionStorage.ts',
  );

  expect(sessionStorage).not.toMatch(/AsyncStorage/i);
expect(sessionStorage).not.toMatch(/localStorage/i);
expect(sessionStorage).not.toMatch(/window\.sessionStorage/i);
});

test('las variantes privadas de entorno permanecen ignoradas', () => {
  const gitignore = readRepositoryFile('.gitignore');

  expect(gitignore).toContain('.env');
expect(gitignore).toContain('.env.*');
expect(gitignore).toContain('!.env.example');
});

test('el script de seguridad mantiene activas las pruebas de semana 04', () => {
  const packageJson = JSON.parse(readRepositoryFile('package.json')) as {
    scripts?: Record<string, string>;
  };

  const script = packageJson.scripts?.['test:security:week4'];

  expect(script).toBeTruthy();
  expect(script).toContain('week-04-security.test.ts');
  expect(script).toContain('week-04-session-storage.test.ts');
  expect(script).toContain('week-04-telemetry.test.ts');
  expect(script).toContain('public/week-04.test.ts');
});