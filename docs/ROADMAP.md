# Testpulse – plan: jakość testów od AI i bezpieczeństwo

## Cel i pozycjonowanie

Testpulse ma być bramką jakości w CI dla testów pisanych przez AI: mówi, które zielone testy niczego nie sprawdzają i czy przetestowane jest to, co ważne dla bezpieczeństwa.

**Hasło:** „Twoje testy są zielone. Ale czy cokolwiek sprawdzają i czy sprawdzają to, co ważne?"

**Dla kogo:** QA Lead jako champion, Engineering Manager jako budżet. Developerzy generują testy agentami (Claude Code, Cursor, Copilot) i nikt nie ocenia ich jakości.

**Czego NIE robimy:** ogólnego skanera bezpieczeństwa kodu aplikacji (rynek Snyk, Semgrep, CodeQL). Analizujemy wyłącznie testy i ich pokrycie względem specyfikacji.

**Trzy filary:**

1. **AI slop w testach** – testy, które przechodzą, ale niczego nie weryfikują.
2. **Bezpieczeństwo w testach** – higiena (sekrety, TLS, produkcja) i pokrycie zachowań bezpieczeństwa (authz, 401/403, walidacja) względem OpenAPI.
3. **Testy aplikacji AI** – czy aplikacje z LLM i serwery MCP mają testy na prompt injection, wycieki i uprawnienia narzędzi.

## Stan repo i zmiany w architekturze

Fundament już jest: 29 reguł (Karate, Playwright, Cucumber), fingerprinty, ignorowanie, konfiguracja, ingest OpenAPI, mapa pokrycia endpointów, GitHub Action z `min-score` i API z analizą luk przez LLM.

| Co jest | Gdzie | Co zmienić |
| --- | --- | --- |
| Reguły jako funkcje wołane ręcznie w parserze | `parsers/playwright.ts`, `parsers/karate.ts` | Rejestr reguł z metadanymi: `id`, `category` (`ai-slop`, `security-hygiene`, `security-coverage`, `ai-app`), `frameworks`, `severity`, `docsUrl` |
| `Issue` bez kategorii i bez poprawki | `types.ts` | Dodać `category`, `ruleVersion`, opcjonalnie `suggestion` |
| `no-assertion` szuka słowa `expect` w JSON-ie AST | `rules/no-assertion.ts` | Właściwe przejście AST (`expect` w komentarzu/nazwie zmiennej daje dziś fałszywy wynik) |
| OpenAPI: tylko `verb` + `path` | `openapi.ts` | Czytać też `security`, `securitySchemes`, `responses` (401/403/422), `parameters` |
| Pokrycie endpointów bez rodzaju testu | `EndpointCoverage` | Klasyfikować scenariusz: happy, unauth, forbidden, cross-user, invalid-input |
| Raport tylko w terminalu i do API | `reporter/index.ts` | Wyjście SARIF i JSON, komentarz na PR |
| Brak JUnit/Jest | `analyzer.ts` | Faza 1b: parser JUnit 5 i Jest/Vitest |

**Zasada:** jedna reguła = jeden plik + fixture z przykładami „zły / dobry". Bez fixture'a reguła nie wchodzi do rejestru.

## Faza 1: AI slop w testach

| Reguła | Co wykrywa | Przykład | Ważność |
| --- | --- | --- | --- |
| `tautological-assertion` | Asercja, która nie może się nie udać | `expect(true).toBe(true)`, `expect(x).toBe(x)`, `assertNotNull(new Foo())` | critical |
| `weak-assertion-only` | Sprawdza tylko istnienie, nie wartość | sam `toBeDefined()`, `toBeTruthy()`, `match response == '#notnull'` | warning |
| `assert-on-mock` | Asercja na wartości zwróconej przez własny mock | `mock.returns(5)` → `expect(result).toBe(5)` | critical |
| `over-mocked-test` | Wszystkie zależności SUT zamockowane | >80% wywołań to mocki/stuby | warning |
| `copy-paste-variant` | Testy różnią się tylko literałem | 10 testów z innym e-mailem → sugestia `test.each` / Scenario Outline | warning |
| `happy-path-only` | Brak przypadków błędu w pliku/feature | brak 4xx, `toThrow`, `rejects`, niepoprawnego inputu | warning |
| `name-body-mismatch` | Nazwa obiecuje co innego niż asercje | „should reject expired token", a test sprawdza 200 | warning |
| `swallowed-error` | Pusty catch w teście | `try {…} catch {}`, `.catch(() => {})` | critical |
| `snapshot-only` | Jedyna asercja to snapshot | `toMatchSnapshot()` bez asercji wartości | info |
| `commented-out-assertion` | Zakomentowane asercje | `// expect(total).toBe(100)` | warning |

**Wdrożenie:**

1. Wspólny model testu: `TestCase { name, steps, assertions[], mocks[], calls[], line }`. Parsery go wypełniają, reguły działają na modelu.
2. Napraw `no-assertion` na bazie `assertions[]`.
3. Reguły w kolejności z tabeli.
4. Każda reguła ma `suggestion` – jedno zdanie, jak poprawić.

## Faza 2: higiena bezpieczeństwa w testach

| Reguła | Co wykrywa | Ważność |
| --- | --- | --- |
| `hardcoded-secret` | JWT, klucze API (`AKIA…`, `ghp_…`, `sk_live_…`), hasła w testach, fixture'ach, `karate-config.js` | critical |
| `tls-verification-disabled` | `ignoreHTTPSErrors: true`, `rejectUnauthorized: false`, `configure ssl = true`, `verify=False` | warning |
| `production-target` | Domeny produkcyjne (lista w `.testpulse/config.json`) | critical |
| `real-looking-pii` | PESEL, karty (Luhn), IBAN, prawdziwe e-maile w danych testowych | warning |
| `secret-in-test-output` | `print`/`console.log`/załącznik z tokenem lub `Authorization` | warning |
| `insecure-http` | `http://` do hostów innych niż localhost | info |

**Wdrożenie:** skaner tekstowy plików testów i fixture'ów; wzorce sekretów z gitleaks (MIT) + filtr entropii; maskowanie sekretu w raporcie.

## Faza 3: pokrycie bezpieczeństwa względem OpenAPI

| Sprawdzenie | Warunek w spec | Czego szukamy w testach |
| --- | --- | --- |
| `missing-unauthenticated-test` | Endpoint ma `security` | Wywołanie bez tokena + asercja 401 |
| `missing-forbidden-test` | `security` + 403 w `responses` | Token bez uprawnień + asercja 403 |
| `missing-object-level-authz-test` (BOLA/IDOR) | Ścieżka z ID zasobu, np. `/accounts/{id}` | Zasób innego użytkownika + asercja 403/404 |
| `missing-input-validation-test` | `required`, `format`, `maxLength`, `enum` | Niepoprawne dane + asercja 400/422 |
| `undocumented-endpoint-tested` | Endpoint w testach, brak w spec | Info: nieaktualna spec albo ukryte API |

**Wdrożenie:**

1. Rozszerz `OpenApiTarget` o `security`, `responses`, schemat parametrów.
2. Dla każdego wywołania HTTP w teście zapisz: endpoint, oczekiwany status, czy wysłano auth, czy ID pochodzi od innego użytkownika. Najpierw Karate, potem Playwright `request`.
3. Klasyfikacja: `happy`, `unauth`, `forbidden`, `cross-user`, `invalid-input`.
4. Wynik: macierz endpoint × rodzaj testu, braki posortowane po ryzyku.
5. Implementacja od zera, bez kopiowania cudzego kodu.

## Faza 4: sędzia LLM i selektywny mutation testing

**LLM jako sędzia (tylko pliki zmienione w PR):**

1. Wejście: diff testu + kod modułu + nazwa testu + wyniki reguł statycznych.
2. Pytania zamknięte, odpowiedź JSON: czy test sprawdza zachowanie z nazwy, pominięte przypadki brzegowe, czy asercje wykryłyby błąd.
3. Wynik: ocena 1–5 + uzasadnienie + propozycja brakującego testu.
4. Zbiór 50–100 testów z ręcznymi ocenami do mierzenia zgodności sędziego przy każdej zmianie promptu.
5. Cache po hashu pliku.

**Mutation testing:** Stryker (JS/TS) i PIT (Java) tylko na zmienionych liniach; Testpulse orkiestruje i czyta raporty; limit czasu ~5 min.

## Faza 5: aplikacje AI i serwery MCP

**A. Pokrycie ryzyk LLM (OWASP Top 10 for LLM):** `missing-prompt-injection-test`, `missing-system-prompt-leak-test`, `missing-output-handling-test`, `nondeterministic-exact-match`, `eval-without-baseline`.

**B. `testpulse audit-mcp`:** pobierz `tools/list`; flaguj ukryte instrukcje w opisach (tool poisoning), nadmiarowe uprawnienia, brak testów kontraktowych. Demo tylko na publicznych serwerach MCP.

## Integracja z CI

1. `--changed-since origin/main` – tylko zmienione pliki.
2. `--format sarif` – adnotacje w GitHub Files changed.
3. Komentarz na PR (aktualizowany): nowe problemy, wynik przed/po, top 3 sugestie.
4. Bramka: `fail-on: critical` albo spadek wyniku o > N punktów.

## Walidacja

Każda reguła: ≤ 10% fałszywych alarmów na korpusie i ≥ 1 prawdziwy problem w realnym repo.

Korpus `packages/cli/test/corpus/`: złe/dobre przykłady na regułę; testy wygenerowane przez AI dla 3–5 małych projektów; 10–20 repo open source z ręcznie oznaczoną próbką.

Metryki: precyzja reguły, wykrywalność slopu, zgodność sędziego LLM, korelacja z mutation score.

## Harmonogram (8–10 h tygodniowo)

| Tygodnie | Etap | Kamień milowy |
| --- | --- | --- |
| 1–2 | Fundament: rejestr reguł, model TestCase, korpus | |
| 3–4 | Faza 1: 10 reguł AI slop, naprawiony no-assertion | v0.2 + post o AI slop |
| 5 | Faza 2 + CI: sekrety, TLS, SARIF, komentarz na PR | |
| 6–8 | Faza 3: macierz pokrycia bezpieczeństwa z OpenAPI | demo na 10 repo OSS |
| 9–10 | Faza 4: sędzia LLM + mutation testing | |
| 11–12 | Faza 5: OWASP LLM, audit-mcp | launch: Show HN, artykuł, CV |

**Granica:** do repozytorium nie trafia nic z kodu ani danych pracodawcy ani klientów.
