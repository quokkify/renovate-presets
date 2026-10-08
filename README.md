# renovate-config

[![Renovate enabled](https://img.shields.io/badge/renovate-enabled-brightgreen.svg?logo=renovate)](https://docs.renovatebot.com/)

Shared [Renovate](https://docs.renovatebot.com/) presets for personal GitHub projects.

This repository hosts a small library of opt-in presets that consumer repositories can extend instead of duplicating the same `renovate.json` boilerplate.

## How to use

In your consumer repository's `.github/renovate.json` (or `renovate.json` at the root), reference the preset(s) you need:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>quokkify/renovate-presets//presets/gradle/default"
  ]
}
```

For stable consumers, pin to a published release after the pilot checks pass.
The tag follows the preset path. This example uses an illustrative `vX.Y.Z`;
replace it with the released tag that includes the changes you want:

```json
{
  "extends": [
    "github>quokkify/renovate-presets//presets/gradle/default#vX.Y.Z"
  ]
}
```

Same-repository references inside presets use root-relative paths such as
`/presets/base`. Renovate inherits the caller's tag through every nested preset,
so a released configuration cannot silently pull modules from `main`. See
[Renovate's relative preset documentation](https://docs.renovatebot.com/config-presets/#relative-preset-references).
These relative references belong inside shared presets; consumer configuration
must continue using the absolute `github>` form shown above.

Promotion order: merge and validate a change, observe selected pilot repositories
using the unpinned default-branch form, publish a release, then open updates to
the stable consumers' explicit tags. Do not point stable consumers at an older
release just to introduce pinning: it may omit the fixes being promoted.
Changing a stable consumer's tag remains a reviewable configuration update;
leave only the selected pilots following `main`.

## Available presets

### Base

| Preset | Path | Description |
|---|---|---|
| Base | `presets/base` | `config:best-practices` wrapper with `deps(<manager>)` semantic commit titles (for example `deps(github-actions)`, `deps(npm)`); custom regex managers use the lowercase dependency name without its organization, e.g. `deps(python)` or `deps(ci-kit)`, labels, security updates, automatic patch/minor/digest merges after 3 days of release stability, and checked PR automerge for lock-file maintenance; major updates remain manual; disables Renovate's built-in Copier updates |

The base preset keeps `semanticCommitType: "deps"` as the default configuration and also extends Renovate's `:semanticCommitTypeAll(deps)` preset. The latter applies `deps` to every dependency update type, including production Maven/Gradle updates that Renovate otherwise classifies as `fix`; the explicit default remains for compatibility with consumers that override or inspect the base settings.

The base preset disables Renovate's built-in `copier` manager so each repository has one Copier rollout owner. Copier-managed repositories must update through their template's atomic rollout workflow (for example, `ci-kit` fleet automation), which applies the template, restores canonical answer-file formatting, checks duplicated version answers and generated references, and opens a dedicated reviewable PR. This repository's own `.github/renovate.json` carries the same rule because it intentionally does not consume its shared base preset.

For GitHub Actions `uses-with` dependencies named `java-jdk`, major updates require explicit Dependency Dashboard approval and PR creation approval, and are never automerged. This rule only governs major updates: it does not pin or guarantee discovery of a particular Java 21.x patch version; the consumer's current value and Renovate datasource determine which update is proposed.

### Java / Gradle

| Preset | Path | Description |
|---|---|---|
| Default | `presets/gradle/default` | Composable: Gradle/Maven packageRules + opt-in modules (does not restrict managers) |
| Service | `presets/gradle/service` | Explicit allowlist: enables `gradle`, `gradle-wrapper`, `docker-compose`, `dockerfile`, `github-actions`, `custom.regex`. Use when you want to lock the manager set. |
| `aliases` | `presets/gradle/modules/aliases` | Routes `com.atlassian.*` to Atlassian Maven repository |
| `allowed-versions` | `presets/gradle/modules/allowed-versions` | Restricts `io.kubernetes:client-java*` to stable semver |
| `changelogs` | `presets/gradle/modules/changelogs` | Custom changelog URLs for `checkstyle`, `fugue`, `bcprov-jdk18on`, `httpcore5` |
| `compatibility` | `presets/gradle/modules/compatibility` | PR-body compatibility notes for Hibernate/Jakarta/hypersistence-utils |
| `disabled` | `presets/gradle/modules/disabled` | Disables `versions-maven-plugin` and `com.epam.reportportal:*` |

### GitHub Actions

| Preset | Path | Description |
|---|---|---|
| Default | `presets/github-actions/default` | Composable: updates each workflow action in a separate PR on Monday mornings; non-major updates follow the base stability gate and major updates remain manual (does not restrict managers) |

### Docker

| Preset | Path | Description |
|---|---|---|
| Default | `presets/docker/default` | Composable: groups Dockerfile and docker-compose updates, but keeps `postgres`, `python`, `node` and `nginx` image non-major/digest updates in dedicated automerge PRs (does not restrict managers) |

### npm / JS / TS

| Preset | Path | Description |
|---|---|---|
| Default | `presets/npm/default` | Composable: npm packageRules; keeps Playwright non-major updates in a dedicated automerge PR and groups selected major ecosystems |

### Migrations

| Preset | Path | Description |
|---|---|---|
| `javax-to-jakarta` | `presets/migrations/javax-to-jakarta` | Example replacement preset migrating `javax.servlet` to `jakarta.servlet` 6.x |

## Composition examples

### Java/Gradle library

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>quokkify/renovate-presets//presets/gradle/default"]
}
```

### Java/Gradle service with Docker and CI

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>quokkify/renovate-presets//presets/gradle/service"]
}
```

### Java/Gradle service with Docker grouping

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>quokkify/renovate-presets//presets/gradle/service",
    "github>quokkify/renovate-presets//presets/docker/default"
  ]
}
```

## Composing presets — important note about `enabledManagers`

Renovate **replaces** the `enabledManagers` array on each preset extension; it does not merge. Composing two presets that both set `enabledManagers` silently disables the earlier ones.

Design contract in this repository:

- All **`*/default`** presets are composable: they contribute only `packageRules`, base config and opt-in modules. None of them set `enabledManagers`. You can freely combine `gradle/default` + `docker/default` + `github-actions/default` and Renovate will scan everything it auto-detects.
- **`gradle/service`** is the only preset that sets `enabledManagers` (explicit allowlist for the full Java service stack). Use it when you want to lock the manager set.
- If you need a custom allowlist of your own, set `enabledManagers` directly in your consumer `renovate.json` and extend any number of `*/default` presets for their rules.

## Authentication

Consumer repositories use the [Mend Renovate App](https://github.com/apps/renovate) which automatically follows `github>` extends to public preset repositories — no extra setup needed.

## Validating preset changes

This repository's CI validates every JSON preset and tests the composed update policies on push, pull request and weekly cron. To validate locally:

```bash
export RENOVATE_VERSION=44.121.4 # Keep in sync with CI's single version setting.
npx --yes --package "renovate@${RENOVATE_VERSION}" -- renovate-config-validator --strict <file.json>
npx --yes --package "renovate@${RENOVATE_VERSION}" --call 'node --test tests/*.test.mjs'
node scripts/validate-filenames.mjs
```

The policy tests use Renovate's own preset resolver and package-rule engine. Only
the GitHub preset transport is replaced with reads from this checkout; built-in
presets and matching/merge semantics come from the installed Renovate version.
Unknown external sources fail the tests rather than reading remote presets.
The suite checks manual major updates (including Java JDK), the three-day
patch/minor/digest stability gate, lock-file maintenance, toolkit-owned workflow
and Copier exclusions, and every ordering of Docker/npm/Gradle/GitHub Actions
presets. A mutation test verifies that the original broad GitHub Actions
automerge override breaks the contract. These are configuration-policy tests;
required-check enforcement and actual merge execution remain platform concerns.
The graph tests also verify tag inheritance through every shipped preset and
continued unpinned pilot resolution. The filename gate reads Git's tracked index,
including collisions that a case-insensitive checkout cannot represent.

## License

[MIT](LICENSE)
