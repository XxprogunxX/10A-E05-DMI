import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['course-backend/server.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    COURSE_BACKEND_PORT: '0',
    COURSE_ALLOWED_ORIGINS: 'https://app.campusops.test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

function waitForAddress() {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('backend start timeout')), 10_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`backend exited before listening with code ${code}`));
    });
    child.once('error', reject);
  });
}

try {
  const baseUrl = await waitForAddress();

  const rejected = await fetch(`${baseUrl}/health`, {
    headers: { Origin: 'https://attacker.example' },
  });
  assert.notEqual(
    rejected.headers.get('access-control-allow-origin'),
    '*',
    'an untrusted website must not receive wildcard CORS permission',
  );
  assert.equal(
    rejected.headers.get('access-control-allow-origin'),
    null,
    'an untrusted origin must not receive CORS permission',
  );

  const allowed = await fetch(`${baseUrl}/health`, {
    headers: { Origin: 'https://app.campusops.test' },
  });
  assert.equal(
    allowed.headers.get('access-control-allow-origin'),
    'https://app.campusops.test',
    'the configured application origin must receive CORS permission',
  );
  assert.equal(allowed.headers.get('vary'), 'Origin');

  process.stdout.write('PASS: CORS only authorizes the configured application origin.\n');
} finally {
  child.kill();
}
