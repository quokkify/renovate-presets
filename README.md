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
    "github>ylazakovich/renovate-config//presets/gradle/default"
  ]
}
```

To pin to a specific tag (recommended for stability):

```json
{
  "extends": [
    "github>ylazakovich/renovate-config#v1.0.0//presets/gradle/default"
  ]
}
```

## Available presets

### Base

| Preset | Path | Description |
|---|---|---|
| Base | `presets/base` | `config:best-practices` wrapper with labels, dashboard approval and automerge of non-major updates |

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
| Default | `presets/github-actions/default` | Composable: groups workflow action updates and automerges (does not restrict managers) |

### Docker

| Preset | Path | Description |
|---|---|---|
| Default | `presets/docker/default` | Composable: groups Dockerfile and docker-compose updates (does not restrict managers) |

### Migrations

| Preset | Path | Description |
|---|---|---|
| `javax-to-jakarta` | `presets/migrations/javax-to-jakarta` | Example replacement preset migrating `javax.servlet` to `jakarta.servlet` 6.x |

## Composition examples

### Java/Gradle library

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>ylazakovich/renovate-config//presets/gradle/default"]
}
```

### Java/Gradle service with Docker and CI

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>ylazakovich/renovate-config//presets/gradle/service"]
}
```

### Java/Gradle service with Docker grouping

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>ylazakovich/renovate-config//presets/gradle/service",
    "github>ylazakovich/renovate-config//presets/docker/default"
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

This repository's CI validates every JSON preset on push, pull request and weekly cron. To validate locally:

```bash
npx --yes --package renovate -- renovate-config-validator --strict <file.json>
```

## License

[MIT](LICENSE)
