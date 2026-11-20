# Configuration, suppression and scoring

## Suppressing false positives

```bash
# print fingerprints
testpulse ./e2e --print-fingerprints
```

```json
// .testpulse/ignores.json
{
  "version": 1,
  "ignores": [
    {
      "fingerprint": "ba3c199b89df",
      "rule": "karate-generic-scenario-name",
      "reason": "intentional demo scenario"
    }
  ]
}
```

Ignores can also be managed from the dashboard UI. Stale ignores (fingerprint no longer matches any issue) are surfaced in the report and dashboard.

### `.testpulse/config.json`

```json
{
  "rules": {
    "karate-endpoint-coverage-overlap": "off",
    "karate-print-in-test": { "severity": "warning" }
  },
  "ignoreFiles": ["**/legacy/**", "**/generated/**"]
}
```

### Scoring

Critical = −10, warning/info = −3, floor at 0. One critical issue = exit 1 (unless `--no-exit`).

---
