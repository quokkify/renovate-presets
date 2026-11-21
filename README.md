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

### Blast radius

Most consumers reference these presets without a tag, so they read the default
branch: a change merged to `main` reaches every unpinned consumer on its next
Renovate run, all at once. Only consumers that pin a tag (`#vX.Y.Z`) wait for an
explicit configuration update. Treat every merge to `main` as a fleet-wide rollout
unless the consumers are pinned. New policy therefore ships as a separate opt-in
preset that no existing preset extends, and it reaches a repository only when that
repository adds it to its own `extends`.

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
| Default | `presets/docker/default` | Composable: groups Dockerfile and docker-compose non-major/digest updates into one `docker images` PR, and gives `postgres`, `python`, `node` and `nginx` their own PR each (does not restrict managers). Automerge is not isolated to those four images: every Docker non-major/digest update, grouped or not, automerges after the base preset's 3-day stability gate. To keep image updates out of automerge, add [`hardening/supply-chain`](#supply-chain-hardening-opt-in). |

### npm / JS / TS

| Preset | Path | Description |
|---|---|---|
| Default | `presets/npm/default` | Composable: npm packageRules; keeps Playwright non-major updates in a dedicated automerge PR and groups selected major ecosystems |

### Supply-chain hardening (opt-in)

| Preset | Path | Description |
|---|---|---|
| Supply chain | `presets/hardening/supply-chain` | Turns automerge off for updates that execute in CI or builds, keeps lock-file maintenance as a reviewed PR, and opens vulnerability fixes immediately without the release-age wait or concurrency caps. Ordinary library updates keep the base automerge. |

No existing preset extends it. Add it **last**, after every preset it hardens: it only
appends package rules, and Renovate applies later rules over earlier ones, so a
preset listed after it (for example `docker/default`, whose runtime-image rules set
`automerge: true`) would switch automerge back on.

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>quokkify/renovate-presets//presets/gradle/service",
    "github>quokkify/renovate-presets//presets/docker/default",
    "github>quokkify/renovate-presets//presets/hardening/supply-chain"
  ]
}
```

Effective behaviour on top of the base preset:

- **No automerge** for GitHub Actions (including workflow container and service
  images), all Docker images (`docker` datasource, plus every Dockerfile and
  docker-compose update), the Gradle wrapper, Gradle plugins (`depType: plugin`),
  Maven build plugins and extensions (`depType: build`) and `custom.regex` tool
  pins. Their non-major PRs still open without dashboard approval after the 3-day
  stability gate; a human merges them. Majors stay manual as in the base preset.
- **Lock-file maintenance is not automerged.** `minimumReleaseAge` cannot gate it:
  lock-file maintenance carries no release timestamp, so Renovate either skips the
  age check or, under the default `minimumReleaseAgeBehaviour: timestamp-required`,
  keeps the stability status pending indefinitely. A reviewed PR is the reliable
  control for freshly published transitive versions.
- **Vulnerability fixes open at once.** `vulnerabilityAlerts` sets
  `prCreation: immediate`, `dependencyDashboardApproval: false`,
  `minimumReleaseAge: null` and `schedule: []`, and lifts the concurrency caps with
  `prConcurrentLimit: 0` and `branchConcurrentLimit: 0` (0 means no limit). Renovate
  applies these as forced settings after every package rule, counts vulnerability
  branches against a budget separate from ordinary updates, never applies
  `prHourlyLimit` to them, and always processes them before other branches. Automerge
  is not forced: a fix for an execution-sensitive dependency or a major fix still
  waits for review, while a library patch fix automerges on green checks.

### Coupled-stack grouping (opt-in)

| Preset | Path | Description |
|---|---|---|
| Coupled stacks | `presets/grouping/coupled-stacks` | Moves stacks whose parts must change together in one branch: all `reportportal/*` Docker images, and the Django stack (`django`, `djangorestframework`, `django-cors-headers`, `whitenoise`) across every update type. |

No existing preset extends it. Add it **last**, after `python/default` or
`docker/default`, for the same rule-order reason as the hardening preset:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>quokkify/renovate-presets//presets/python/default",
    "github>quokkify/renovate-presets//presets/docker/default",
    "github>quokkify/renovate-presets//presets/grouping/coupled-stacks"
  ]
}
```

- **ReportPortal images** (`/^reportportal\//` on the `docker` datasource) share the
  `reportportal images` group. `separateMultipleMajor: false` puts every major hop in
  one `major-reportportal-images` branch instead of one per image and target major;
  majors need Dependency Dashboard approval and never automerge. Non-major updates
  share the `reportportal-images` branch and follow the base stability gate.
  ReportPortal Gradle artifacts stay disabled by `gradle/modules/disabled`.
- **Django stack** packages on PyPI share the `django stack` group with
  `separateMajorMinor: false`, so a framework minor and a companion major land in the
  same `django-stack` branch. This replaces the major-only `django stack major`
  group from `python/modules/grouping` for consumers that add the preset. A branch
  that contains a major still needs dashboard approval.
- Vulnerability fixes keep their own branch: Renovate's `vulnerabilityAlerts`
  defaults force `groupName: null`, so a security fix is never held back by its
  group. Combine with `hardening/supply-chain` so such fixes open immediately.

### Adopting an opt-in preset: canary first

1. Pick one canary repository with green required checks and an active Dependency
   Dashboard. Add the opt-in preset as the last `extends` entry in a reviewed PR.
2. Before merging, run `renovate-config-validator --strict` on the consumer config.
   After merging, read the Dependency Dashboard and the Renovate job log of the next
   run to confirm the preset resolved and the expected branches were planned.
3. Watch one full update cycle (at least a week, so the Monday GitHub Actions
   schedule and the 3-day stability gate both elapse): confirm that execution-sensitive
   PRs open without automerging, library PRs still automerge, and grouped stacks
   arrive in one branch.
4. Roll out to the remaining repositories one PR each, preferably pinned to the
   release tag that contains the preset. Revert is removing the `extends` entry.

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

### Java/Gradle with q4j grouped in one PR (opt-in)

`presets/gradle/q4j` is not part of `gradle/default`. Extend it explicitly in projects that carry the q4j version in more than one catalog. It groups all `dev.quokkify:*` packages under the `q4j` group by package name; `dev.quokkify.archgate:*` is excluded.

```json
{
  "extends": [
    "github>quokkify/renovate-presets//presets/gradle/default",
    "github>quokkify/renovate-presets//presets/gradle/q4j"
  ]
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
automerge override breaks the contract. The opt-in presets are tested composed
after the existing ones: execution-sensitive updates, lock-file maintenance and
library updates under `hardening/supply-chain`, vulnerability fixes built with
Renovate's own vulnerability package-rule generator, the effect of listing the
preset too early, and branch names computed by Renovate's branch-name generator for
the ReportPortal and Django groups. A guard test fails if any existing preset starts
extending an opt-in preset. These are configuration-policy tests;
required-check enforcement and actual merge execution remain platform concerns.
The graph tests also verify tag inheritance through every shipped preset and
continued unpinned pilot resolution. The filename gate reads Git's tracked index,
including collisions that a case-insensitive checkout cannot represent.

## License

[MIT](LICENSE)
