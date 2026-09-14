import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(repositoryRoot, 'src');
const layers = new Set(['ui', 'application', 'domain', 'infrastructure']);
const allowedDependencies = new Map([
  ['ui', new Set(['application'])],
  ['application', new Set(['domain'])],
  ['domain', new Set()],
  ['infrastructure', new Set(['domain'])],
]);

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const entry = resolve(directory, name);
    if (statSync(entry).isDirectory()) return sourceFiles(entry);
    return ['.ts', '.tsx'].includes(extname(entry)) ? [entry] : [];
  });
}

function layerOf(file) {
  const [firstSegment] = relative(sourceRoot, file).split(sep);
  return layers.has(firstSegment) ? firstSegment : null;
}

function relativeImports(source) {
  const imports = [];
  const expression =
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(expression)) {
    const specifier = match[1] ?? match[2];
    if (specifier?.startsWith('.')) imports.push(specifier);
  }
  return imports;
}

const violations = [];
let importsInspected = 0;

for (const file of sourceFiles(sourceRoot)) {
  const sourceLayer = layerOf(file);
  if (!sourceLayer) continue;

  for (const specifier of relativeImports(readFileSync(file, 'utf8'))) {
    importsInspected += 1;
    const targetLayer = layerOf(resolve(dirname(file), specifier));
    if (!targetLayer || targetLayer === sourceLayer) continue;
    if (!allowedDependencies.get(sourceLayer)?.has(targetLayer)) {
      violations.push(
        `${relative(repositoryRoot, file)}: ${sourceLayer} -> ${targetLayer} (${specifier})`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('Architecture boundary violation detected:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Architecture check passed: ${importsInspected} layered imports inspected; 0 forbidden dependencies.`,
  );
}
