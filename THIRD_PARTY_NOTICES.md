# Third-party notices

Astro Static Studio source code is licensed under Apache-2.0. That license does not
replace the licenses of packages installed from npm or Maven. This source tree does not
vendor npm or Android dependency source code, third-party fonts/icon sets, or
customer/site media. It includes the standard Gradle Wrapper JAR and shell wrapper;
these are from the Gradle project and licensed under Apache-2.0. The Android Gradle
plugin, Gradle distribution, Android SDK, and Maven packages are retrieved separately.
The lockfiles/build declarations record dependencies; each package's license and
required notices remain with that package and must be preserved when dependencies are
redistributed in an application bundle.

Direct dependencies in the current package manifests declare these licenses in their
package metadata (SPDX identifiers shown where provided):

| Package | License |
| --- | --- |
| `@tailwindcss/vite` | MIT |
| `@types/express` | MIT |
| `@types/mime-types` | MIT |
| `@types/multer` | MIT |
| `@types/node` | MIT |
| `@types/react` | MIT |
| `@types/react-dom` | MIT |
| `@vitejs/plugin-react` | MIT |
| `astro` | MIT |
| `blake3-wasm` | MIT |
| `concurrently` | MIT |
| `express` | MIT |
| `flowbite-react` | MIT |
| `mime-types` | MIT |
| `multer` | MIT |
| `quill` | BSD-3-Clause |
| `react` | MIT |
| `react-dom` | MIT |
| `sharp` | Apache-2.0 |
| `tailwindcss` | MIT |
| `tsx` | MIT |
| `typescript` | Apache-2.0 |
| `vite` | MIT |
| `vite-plugin-pwa` | MIT |
| `wrangler` | MIT OR Apache-2.0 |
| `zod` | MIT |

## Android and build tools

| Package or component | Version | License |
| --- | --- | --- |
| `com.android.tools.build:gradle` | 9.1.1 | Apache-2.0 |
| `androidx.webkit:webkit` | 1.14.0 | Apache-2.0 |
| `commons-codec:commons-codec` | 1.23.0 | Apache-2.0 |
| `junit:junit` | 4.13.2 | EPL-1.0 |
| `org.json:json` | 20240303 | Public Domain |
| Gradle distribution | 9.3.1 | Apache-2.0 |
| Gradle Wrapper (`gradlew`, `gradle-wrapper.jar`) | 9.3.1 | Apache-2.0 |

The Gradle 9.3.1 Wrapper JAR is byte-for-byte identical to the file at
[`gradle/gradle` v9.3.1](https://github.com/gradle/gradle/blob/v9.3.1/gradle/wrapper/gradle-wrapper.jar)
(SHA-256 `b3a875ddc1f044746e1b1a55f645584505f4a10438c1afea9f15e92a7c42ec13`). The
checked-in `gradlew` retains its upstream Apache-2.0 header and differs from Gradle's
v9.3.1 script only by removing the default `-Dfile.encoding=UTF-8` argument; that
project build-script adjustment is documented here. The Gradle and Android SDK
distributions are not included in this repository.

The list covers direct dependencies only; transitive packages are governed by their own
package metadata and license files. Review the lockfile and package notices before
redistributing an installed or bundled application.

The customer/reference portfolio content and site media from development are not
included in this source release. `content/content.json` contains only neutral synthetic
fixture data. Do not add customer content, site media, credentials, or publishing
configuration to a public source repository.
