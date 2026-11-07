# Developing

> Please also read [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Prerequisites

- Node.js 22+
- npm 10+
- Docker or Podman (for [container image builds](#container-image))
- A running [API server](https://github.com/DependencyTrack/dependency-track)

## Core Technologies

| Technology                                                                   | Purpose           |
| :--------------------------------------------------------------------------- | :---------------- |
| [Vue 3](https://vuejs.org/)                                                  | UI framework      |
| [Vite](https://vite.dev/)                                                    | Build tooling     |
| [BootstrapVueNext](https://bootstrap-vue-next.github.io/bootstrap-vue-next/) | Component library |
| [Vue Router](https://router.vuejs.org/)                                      | Routing           |
| [vue-i18n](https://vue-i18n.intlify.dev/)                                    | Localization      |
| [Axios](https://axios-http.com/)                                             | HTTP client       |
| [ESLint](https://eslint.org/)                                                | Linting           |
| [Prettier](https://prettier.io/)                                             | Formatting        |
| [Playwright](https://playwright.dev/)                                        | End-to-end tests  |

## Architecture Constraints

The following constraints apply project-wide. They exist to keep the codebase coherent
as it evolves and to avoid steering changes in directions we are actively moving away from.

## Composition API for new Vue Components

The code base was originally built on Vue 2, which only supported the options API.
Write new Vue components, or components that are being fully refactored, with the
[Composition API](https://vuejs.org/guide/extras/composition-api-faq.html#what-is-composition-api).

## Install

```shell
npm ci
```

## Dev Server

```shell
npm run serve
```

Defaults to `http://localhost:8080`, incrementing the port if it is already in use (e.g. `8081`).
The API base URL is configured at runtime via `public/static/config.json`.

## Build

```shell
npm run build
```

Output is written to `dist/`.

## Container Image

```shell
npm run build-image
```

Produces `ghcr.io/dependencytrack/frontend:local`.

## Linting and Formatting

```shell
npm run eslint-fix
npm run prettier-fix
```

## Unit Tests

```shell
npm test
```

Tests live next to the code as `*.test.js` and run with [Vitest](https://vitest.dev/).
Use them for pure logic with many input combinations, and end-to-end tests for everything a user can see.

## End-to-End Tests

Tests in [`e2e`](e2e) run against a production build and an API server started from [`e2e/compose.yaml`](e2e/compose.yaml).

```shell
docker compose -f e2e/compose.yaml up -d
npx playwright install chromium
npm run e2e
```

The stack can be reused across runs. Run `docker compose -f e2e/compose.yaml down` after changing `compose.yaml`, or when Postgres runs out of space.
`npm run e2e` builds and serves the app, or tests whatever already listens on port 18081.

CI uses the API server image for the target branch: `5-snapshot` for `main`, the image of the same name for `feature-*` branches,
and the latest release for release branches, e.g. `5.2.0` for `5.2.x`. Set `APISERVER_VERSION` to do the same locally.
A change that needs a new API server feature only passes once that feature is merged and `5-snapshot` is published.

Debugging:

```shell
npm run e2e -- --ui
npx playwright show-trace e2e/test-results/<test>/trace.zip
```

CI uploads the HTML report as the `playwright-report` artifact.

Writing tests:

- Find elements by role, label or text, not by CSS classes or component structure.
- Keep interaction with specific widgets, such as date pickers and switches, in helpers in [`e2e/test.mjs`](e2e/test.mjs).
  Specs must not change when a UI library is replaced.
- Add new routes to [`e2e/routes.spec.mjs`](e2e/routes.spec.mjs), with seeded data as the landmark where the route shows it.
- Add data that many tests share to the `seed` in [`e2e/global-setup.mjs`](e2e/global-setup.mjs). Create other data through the `api` fixture.
- Name test data with `uniqueName()`.
- Tests fail on console errors, uncaught exceptions and responses with status 400 or above. Allow expected ones with `problems.allow()` and a comment.
- Restore global settings that a test changes.

## Finding Assessment Synchronization

The finding audit drawer shows decision ownership on both project findings and
the global vulnerability audit. Missing ownership is shown as unknown, not inherited.
Policy ownership is informational. The server controls policy precedence.

- **Save** applies the editable local decision and takes local ownership.
- **Take local ownership** takes the current server decision without submitting
  unsaved fields. This preserves source provenance when the decision is unchanged.
- **Release local ownership** requires confirmation. It clears the local decision
  fields but keeps local comments. Synchronization resolves separately; the UI
  does not predict its result. Unsaved edits stay in the draft.
- Release is only offered for explicit `LOCAL` ownership. Legacy responses do not
  prove whether a policy owns a decision, so release is not offered for unknown ownership.
- **History** contains only local history. Adding a comment does not submit analysis
  fields or discard an analysis draft.
- **Sources** appears only when the API returns readable source assessments.
  It shows each source project, component, original details, and full original history.
  Source text is read-only and is never copied into local Details or History.
  Sources can remain visible after taking local ownership.

Finding writes use `COMMENT_ONLY`, `TAKE_LOCAL`, or `RELEASE_LOCAL` and include the
loaded `expectedDecisionVersion`, including zero. Each successful write is followed
by a GET. If that GET fails, the write is not retried. Further writes are blocked
until **Reload assessment** succeeds.

A 409 retains the draft and blocks writes. Use **Reload for review** to show the
current server decision next to the retained draft. Then choose **Keep draft and
use reviewed version** before explicitly submitting again. Reload never retries a write.
Other request errors retain the draft and use the existing error notification.

`AuditPanel` enables this contract only with `assessment-sync`. `FindingAudit`
opts in for both consumers. Policy violation analysis does not opt in and keeps
its existing endpoint payloads and UI. The focused endpoint-boundary regressions
are in `e2e/flows/assessment-sync.spec.mjs`.

## Localization

Locale files live in [`src/i18n/locales`](src/i18n/locales).

Adding a key:

1. Add it to `en.json` with the English translation.
2. Add the same key with a `null` value to every other locale file.
3. Run `npm run prettier-fix` to sort keys.

Reports and cleanup:

```shell
npm run vue-i18n-extract
npm run remove-unused-i18n
```
