import { readFileSync } from 'node:fs';

const workflowPath = '.github/workflows/week-03-ci-amenazas-feedback.yml';

test('week 03 workflow checks the exact revision with sufficient history', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  expect(workflow).toContain(
    'ref: ${{ github.event.pull_request.head.sha || github.sha }}',
  );
  expect(workflow).toMatch(/fetch-depth:\s*2/);
  expect(workflow).toMatch(/permissions:\s*\n\s*contents:\s*read/);
});

test('week 03 workflow keeps mandatory checks and evidence artifacts active', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  for (const command of [
    'make setup',
    'npm run bundle:release',
    'make verify-week-03',
    'make public-test-week-03',
    'make evidence-week-03',
  ]) {
    expect(workflow).toContain(`run: ${command}`);
  }

  expect(workflow).toMatch(/uses:\s*actions\/upload-artifact@v4/);
  expect(workflow).toMatch(/if:\s*always\(\)/);
  expect(workflow).toContain('reports/week-03/**');
  expect(workflow).toContain('evidence/week-03/**');
  expect(workflow).not.toMatch(
    /\|\|\s*true|continue-on-error:\s*true|--passWithNoTests/i,
  );
});
