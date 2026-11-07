# Astro Static Studio

A local-first content studio for managing an Astro static website. The repository contains the Studio application, its Astro renderer, and a neutral content fixture for local development. Site-owner content and media belong in a separate private site repository.

**Content model:** The current workspace uses one Pages-and-Collections content model. Its serialized `version: 2` field is an internal format marker. Older entry-based files are accepted only by the backup-first importer; there is no separate legacy editing or rendering model. Browser migration/CRUD acceptance remains unverified. See [Content contracts](docs/CONTRACTS.md).

## Run locally

Requirements: Node.js 22+ and npm.

```sh
npm install
npm run dev
```

Open the dashboard at `http://127.0.0.1:5173`. The Astro preview runs at `http://127.0.0.1:4321`; a loopback-only local API at `127.0.0.1:4322` saves validated content and media, and runs the static build. Keep the development processes running while editing/building.

```sh
npm run check
npm test
npm run build
```

The current desktop slice is a local single-site editor with Pages and Collections, text and galleries, draft recovery, WebP media conversion, Astro static output, and a PWA dashboard shell. Site builds go to a temporary directory first; a failed build leaves the previous successful output intact. Cloudflare Pages Direct Upload and a preview deployment flow are implemented. Production publishing has not been verified. A native Android prototype is included under `experiments/android-launch`; Android support and full on-device Astro builds remain unverified. iOS support is not implemented.

## Structure

- `apps/admin`: Persian RTL React dashboard/PWA.
- `apps/api`: local-only content, media and build API.
- `apps/site`: Astro static renderer.
- `content`: neutral fixture for local development; replace it only in a private site repository.
- `packages/contracts`: validated content/theme/publisher contracts.
- `packages/theme`: initial Atelier theme metadata.
- `experiments/android-launch`: Android prototype source, tests, and Gradle build inputs. It requires a local Android SDK; do not commit local SDK configuration or credentials.

## Android prototype setup

The Android prototype requires JDK 17, Node.js/npm, Android SDK Platform 36, and `adb` on `PATH`. Set `ANDROID_HOME` and `ANDROID_SDK_ROOT` to the SDK directory. From the repository root, build its bundled dashboard, schema validator, unit tests, and APK with:

```sh
./experiments/android-launch/gradlew -p experiments/android-launch \
  -PstudioAdminDistDir="$PWD/apps/admin/dist" \
  -PstudioGithubAppId=5648232 \
  -PstudioGithubAppClientId=Iv23liOaoICPbBGQ1uRx \
  -PstudioSiteTemplateOwner=arashashrafii \
  -PstudioSiteTemplateRepo=astro-static-studio-site-template \
  -PstudioSiteTemplateRepositoryId=1449755356 \
  testDebugUnitTest assembleDebug
```

This regenerates the dashboard and canonical validation schemas under the ignored Android build inputs and packages them in the APK. Install the debug build with:

```sh
adb install -r experiments/android-launch/app/build/outputs/apk/debug/app-debug.apk
```

The App ID and Client ID above are public identifiers, not secrets. The native flow requires the account owner to approve the GitHub App and its requested permissions. Never place a client secret or private key in Gradle properties or an APK. The prototype and full on-device Astro build are not yet verified as supported product workflows.

See [Vision](docs/VISION.md), [MVP](docs/MVP.md), [Architecture](docs/ARCHITECTURE.md), [Content model](docs/CONTENT_MODEL.md), [Current contracts](docs/CONTRACTS.md), and [Roadmap](docs/ROADMAP.md).

## Product direction and current boundaries

Keep the non-technical owner journey simple: choose an **approved free template**, configure site identity and language/direction, edit **Pages** and **Collections**, preview, and publish. A page can contain simple predefined blocks, including a collection display (cards, list, or gallery). Collection entries and categories are managed separately from the page on which they appear.

The current dashboard and static renderer use this Pages-and-Collections model. The serialized `version: 2` value is an internal format marker; older entry-based files are handled only by the backup-first import path. Arbitrary Astro templates, custom HTML, and a freeform page designer remain out of scope. See [CONTENT_MODEL](docs/CONTENT_MODEL.md) for the model and import boundaries.

## License and site data

Astro Static Studio source code is licensed under [Apache-2.0](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency and asset scope, and [SECURITY.md](SECURITY.md) for known npm audit findings. The neutral `content/content.json` fixture is part of the source release. The original customer version of that file, all site media under `apps/site/public/media/`, private evidence, credentials, and publishing configuration are excluded. Do not add customer content or site media to a public source repository. Generated site repositories should be private unless their owner chooses otherwise.
