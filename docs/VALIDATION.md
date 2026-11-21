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
  which is what the product targets. Measuring that needs a corpus of AI-generated tests with labelled problems.
- Several rules (`tautological-assertion`, `snapshot-only`, the LLM-app rules) matched nothing here, so they are validated only on the
  synthetic fixtures in `packages/cli/test/corpus/`.
- Rules that depend on the keyword/heuristic layer (`ai-coverage`, `audit-mcp` poisoning patterns) were not run on real projects or servers.

## AI-generated tests with independent labels

Three small OpenAPI specs (`bookings`, `bookstore`, `users`) and, later, two more (`inventory`, `tickets`) were given to fresh AI
sub-agents that had never seen Testpulse's rules, with natural prompts ("write Playwright API tests", "write Karate tests",
"quickly write some tests"). A separate fresh agent, given only the tests, the specs and a fixed rubric, labelled every test as
slop or fine and named the problem. Labels are in `packages/cli/test/corpus/ai-generated/labels*.json`; reproduce with
`node eval.mjs [labels-file]` (set `EXCLUDE=...` to drop rules from the comparison).

| Set | Tests | Slop | What the generators produced |
| --- | --- | --- | --- |
| `bookings`, `bookstore`, `users` | 53 | 6 | decent tests; every slop case was "shallow": 2xx status asserted, data never checked |
| `holdout/inventory`, `holdout/tickets` | 67 | 1 | thorough prompt, better tests; one loop that passes on an empty list |

### Result history (read the order carefully)

1. **First run on set 1, before any new rule:** precision 13%, recall 33%. The existing rules only caught 2 of 6 slop tests,
   by accident (a `hardcoded-secret` hit on a test password), and none of the "shallow" pattern.
2. I added `status-only-success` / `karate-status-only-success` and relaxed `karate-hardcoded-uuid` (ids in `path`/`url`, nil UUIDs)
   and `hardcoded-secret` (passphrase-like fixture values). Set 1 is now **in-sample**: 100% recall, precision 50%
   (100% when the `*-duplicate` maintainability hints are excluded).
3. **Held-out set 2, before any change:** the new rules gave 7 false positives and the one real slop case was missed
   (precision 0%, recall 0%). Two causes: a real logic bug (a test that also asserts a 409 was still flagged as "status only")
   and "accepts boundary value" tests where the status is the behaviour.
4. I fixed those and added `vacuous-loop-assertion` for the missed case. Set 2 is therefore **no longer out-of-sample**:
   recall 100% on a single slop test, precision 13% (50% without the `*-duplicate` hints).

### What this does and does not show

- Modern AI-written API tests are not full of tautologies or swallowed errors. In these 120 tests the only slop was
  status-only assertions and one vacuous loop. The "AI slop" rules from phase 1 fired on none of them.
- 7 slop labels in total is far too few for percentages to mean much. Treat the numbers as a regression check, not a benchmark.
- Labels come from an AI reviewer, not a human. Review `labels*.json` before quoting anything.
- A genuinely out-of-sample number needs a third, untouched set generated and labelled after the rules are frozen.
- The remaining false positives are mostly `karate-data-variation-duplicate`, a "consider Scenario Outline" suggestion that the
  labeller (reasonably) did not consider slop.

## Security coverage on the AI-generated projects

`testpulse security-coverage` against the five generated projects and their specs (after the fixes below):

| Project | Framework | Security coverage |
| --- | --- | --- |
| bookings | Playwright | 45% (5/11) |
| bookstore | Karate | 59% (10/17) |
| users ("quick" prompt) | Playwright | 25% (3/12) |
| holdout/inventory | Playwright | 62% (8/13) |
| holdout/tickets | Karate | 67% (10/15) |

The generators wrote correct happy-path tests and a fair number of 401/403 tests, but most BOLA/IDOR ("another user's resource") and
input-validation tests are missing. Specs were written by hand for this exercise, so this says how thoroughly AI tests cover
*these* specs, not how any real API fares.

The first run of this table was wrong. Spot-checking three matrix claims against the test sources showed that Karate paths with
variables (`path 'tickets', ticketId, 'comments'`) were not extracted, producing false gaps (tickets showed 19%, bookstore 26%).
Fixed; also path-parameter-only constraints no longer count as "input validation" for GET/DELETE. Only three claims were spot-checked,
so the matrix is not verified beyond that.
