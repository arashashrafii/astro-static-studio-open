# Product Vision

## Mission
Make static websites easy to manage for people who are not developers. An artist, photographer, writer, or small-business owner should be able to update a personal website from a phone, without using Astro, Git, a terminal, or a hosting dashboard.

## Product definition
Astro Static Studio is a **local content-management and publishing tool**, not a replacement for Astro and not a new general-purpose website framework. Astro generates the public static website. Studio runs on the owner's device, stores content locally, builds the static output locally, and does not require a Studio-operated server or database.

The public source includes a neutral content fixture and a supported Astro renderer. Customer site content and media belong in separate site repositories and are not included here.

## Main audiences
- **Site owner (non-technical):** Manages pages, projects, photos, galleries, contact details, supported layouts, and publishing. The first release is local and single-user, so separate roles and sign-in are unnecessary.

For now, each customer has a separate installation and content repository. A central multi-tenant SaaS platform is not a requirement.

## Core user journey
1. Open Studio locally on a computer (the current implemented workflow). Android packaging is a later, unverified product target.
2. Edit Pages and Projects in the current version; a future guided setup will offer an approved template and separate Collections.
3. Edit plain-language forms and upload photos.
4. Preview and save content locally.
5. Select a supported publishing destination and authorize it.
6. Studio validates the content, builds static HTML locally, publishes it, and reports success or an actionable error.

## Platform experience
Desktop users run the local dashboard with Node.js/npm, currently via a loopback-only API. Android is the first packaged target but is not supported as a working Studio product yet; iOS follows only after Android is validated. Desktop installers are unnecessary if Node.js/npm can start Studio. Full Astro builds on Android are not yet proven; the existing Android experiment is not the product app and does not validate this requirement.

Mobile design rules: touch-friendly controls, short forms, clear labels, minimal navigation, image upload from the photo library or camera, progress indicators, and recoverable editing. Test on real small screens, not only desktop simulation.

## Product principles
1. Simple by default; technical settings stay out of the owner's daily workflow.
2. Separate content from presentation, so data remains portable.
3. Start with one working Astro template and allow more *adapted* templates later.
4. Public site output is static HTML/CSS and optional client-side JavaScript.
5. Publishing should be a one-click user action, not a manual Git task.
6. Avoid Studio-operated services, subscriptions, and custom frameworks.

## Not in the first release
Visual drag-and-drop design editor, arbitrary third-party template imports, iOS before Android succeeds, multi-tenant hosting platform, complex workflows, real-time collaboration, e-commerce, and hosted build infrastructure.

## Success signals
Target acceptance (not yet demonstrated by a non-technical usability test): a user can update a gallery, edit Contact, preview, and publish without developer help. They can complete the same core tasks on desktop. Content survives a supported theme change in a controlled test. Publishing reports success or failure accurately.

## Open questions (validate during prototype)
Full Astro build feasibility on Android, first deployment destination, secure local authorization for publishing, image quality limits, and rollback behavior remain open. Do not treat these as settled choices.

## Proposed next product experience — not yet implemented

1. Pick an **approved free template**; start with the bundled Atelier theme, add another only after compatibility testing.
2. Enter the site name, logo/contact details, content language, and whole-site direction (RTL or LTR) when the theme supports it.
3. Manage **Pages** (one-off Home, About, Contact) and **Collections** (repeatable articles, projects, photos, people) with guided, preset forms.
4. A page can add simple blocks: rich text, image, and **collection view**. The collection is data; the view block chooses a presentation such as cards, list, or gallery.
5. Set one-level categories inside each collection; preview and publish the resulting **static** pages.

Hide the words schema, Astro, deployment logs, and source control from the ordinary editing flow. Do not introduce freeform drag-and-drop or arbitrary field/schema building in the first iteration.

This direction is described in [CONTENT_MODEL.md](CONTENT_MODEL.md). It must not be mistaken for an implemented feature or an approved breaking change to Content v1.
