# Security and release status

Astro Static Studio is an open-source prototype. The current source has not passed a
production security review and should not be described as production-ready.

## Dependency audit snapshot

On 2026-11-08, `npm ci` followed by `npm audit` reported 12 findings: 3 high, 6
moderate, and 3 low. Audit findings apply to the locked dependency graph and can change
when advisories or package versions change. Re-run `npm audit` before each release.
`npm audit --omit=dev` still reports 3 high, 2 moderate, and 1 low finding: the high
Flowbite and Undici findings and the moderate Wrangler/Miniflare findings remain in the
application's runtime dependency tree. This source is a prototype, not a verified
production deployment.

### High severity

| Affected path | Package and advisory | Scope and available fix |
| --- | --- | --- |
| Admin dashboard bundle | `flowbite-react@0.12.17` → `deepmerge-ts` `<8.0.0`; [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | `flowbite-react` is imported in `apps/admin/src/dashboard.tsx`; therefore this dependency is in the browser UI path. npm offered `flowbite-react@0.10.2`, a major-version downgrade, as an automatic fix. It was not applied because compatibility and API changes require a focused review. |
| Local publishing/build tool | `wrangler@4.149.0` → `miniflare` → `undici@7.29.1`; advisories [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472), [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c), [GHSA-4w7w-5xrc-9h26](https://github.com/advisories/GHSA-4w7w-5xrc-9h26), [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx), [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm), [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6), [GHSA-55wc-3pg8-jfw6](https://github.com/advisories/GHSA-55wc-3pg8-jfw6) | Wrangler runs in the local publishing/build path and uses the affected transitive package. npm reports `wrangler@4.158.0` as a non-major update that addresses these findings. Apply only after rerunning publishing tests. |

### Other findings

The same audit reported moderate findings in `vite-plugin-pwa`/Workbox, `glob`,
`minimatch`, and Miniflare, plus low findings in `quill`, `deepmerge`, and Rollup's
node resolver. In particular, npm reports [GHSA-v3m3-f69x-jf25](https://github.com/advisories/GHSA-v3m3-f69x-jf25)
for the locked `quill@2.0.3`. Review whether the affected HTML export behavior is reachable
through the Studio editor before choosing a fix.

## Follow-up issue text

**Title:** Resolve current npm audit findings in the admin and publishing dependency paths

**Acceptance criteria:** Update or replace `flowbite-react` without major-version
regression, update Wrangler to a patched compatible version, review Quill's affected
HTML export path, and update the lockfile. `npm audit` has no high findings in these
paths; `npm run check`, `npm test`, `npm run build`, and the Cloudflare publishing tests
pass. Record remaining moderate/low findings with affected feature paths before calling
the application production-ready.
