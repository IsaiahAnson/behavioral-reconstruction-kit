# REA playbook for reconstructing an application's behavior

Research date: 2026-10-24 (America/New_York); implementation update: 2026-10-25. Sources: [REA](https://github.com/morluto/rea), [REA documentation](https://github.com/morluto/rea/tree/main/docs), and [REA-Prompts](https://github.com/JoasASantos/REA-Prompts). I inspected the published `rea-agents@6.7.0` CLI and the repository's current `main` checkout. Treat the connected tool catalog and `rea --help` as the authority for a specific installation: `main` can be ahead of npm even while its package version still reads 6.7.0.

For a ranked survey of tools and skills to add, see [TOOLING_SHORTLIST.md](TOOLING_SHORTLIST.md).

## The operating principle

REA is an evidence collection and analysis layer. It can expose shipped code structure, relationships, and bounded runtime observations. It does not automatically recover every state, prove that a static path executed, or certify that two applications are functionally equivalent. The highest fidelity comes from a repeated loop:

**Record behavior in the original → trace the responsible code or data → write a small behavior contract → implement → run the same scenario against both → investigate each difference.**

The important deliverable is a *tested behavioral specification*, not a large decompilation dump or one broad clone prompt.

## Route to the right evidence

| Original target | First useful route | What to pair it with |
| --- | --- | --- |
| Web app | `capture_browser_scenario` for a controlled action; `inspect_web_page` for an existing page | DOM, accessibility, URL, screenshot, storage and network artifacts selected for the question; `export_web_scripts` / `analyze_web_bundle` for code candidates |
| Electron or shipped JavaScript | `analyze_javascript_application` on the shipped ASAR or extracted app, usually with a summary first | `trace_application_feature` / `trace_javascript_semantics`; Electron renderer observation or scenario for runtime confirmation; inspect native `.node` handoffs only if relevant |
| Unknown desktop installation | `inspect_desktop_application` on the installation directory | Follow the reported runtime candidate into Electron, .NET, native, or package tools |
| Native executable | `open_binary`, then a targeted overview/string/function/reference query with Hopper, Ghidra or IDA | Controlled input/output observations and selected function dossiers; static pseudocode is inferred, not original source |
| .NET app | `inspect_managed_artifact` | Focused member/reference analysis and original-app behavior cases |
| Android APK | Package and manifest inventory, then `inspect_android_package` with JADX for code questions | UI scenarios, resource inspection, persistence and network observations as needed |

Sources: [REA target routes](https://github.com/morluto/rea#what-you-can-analyze), [JavaScript artifact workflow](https://github.com/morluto/rea/blob/main/docs/javascript-artifact-reconstruction.md), [desktop inspection](https://github.com/morluto/rea/blob/main/docs/desktop-applications.md), [browser scenarios](https://github.com/morluto/rea/blob/main/docs/browser-scenario-contract.md).

## The repeatable workflow

### 1. Fix the target and comparison boundary

Record the original's product/version, OS, installed package path, file digest, account/data fixture, locale, viewport, feature flags, and external service state. Define which surfaces count: UI, keyboard, clipboard, persistence, export/import, API, error behavior, performance thresholds, or background work. A newer app build or a changed account can invalidate a comparison. Avoid treating a source repository as the shipped app unless that is the actual comparison target.

### 2. Map user journeys before decompiling

Choose a small number of important journeys and write a state-transition table. For each journey record:

- Initial state and setup data.
- Trigger: click, shortcut, input, navigation, file operation, or API request.
- Visible result and timing/settlement condition.
- Side effects: storage, requests, files, clipboard, notifications, background process.
- Positive, empty, invalid, boundary, interruption, restart, and undo cases where relevant.

Use controlled scenarios with stable `step_id` values. Capture the artifact that can actually answer the question: an unchanged URL cannot prove what rendered. The REA browser scenario guide explicitly recommends DOM/accessibility for text and structure, screenshots for appearance, and network events/content when requests matter. Wait for a condition tied to the *current* action, rather than merely seeing an old result container. [Source](https://github.com/morluto/rea/blob/main/docs/browser-scenario-contract.md).

### 3. Analyze the shipped artifact once, then narrow

For a large JavaScript/Electron artifact, request `detail: "summary"` through MCP, save the parent Evidence ID, inspect relevant module pages, then trace an exact seed such as a route, IPC channel, string, endpoint, or known node. Use semantic tracing only when a question needs input provenance or forward influence. Keep module `node_id` rather than assuming a path uniquely identifies a graph role. A trace is a graph of candidates and inferred relationships, not proof of execution. Reuse retained Evidence instead of rerunning the broad analysis. [Source](https://github.com/morluto/rea/blob/main/docs/javascript-application-workflows.md).

For a website, inspect/capture the page, export *captured* scripts into a new directory, and analyze those files. Keep the capture's URL, frame, and byte identity; exported script bytes do not prove they executed, nor do they provide a complete website. [Source](https://github.com/morluto/rea/blob/main/docs/website-script-export.md).

For Electron, trace renderer → preload/context bridge → IPC handler → storage/network/native add-on. A visible channel and handler pairing is useful, but registration, reachability, and sender checks remain runtime questions. Correlate static and runtime records with `reconcile_javascript_runtime` when available. A loaded script still does not prove the particular feature executed. [Sources](https://github.com/morluto/rea/blob/main/docs/javascript-artifact-reconstruction.md), [runtime reconciliation](https://github.com/morluto/rea/blob/main/docs/javascript-runtime-reconciliation.md).

### 4. Convert findings into a behavior contract

One feature should have one concise record, with:

| Field | Required content |
| --- | --- |
| Claim | An externally observable rule, stated as an input/state → output/side-effect relation |
| Evidence | Original scenario ID, REA Evidence ID and exact code location or capture artifact |
| Basis | `observed`, `derived`, `inferred`, or `unknown`; retain coverage and limits |
| Cases | Normal, negative, boundary, persistence/restart, and cancellation cases that apply |
| Owner | The module/function that implements the rule in the new app |
| Verification | A repeatable comparison case with the original and new app |
| Gap | The next focused probe if evidence is insufficient or contradictory |

Do not turn a string occurrence, inferred call edge, or absent search result into a confirmed behavior. Require a runtime observation for claims about what the user actually sees or what a process actually does. REA's obligation ledger and coverage tools can formalize this for complex reconstructions, but a simple human-readable ledger is enough to start. [Sources](https://github.com/morluto/rea/blob/main/docs/reconstruction-obligation-ledgers.md), [coverage evaluator](https://github.com/morluto/rea/blob/main/docs/reconstruction-coverage.md).

### 5. Implement by slice, then compare

Build one vertical slice from trigger to side effect. Run equivalent cases on original and candidate with the same starting state and environment. REA's `compare_web_captures` can align browser scenario steps by `step_id` and compare selected artifacts; missing or truncated capture evidence stays unknown. It compares screenshots by content digest, so use a visual testing tool when small pixel differences need tolerances. Playwright Test supports screenshot baselines, and Trace Viewer helps diagnose failures. For CLI/process targets, REA can compare process captures, but **new process capture is unavailable on native Windows** in the current documentation; Linux/macOS or a separate harness is needed. [Sources](https://github.com/morluto/rea/blob/main/docs/browser-scenario-contract.md), [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots), [Playwright traces](https://playwright.dev/docs/trace-viewer), [REA process capture](https://github.com/morluto/rea/blob/main/docs/process-capture.md).

Classify each result as pass, observed difference, or unknown. Store counterexamples as fixtures. Fix the first divergent transition, rerun its case, then rerun nearby cases. Do not claim full equivalence from a few passing examples.

### 6. Stop by a declared boundary

Completion means every *required* behavior in the declared scope has an implementation owner and comparable passing cases, with no unresolved high-impact unknown or contradiction. REA's reconstruction obligation ledger is intentionally conservative: static graph facts create candidates, while closure needs an owner, required case fixtures, and a verifier with comparable authority. The evaluator checks supplied Evidence; it does not independently run the original app. [Source](https://github.com/morluto/rea/blob/main/docs/reconstruction-obligation-ledgers.md).

## Efficiency and accuracy rules

1. **Prefer one feature and one question per REA investigation.** Wide traces and complete app maps consume context and mix unrelated graph relations.
2. **Start with behavior.** Code inspection explains observed behavior and finds branches worth probing; the original app remains the oracle for functional similarity.
3. **Use `summary` and retained views.** In a local smoke test, published REA 6.7.0 emitted a 625 KB Evidence record for its six-file Electron fixture (2,303 text bytes read). It reported 22 findings and partial graph coverage. A broad result can be large even for a tiny target.
4. **Preserve provenance.** Save the full Evidence JSON or bundle, artifact SHA-256, REA version, source build, scenario settings, and limitations. Pass compact references and extracted findings into implementation discussions.
5. **Treat static and runtime evidence separately.** Static analysis can show a possible path; runtime capture shows a selected event. Neither alone proves the complete state space or causal chain.
6. **Prioritize risky and important behavior.** State transitions, persistence, validation, async work, IPC, and failures usually cause more functional mismatches than decorative UI details.
7. **Use boundary cases to challenge inferred rules.** One happy-path example can fit several wrong implementations. Test empty input, duplicates, malformed data, restart, concurrent actions, and cancellation when applicable.
8. **Avoid accidental false comparisons.** Match versions, data fixtures, viewport, locale, authentication, feature flags, and service responses. Normalize only documented nondeterministic fields.

## How to use REA-Prompts

The community prompt repository is useful as a menu of *questions*. Its strongest habit is asking for evidence and separating confirmed facts from hypotheses. The “full application clone” prompt is a useful outline for a spec, but “every feature” cannot be established by a broad scan, and a prompt asking for one proving input is too weak for fidelity. Replace its large one-shot clone request with per-feature investigation plus a shared ledger and differential tests. `verify_reconstruction` and other tools must be checked against the connected server's actual tool list; a prompt cannot make an unavailable capability exist. [Source](https://github.com/JoasASantos/REA-Prompts#4-software--feature-cloning).

### Copyable feature prompt

```text
Investigate [FEATURE] in the shipped [APP VERSION] at [ABSOLUTE PATH], for
[OS/ACCOUNT/DATA FIXTURE]. The intended clone must match these observable
surfaces: [SURFACES].

1. List the smallest set of original-app scenarios that distinguishes plausible
   behaviors, including normal, boundary, failure, and persistence cases.
2. Capture the selected original scenarios with the artifacts needed to answer
   each question. Record exact initial state and settlement condition.
3. Use REA on the shipped artifact. Start with a summary, reuse retained Evidence,
   and trace only entry points connected to this feature through outputs and
   side effects. Follow native or backend handoffs only when relevant.
4. Write a behavior contract. For each rule give the scenario/Evidence ID,
   source location, basis (observed/derived/inferred/unknown), coverage limit,
   and a test that could falsify it.
5. Implement the rule in [PROJECT] from the contract. Run matching scenarios on
   the original and candidate; report passes, divergences, and unknowns. Do not
   claim equivalence beyond the tested boundary.
```

## Research environment and Branchline limit

- The REA skill was aligned with published `rea-agents@6.7.0` (skill version 42, 207 advertised MCP tools). The CLI worked through `npx`.
- On 2026-10-25, REA MCP was registered for Codex through its scoped setup command. `doctor --client codex --json` reported an aligned registration and skill, and a standalone MCP handshake returned 207 tools. A running Codex session needs a restart before newly registered MCP tools appear.
- No Hopper, Ghidra, IDA, JADX or Kuna provider is configured. This matters for native/APK deep analysis, not for static JavaScript.
- The published npm package accepts the current Node 24.13.1 according to its own engine range and doctor check. Repository `main` now declares Node 24.22.1+ for the 24.x line. Pinning package version and checking the installed catalog avoids relying on documentation for unreleased changes.
- The local Branchline project available during this study contained only `.git` and one initial commit. There was no implementation or original target artifact to audit, so the study cannot attribute past accuracy gaps to specific Branchline work.

### Immediate JavaScript CLI path

For an Electron/JavaScript target whose shipped ASAR or extracted directory is available, the CLI can save full Evidence now. Replace the two paths and save the record outside the target directory:

```powershell
$target = 'C:\absolute\path\to\app.asar'
$evidenceFile = 'C:\absolute\path\to\analysis\original-app.json'
npx -y rea-agents@6.7.0 analyze-javascript-application $target --format json --full-output |
  Set-Content -LiteralPath $evidenceFile -Encoding utf8
$record = (Get-Content -LiteralPath $evidenceFile -Raw | ConvertFrom-Json).data
$record.evidence_id
$record.normalized_result.root_artifact_sha256
$record.normalized_result.summary
$record.normalized_result.graph.coverage
$record.limitations
```

This prints a compact orientation while retaining full Evidence on disk. The next step is to select a concrete feature seed and inspect/trace that Evidence. After registering MCP, restart Codex to load it in a new session.

## Highest-value additions

1. **Capture and comparison harness:** implemented in [src/kit.js](src/kit.js) for browser cases, with a local fixture and meaningful comparison tests. It can be populated with real target cases once an original app is selected.
2. **Reconstruction ledger checks:** implemented as `kit check` for claim ownership, Evidence references, case results, and stale capture metadata. These are reference checks; use REA's formal obligation ledger for authenticated closure.
3. **Companion behavioral reconstruction skill:** created and installed in Codex. It coordinates case design, REA evidence, implementation, and differential verification without copying REA's tool catalog.
4. **Install only target-specific engines.** Configure REA MCP for the agent that will use it; add Ghidra/Hopper/IDA for native code, JADX for Android, or other providers only when a concrete target requires them. The published CLI is enough for initial JavaScript work. Keep the REA-Prompts repository as reference text; installing it as a skill adds little without the evidence workflow.

No original application was run in this study. The recommendations above are based on REA's published interface, the repository documentation, the prompt repository, a read-only environment diagnosis, and one local CLI smoke test.
