# Rule validation on public repos

Run on 2026-11-19 with `testpulse <dir> --format json`, static analysis only (nothing from these repos was executed).

| Repo (test dir) | Files analysed |
| --- | --- |
| RocketChat/Rocket.Chat `apps/meteor/tests/e2e` | 174 |
| grafana/grafana `e2e-playwright` | 248 |
| apache/superset `superset-frontend/playwright` | 43 |
| supabase/supabase `e2e` | 35 |
| karatelabs/karate `karate-demo`, `karate-core/src/test` | 102 |
| **Total** | **602** |

## What the first pass found

Hits per new rule on the first run, how many of a sample looked wrong, and what was changed. Labelling was done by one
reviewer (an AI assistant) reading sampled hits with surrounding code; there is no second labeller and no ground truth.

| Rule | First run | Verdict on sample | Fix | After |
| --- | --- | --- | --- | --- |
| `no-assertion` | 103 | mostly wrong: `expect.poll`/`expect.soft` missed (a regression introduced by the AST rewrite), assertions inside page-object helpers | root-identifier matching, helper-name detection; warning (not critical) when the test only calls project helpers | 41, all warning |
| `happy-path-only` | 218 | wrong: UI e2e flows are legitimately positive | only API-style files, with asserted responses, none negative | 0 |
| `name-body-mismatch` | 85 | wrong: "should not show X" with `.not.toBeVisible()` is a valid negative test; also the test name itself satisfied the check | strong API error cues only, and only when a 2xx status is what gets asserted | 0 |
| `swallowed-error` | 13 | wrong: best-effort cleanup, commented intent | skip commented catches and cleanup calls; critical only around `expect` | 0 |
| `weak-assertion-only` | 6 | 5 wrong (`toBeNull`/`toBeUndefined` assert absence); 1 real (`expect(locator).toBeDefined()` always passes) | only `toBeDefined`/`toBeTruthy`; skip tests with helper or negative assertions | 1 (the real one) |
| `real-looking-pii` | 20 | wrong: phone numbers and timestamps passing PESEL/Luhn by chance, placeholder e-mails | PESEL date check + token boundaries, card IIN prefixes and 15-16 digits, free-mail providers only | 0 |
| `insecure-http` | 52 | mostly wrong: licence headers in comments | skip comments and documentation hosts | 9 (info; mock/placeholder hosts, still noisy) |
| `hardcoded-secret` | 1 | wrong: a local test-user password | skip values containing test/dummy/demo… | 0 |
| `tls-verification-disabled` | 3 | correct but intentional (Karate's own SSL tests) | none | 3 |
| `commented-out-assertion` | 2 | correct | none | 2 |
| `copy-paste-variant` | 2 | borderline | none | 2 |
| `tautological-assertion`, `snapshot-only`, `secret-in-test-output`, `production-target`, `nondeterministic-exact-match`, `eval-without-baseline` | 0 | n/a | none | 0 |

## Read this before quoting the numbers

- The rules were tuned on the same 602 files they were then re-measured on. The "after" column describes fit to this sample, not
  expected performance on new code.
- These are mature, human-written suites. A low hit rate there is expected and says nothing about recall on AI-generated tests,
  which is what the product targets. Measuring that needs a corpus of AI-generated tests with labelled problems (see ROADMAP, Walidacja).
- Several rules (`tautological-assertion`, `snapshot-only`, the LLM-app rules) matched nothing here, so they are validated only on the
  synthetic fixtures in `packages/cli/test/corpus/`.
- Rules that depend on the keyword/heuristic layer (`ai-coverage`, `audit-mcp` poisoning patterns) were not run on real projects or servers.
