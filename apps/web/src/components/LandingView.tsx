export function LandingView({
  onTryDemo
}: {
  onTryDemo: () => void
}) {
  return (
    <div className="landing">
      <div className="panel hero-panel">
        <div className="muted small hero-eyebrow">Test quality analyser for QA teams</div>
        <h1 className="hero-title">
          Your tests pass.<br />
          Do they <span className="accent">actually test</span>?
        </h1>
        <p className="hero-sub">
          Testpulse is a static analyser + coverage agent for Playwright, Karate, and Cucumber suites.
          It catches silent assertion-less scenarios, flags flaky patterns, maps your tests against your OpenAPI spec,
          and uses Claude to suggest the tests you&apos;re missing. No runtime instrumentation, no CI changes.
        </p>
        <div className="hero-cta">
          <button className="primary" onClick={onTryDemo}>Open the live demo</button>
          <span className="muted small">or scroll down for install instructions</span>
        </div>
      </div>

      <div className="feature-grid">
        <div className="panel feature">
          <div className="feature-icon">✓</div>
          <h3>20+ static rules, 3 frameworks</h3>
          <p className="muted small">
            no-assertion, explicit-sleep, hardcoded-auth-token, unchecked-http-call, repeated-setup, duplicate-scenario,
            data-variation-duplicate, and more. Playwright, Karate, and Cucumber (JS/TS + Java) supported out of the box.
          </p>
        </div>
        <div className="panel feature">
          <div className="feature-icon">⟳</div>
          <h3>Coverage from your OpenAPI</h3>
          <p className="muted small">
            Upload your spec, testpulse traces transitively through Karate helpers and Cucumber step defs,
            matches endpoints by verb + path, tells you which operations have zero coverage — and which
            tests hit endpoints you don&apos;t even document.
          </p>
        </div>
        <div className="panel feature">
          <div className="feature-icon">★</div>
          <h3>LLM-powered gap analysis</h3>
          <p className="muted small">
            For every uncovered endpoint, Claude Haiku reads the context and proposes 3–5 missing test scenarios
            with severity, rationale and Gherkin steps ready to paste. Export the lot as Markdown for JIRA,
            or scaffold individual <code>.feature</code> files with one click.
          </p>
        </div>
      </div>

      <div className="panel">
        <h2>Quickstart</h2>
        <p className="muted small">
          Point the CLI at a directory of tests. It prints issues, a quality score, exits non-zero on criticals.
        </p>
        <pre className="command">{`# analyse a local suite
npx testpulse ./tests

# push results to your dashboard (with coverage + gap-analysis)
npx testpulse ./tests \\
    --push http://your-testpulse-api \\
    --project my-project

# upload your OpenAPI once per project
npx testpulse ingest-openapi openapi.yaml \\
    --push http://your-testpulse-api \\
    --project my-project`}</pre>
      </div>

      <div className="panel how">
        <h2>How the pipeline works</h2>
        <ol>
          <li><strong>Static analysis</strong> — the CLI walks <code>.spec.ts</code> / <code>.feature</code> / <code>.java</code> files, applies framework-specific rules, emits an issue list.</li>
          <li><strong>Endpoint extraction</strong> — for Karate, it traces transitively through <code>call helpers.X.Y</code> references and <code>call read(&apos;classpath:...&apos;)</code> up to depth 4 to find which HTTP operations each scenario ultimately hits.</li>
          <li><strong>Coverage matching</strong> — extracted endpoints are matched against your OpenAPI targets by verb + suffix (so <code>/api/loans</code> in the spec matches <code>/loan-service/api/loans</code> at runtime).</li>
          <li><strong>Gap suggestions</strong> — for every target with weak coverage, Claude Haiku receives the endpoint metadata and the list of existing scenarios, returns structured missing-test suggestions via tool-use.</li>
          <li><strong>Dashboard</strong> — score trend, rule breakdown, domain hotspot, coverage %, uncovered list, orphan calls, gap suggestions with export-to-Markdown and per-suggestion <code>.feature</code> scaffolding.</li>
        </ol>
      </div>

      <div className="panel privacy">
        <h2>Privacy stance</h2>
        <ul>
          <li>Static analysis runs <strong>locally</strong>. Your source never leaves your machine.</li>
          <li>Only endpoint metadata (verb, path, OpenAPI summary, existing scenario names) is sent to the LLM for gap analysis. Never test bodies, helper implementations, or actual request/response payloads.</li>
          <li>Anthropic API: no training on your data, 30-day retention for abuse monitoring (default). Enterprise contracts can enable Zero Data Retention.</li>
          <li>A <strong>blockedPaths</strong> config lets you exclude sensitive endpoints from LLM calls (<code>**/internal/**</code>, <code>/admin/**</code>). A <strong>dry-run</strong> mode shows exactly what would be sent, without sending it.</li>
        </ul>
      </div>
    </div>
  )
}
