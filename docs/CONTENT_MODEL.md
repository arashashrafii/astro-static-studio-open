# Content model and simple dashboard — proposed design

**Current model:** Pages remain separate; generic Collections hold repeatable items; Projects is a starter preset. The serialized `version: 2` field is an internal format marker for this single model. Former entry-based files are supported only through backup-first import and recovery. Focused automated contract, migration, renderer, and backup checks pass; browser migration/CRUD acceptance remains unverified.

**Status: owner-selected target model; local migration work in progress, 2026-11-04.**
The current implementation keeps Pages separate and uses generic Collections for repeatable content. The dashboard and renderer use this model. Existing entry-based content remains untouched until the owner confirms migration; the gate writes a full recovery backup before atomically replacing the content file. Migration, recovery, and browser acceptance evidence remain open.

## 1. Verified starting point (commit fdb3701)

- Local React/TypeScript/Vite dashboard + PWA shell (`apps/admin`) and loopback-only Node API (`apps/api`).
- `content/content.json` validated with Zod v1: site name/tagline/email/phone, up to 500 entries of kind `page` or `project`; entry components are only `text` or `gallery`.
- `apps/site/src/lib/content.ts` imports the JSON directly; there is **no Astro Content Layer collection** currently configured.
- `apps/site/src/pages/[...slug].astro` builds pages/project details with `getStaticPaths()`. `Projects.astro` renders a client-side category filter over all passed cards; no static list pagination exists.
- `apps/site/src/layouts/Layout.astro` hardcodes `lang="en" dir="ltr"`. Theme selection and an RTL/LTR switch are **not** implemented.
- Owner can edit content, upload images, backup/restore, build static output and use Cloudflare Pages Direct Upload; real QA preview was owner-confirmed accessible. Production publication is not validated. Android full Astro build remains unproven.

## 2. Non-technical owner journey

1. **Choose a free, approved template.** Initially offer the existing adapted Atelier template; a gallery of arbitrary Astro themes is out of scope.
2. **Set up the site.** Name, logo/contact, language and RTL/LTR where the template supports that direction. Show a live preview and plain-language labels.
3. **Edit pages.** Home/About/Contact are Pages; a new Page can add and reorder a few supported blocks.
4. **Manage collections.** Choose one of two clear forms: **Image gallery** (one image per item, optional title/date/tags) or **Content** (project, news or article with a title and detail page; cover, date, text, tags and an attached gallery as needed).
5. Each collection owns one list page and one item detail route. Set one list layout and loading choice in the collection settings. Keep the same layout throughout this initial static product; do not expose per-page layout overrides.
6. **Preview, save draft, publish.** Keep a clear distinction between saved changes, a locally generated build and a confirmed remote deployment.

The owner should not see "schema", "Content Loader", "frontmatter", "Git" or "Astro" in everyday forms. Presets seed a short guided form; do not expose a generic field builder. A page designer based on ordered predefined blocks is enough: no freehand drag-and-drop or user-defined HTML/CSS for the first release.

## 3. Domain model and language

- **Page:** one named URL with ordered view blocks; e.g. Home, About, Contact or Articles.
- **CollectionDefinition:** a named repeatable source with stable ID, list slug, detail route prefix, `kind` (`gallery` or `content`), one list layout and one loading mode. Previously stored collections default to `content`, grid and show-more when these fields are absent.
- **CollectionItem:** one record with stable ID, collection ID, internal slug, publication state, and field values. Content items require a title; gallery items require an image but may omit a display title. Gallery title/date/tags are optional. Content items use title and rich text, with optional cover, date, tags and attached gallery. Cover may reference an image from that same item's gallery. Do not expose a generic field builder.
- **Category:** belongs to **one collection**; stable ID/slug, display name, one level deep for the MVP. An item may reference more than one category in the same collection. Do not duplicate media/files or model categories as physical folders.
- **PageBlock:** a presentation object such as rich text, a standalone image, a gallery, or `collectionView`; it does not own or duplicate the collection's entries. Standalone image blocks allow upload, size, and logical alignment. Existing `collectionView` blocks retain their stored settings for compatibility, while list pages use the collection's single layout and loading setting.
- **Rich text:** a restricted structured document of paragraph/heading blocks, bold/italic marks, small/normal/large responsive size presets, logical alignment (start/center/end), and processed-media image nodes. Selected images can be inline, floated at either text edge, or block-aligned; old images without placement keep the existing output. It is not HTML. Toolbar left/right choices map to `start`/`end` using the selected site direction.
- **Legacy representation ceiling:** a rich document can represent the former maximum of 30 text components × 50,000 characters and 30 galleries × 100 images in one entry. Formatting attributes are required in serialized structured nodes so schema validation never depends on discarded nested defaults.
- **Description:** new items default to an automatic plain-text excerpt from a selected Text field; an explicit manual value overrides it. Existing v1 summaries map to manual descriptions and are never silently replaced. Automatic excerpts omit image alt text, collapse whitespace and truncate at 1,000 Unicode code points, preferring a nearby word boundary where available. A detail page must not repeat an automatic excerpt immediately above the same body.
- **Excerpt source:** a Collection selects the Text field that supplies automatic descriptions; presets choose this automatically. This avoids guessing when a Collection has more than one Text field. A manual Description overrides only that item.
- **Project starter fields:** preconfigure separate Category fields for existing categories and tags, a Gallery field for gallery controls, a rich Text field for ordered project details, and a plain Text field for release date. These are generic field types. The cover references the first existing gallery image; content fields reuse media URLs without copying image files. The local migration implements and has focused tests for preserving V1 text/gallery interleaving and gallery order; browser acceptance evidence remains open.
- **Paths and filters:** page and collection-list paths cannot use reserved root names (`admin`, `api`, `media`) or collide with each other. Collection detail paths are `<routeBase>/<itemSlug>`. A category filter names its Category field as well as category IDs, so tags and categories stay distinct.
- **Theme:** maps supported page blocks/view presets to actual Astro components. Unknown block types must fail clearly (not silently disappear).

**Collection is data; `collectionView` is a page component.** For the current simple dashboard, each collection has one canonical list page and one detail route per item. Page blocks may link to that list but do not introduce separate layout settings. Gallery items open their image detail view with previous/next navigation; content items open text-rich details.

The route `/?review=collections` remains a review-only UI mock. The default dashboard uses the live API and canonical content; the mock is not the live Collections editor.

### Approved canonical contract shape

```json
{
  "version": 2,
  "site": { "name": "Example site", "tagline": "", "email": "", "phone": "", "language": "en", "direction": "ltr" },
  "collections": [
    { "id": "00000000-0000-4000-8000-000000000001", "slug": "projects",
      "routeBase": "portfolio", "name": "Projects", "kind": "content", "listLayout": "grid",
      "loading": "show-more", "pageSize": 12, "presetId": "project",
      "excerptSourceFieldId": "00000000-0000-4000-8000-000000000007",
      "fields": [
        { "id": "00000000-0000-4000-8000-000000000002", "type": "category",
          "label": "Category", "categories": [] },
        { "id": "00000000-0000-4000-8000-000000000003", "type": "category",
          "label": "Tags", "categories": [] },
        { "id": "00000000-0000-4000-8000-000000000006", "type": "gallery",
          "label": "Gallery", "maxItems": 20 },
        { "id": "00000000-0000-4000-8000-000000000007", "type": "text",
          "label": "Project details", "format": "rich" },
        { "id": "00000000-0000-4000-8000-000000000008", "type": "text",
          "label": "Release date", "format": "plain" }
      ] }
  ],
  "items": [
    { "id": "00000000-0000-4000-8000-000000000004",
      "collectionId": "00000000-0000-4000-8000-000000000001", "slug": "intro",
      "title": "Introduction", "published": false,
      "description": { "source": "auto" }, "values": {} }
  ],
  "pages": [
    { "id": "00000000-0000-4000-8000-000000000005", "slug": "home",
      "title": "Home", "published": true, "description": { "source": "manual", "value": "" },
      "blocks": [
        { "type": "collectionView", "collectionId": "00000000-0000-4000-8000-000000000001",
          "view": "grid", "categoryFieldId": "00000000-0000-4000-8000-000000000002",
          "categoryIds": [], "sort": "manual", "limit": 12 }
      ] }
  ]
}
```

The matching Zod contract is exported as `ContentSchema` and `Content` from the package root. The API writes only canonical content. The static renderer normalizes old files in memory through the import function and does not rewrite them. Backups include media referenced by pages and collection items. Explicit migration preserves ordered text/gallery blocks and writes a complete recovery backup before replacement. When a valid legacy browser draft exists, the gate previews its mapping and stores/read-back validates the current draft before requesting persistent migration; the API writes a separate full draft backup. The original draft remains untouched. Missing referenced draft media or browser storage failure blocks migration. Rich text is rendered from validated nodes as fixed tags, never as arbitrary HTML. Browser verification of migration and CRUD remains required before closing the migration acceptance work.

## 4. Recommended Astro implementation

Astro **Content Collections** and **Content Layer loaders** are useful but do not automatically provide Studio's dashboard or user-generated field schemas.

- Keep Studio's domain model independent of theme code. Presets seed a generic Collection’s allowed field definitions and display choices; they do not create distinct project/article/photo/person storage types.
- Prefer **one file per large collection entry** when migration is justified: Astro's `glob()` loader reads JSON/Markdown files. For suitable smaller JSON arrays/definitions, `file()` can load named data with unique IDs.
- For a user-created, runtime-named collection, **do not generate a new TypeScript collection declaration on every edit**. A fixed Astro collection/loader for general entries plus collection metadata and app-side preset validation is one viable simple route. It trades some Astro per-collection static typing for runtime flexibility.
- Use `getCollection()` / `getEntry()` in Astro build-time code, then theme-aware blocks and `getStaticPaths()` for static routes. Keep the existing static hosting model. Do not add SSR merely to display public lists.
- Implement **two separate paginations**:
  1. Dashboard/API: backend reads/searches only the requested items (page/cursor, category, sort), instead of returning every entry in one JSON response. A per-entry store or index may be needed; slicing an already-loaded huge browser payload is not enough.
  2. Public site: `getStaticPaths({ paginate })` produces list/category pages such as `/articles/`, `/articles/2/`; detail routes are optional per preset. For Home, show the latest few items without pagination.
- Build-time pagination controls visitor downloads, **not** total build cost. 100,000 records/pages require separate profiling for build time, disk and asset size; don't promise this scale without evidence.
- One paginated collection-view block per Page in the initial version avoids URL collision and multiple independent pager complexity. Others use a fixed display limit.
- Whole-site RTL/LTR: map validated setting to `<html lang="..." dir="...">`, prefer CSS logical properties, and test nav order, icons, alignment and mixed-language content on every approved theme. Direction does not translate text.

Astro references:
- https://docs.astro.build/en/guides/content-collections/
- https://docs.astro.build/en/reference/content-loader-reference/
- https://docs.astro.build/en/reference/routing-reference/

## 5. Incremental migration and release safety

1. Preserve sample and customer data until the owner/tester runs the import gate. The gate creates a complete local recovery backup and exposes it for download. When an unsaved legacy draft exists, it backs up the draft and its media separately, maps it into the current browser draft, and leaves the original draft key untouched.
2. Verify import/recovery, Pages/Collections/item CRUD, old and current backup restore, public routes, collection views, RTL/LTR, and keyboard/touch behavior in a browser at desktop and mobile sizes.
3. Keep old backup import supported. Reject unknown content formats and malformed routes/fields before writing; never silently drop unsupported blocks.
4. Add dashboard/API paging only when the current 500-entry limit is raised; do not add a remote database or SaaS backend for the local MVP.
5. Production publication still requires explicit owner confirmation and verification.

## 6. Product exclusions for the first redesign

No arbitrary schema builder, arbitrary third-party template import, nested categories, visual freeform layout editor, custom user HTML/CSS, online shared CMS, multi-user workflow, or assumption that a prepared Android APK can run a full Astro build.
