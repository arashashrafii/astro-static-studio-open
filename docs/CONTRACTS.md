# Content and theme contracts

`packages/contracts/src/content.ts` is the single current content model. The package root exports its schema and type as `ContentSchema` and `Content`; the serialized `version: 2` field remains an internal format discriminator. Pages, Collections, collection items, and media are stored in `content/content.json` and the managed media directory.

## Validation and rendering

- The API validates current content at read and write boundaries. Writes accept only the canonical model.
- Astro receives one canonical model. `importContent()` normalizes an older file in memory before rendering; it never rewrites the file.
- `packages/contracts/content.schema.json` is generated from the same Zod `ContentSchema` in Draft-07 input mode with `npm run schema:content`. It is used by the Android validator; it is not a second hand-maintained schema.
- Zod cross-record checks are listed in `packages/contracts/content-invariants.json`. Shared accept/reject payloads are in `packages/contracts/content-schema-vectors.json`; tests ensure those vectors match Zod.
- The renderer maps supported Page blocks, Collection field presets, and direction settings to fixed Astro components. It does not render arbitrary HTML or import arbitrary Astro templates.

## Legacy import and recovery

The former entry-based document remains available only through `@astro-static-studio/contracts/legacy-v1` and the backup importer. `migrateV1ToV2()` preserves entry IDs, slugs, published state, order, media paths, alt text, and interleaved text/gallery content. The explicit migration writes a complete recovery backup, including referenced WebP media and available originals, before replacing the saved content file. A failed backup or write leaves the original file in place.

V1 backup files remain restorable so old customer data can be recovered. Restore validates the full bundle and checksums before writing; migration to the current model occurs through the same backup-first path. Unknown versions and malformed records are rejected. Do not remove old backups or media as part of schema changes.

## Local setup and publishing

- First launch can keep the bundled sample or initialize a blank site. Blank-site setup requires a downloaded pre-change backup, and the API writes its own recovery backup before replacing content.
- Source JPEG/PNG files stay in ignored local storage. Only managed WebP media is referenced by the public site.
- Backups and source originals stay local and are not included in static site output. Keep a downloaded copy outside the device.
- Theme metadata declares supported Page block types and color tokens. It does not provide a runtime theme registry or arbitrary theme selection.
- The local publisher retains the last good `apps/site/dist` when a build fails. Cloudflare Pages Direct Upload is a separate publishing step and requires owner authorization.
