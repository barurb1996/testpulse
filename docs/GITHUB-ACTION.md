# GitHub Action

Runs Testpulse on pull requests and pushes: score, critical issues, a summary comment that updates in place, optional inline
annotations through code scanning, and a failing check when the quality bar is not met. It installs the published CLI from npm
(Node 20+ on the runner), so it starts in seconds and nothing is built from source.

```yaml
name: Test quality
on: [pull_request]

permissions:
  contents: read
  pull-requests: write      # for the summary comment
  security-events: write    # only if upload-sarif is true

jobs:
  testpulse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }     # needed for changed-since
      - uses: barurb1996/testpulse@v0.3.0
        with:
          path: ./e2e
          changed-since: origin/main
          min-score: 60
          upload-sarif: true
```

Pin the action to a full commit SHA if your policy requires it (`uses: barurb1996/testpulse@<sha> # v0.3.0`).

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `path` | `.` | Directory with the tests, relative to the workspace |
| `fail-on-critical` | `true` | Fail the step when critical issues are found |
| `min-score` | `0` | Fail when the quality score is below this value (0 disables) |
| `comment-on-pr` | `true` | Post and keep updating a summary comment on pull requests (needs `pull-requests: write`; on forks the token is read-only and the step only warns) |
| `changed-since` | | Report only files changed versus this git ref, for example `origin/main` |
| `upload-sarif` | `false` | Upload findings to code scanning as inline annotations (needs `security-events: write`) |
| `junit` | | JUnit XML glob for per-scenario pass/fail |
| `api-url`, `project`, `token` | | Push the run to your own self-hosted Testpulse server (https only; set all three) |
| `testpulse-version` | `~0.3.0` | npm version range or dist-tag of the CLI to run |

## Outputs

`score` (0-100) and `critical` (number of critical issues).

## Notes

- Inputs reach the script as environment variables, never through string interpolation into a shell, so a branch name or path cannot inject commands.
- Nothing leaves the runner except the optional `api-url` push and the GitHub API calls (comment, code scanning).
- The logic lives in `action/run.mjs` and is covered by `action/run.test.mjs`; `.github/workflows/dogfood.yml` runs the Action against `examples/` on every push.
