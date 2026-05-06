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
| Default | `presets/gradle/default` | Gradle and Gradle Wrapper managers; composes all opt-in modules below |
| Service | `presets/gradle/service` | Adds Docker, docker-compose, GitHub Actions and `custom.regex` managers on top of `gradle/default` |
| `aliases` | `presets/gradle/modules/aliases` | Routes `com.atlassian.*` to Atlassian Maven repository |
| `allowed-versions` | `presets/gradle/modules/allowed-versions` | Restricts `io.kubernetes:client-java*` to stable semver |
| `changelogs` | `presets/gradle/modules/changelogs` | Custom changelog URLs for `checkstyle`, `fugue`, `bcprov-jdk18on`, `httpcore5` |
| `compatibility` | `presets/gradle/modules/compatibility` | PR-body compatibility notes for Hibernate/Jakarta/hypersistence-utils |
| `disabled` | `presets/gradle/modules/disabled` | Disables `versions-maven-plugin` and `com.epam.reportportal:*` |

### GitHub Actions

| Preset | Path | Description |
|---|---|---|
| Default | `presets/github-actions/default` | Manages workflow file action versions, groups updates, automerges |

### Docker

| Preset | Path | Description |
|---|---|---|
| Default | `presets/docker/default` | Manages Dockerfile and docker-compose image references with digest pinning |

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

### Multiple stacks composed

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>ylazakovich/renovate-config//presets/gradle/default",
    "github>ylazakovich/renovate-config//presets/docker/default",
    "github>ylazakovich/renovate-config//presets/github-actions/default"
  ]
}
```

## Authentication

Consumer repositories use the [Mend Renovate App](https://github.com/apps/renovate) which automatically follows `github>` extends to public preset repositories — no extra setup needed.

## Validating preset changes

This repository's CI validates every JSON preset on push, pull request and weekly cron. To validate locally:

```bash
npx --yes --package renovate -- renovate-config-validator --strict <file.json>
```

## License

[MIT](LICENSE)
