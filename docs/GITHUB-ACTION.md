# GitHub Action

```yaml
# .github/workflows/quality.yml
name: Test quality

on: [push, pull_request]

jobs:
  testpulse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Analyse test quality
        uses: barurb1996/testpulse/packages/github-action@master
        with:
          path: ./e2e
          project: my-project
          api-url: https://testpulse.example.com
          token: ${{ secrets.TESTPULSE_TOKEN }}
          min-score: 60          # fail PR if score drops below 60
          junit: target/surefire-reports/*.xml   # optional
```

### Action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `path` | | `.` | Directory with test files |
| `project` | ✓ | | Project slug |
| `api-url` | | | Dashboard API URL (push results) |
| `token` | | | Project bearer token (use a secret) |
| `min-score` | | `0` | Fail step if score < N (0 = disabled) |
| `junit` | | | JUnit XML glob |
| `no-exit` | | `false` | Don't fail on critical issues |

### Action outputs

| Output | Description |
|--------|-------------|
| `score` | Quality score 0–100 |

Results are also written to the **GitHub Step Summary** automatically.

---
