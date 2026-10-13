# Starter security status

## Current baseline — 2026-10-12, compatible maintenance

The lockfile reports **0 critical, 24 high and 5 moderate** production dependency findings in `npm audit --omit=dev`; the course gate `npm audit --omit=dev --audit-level=critical` passes. A compatible non-forced `npm audit fix --omit=dev` removed the critical `shell-quote` finding, and `npm ci` restored the complete reproducible development environment.

- Expo remains on SDK 57 and resolves to 57.0.28. React Native 0.86.2, React 19.2.3, TypeScript 6 and Node 22.22.0 remain unchanged.
- The remaining high/moderate reports are visible in npm output and currently require forced breaking downgrades according to npm; none were suppressed.
- No `--force`, advisory suppression, disabled test or weaker quality gate was used. Keep the supplied lockfile and install with `npm ci`.
- Reaudit after changes and before release. Passing the critical threshold is a dated result, not a guarantee of security. Untrusted code still requires disposable, isolated execution without instructor secrets.

Upstream fixes: [Metro 0.84.5](https://github.com/react/metro/releases/tag/v0.84.5) and [uuid 11.1.1](https://github.com/uuidjs/uuid/releases/tag/v11.1.1).

## Historical baseline — superseded by the current section

Audit date: 2026-08-21.

The clean operational re-audit with Node 22.22.0 reports 0 critical, 8 high, 7 medium and 0 low vulnerable package findings. The only direct finding is `expo` (high) because it brings the affected build-tool graph; the remaining findings are transitive. The concrete advisory roots exposed by npm are two high-severity `image-size` denial-of-service issues used through Metro and one medium-severity `uuid` bounds-check issue used through the Xcode/config tooling.

A non-forced `npm audit fix --package-lock-only` was tested in a temporary copy. It reduced none of the 15 findings. npm's remaining proposal changes Expo 57 to Expo 53 as a semver-major/breaking remediation; that would violate the selected React Native baseline and was not applied. The complete direct/transitive classification is stored in `reports/operational/dependency-audit.json` in the instructor workspace.

Operational treatment:

- CI fails on any critical advisory and preserves the complete audit output as evidence.
- High/medium findings remain visible and must be re-audited before the starter is released and after any lockfile change.
- Student repositories execute only in isolated, disposable runners without production credentials, host secrets, Docker socket or trusted caches.
- Untrusted images/artifacts are not opened on the instructor host; Metro, build and artifact inspection run in the isolated checkout.
- A dependency update requires a recorded decision plus typecheck, lint, tests, hidden checks and release build validation.

This is a documented toolchain risk, not evidence that a student submission is secure.
### Historical CampusOps recheck — 2026-08-25, before remediation

Before remediation, `npm audit --omit=dev --json` with the unchanged lockfile reported 0 critical, 5 high, 10 medium and 0 low affected package findings (15 total). That was a registry reclassification, not a remediation: no dependency or lockfile version changed during contextualization. The direct finding was Expo (medium); all 5 high findings were transitive in the image-size/Metro toolchain. This historical result is superseded by the compatible maintenance documented at the top.
