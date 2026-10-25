# Tooling to add around REA

Research date: 2026-10-25. This shortlist extends [REA_PLAYBOOK.md](REA_PLAYBOOK.md). It ranks additions by the gap they close in a behavioral reconstruction, not by how many tools they expose. The core stack has since been installed and a first kit implementation is in this workspace; target-specific tools remain conditional.

## Recommended core stack

| Priority | Addition | Use it for | Relationship to REA | Current decision |
| --- | --- | --- | --- | --- |
| 1 | [Playwright Test](https://playwright.dev/docs/intro) (`@playwright/test`) | Durable browser journeys, assertions, screenshots, traces, and regression runs | REA explains/captures the original; Playwright repeatedly tests the original and candidate against the same behavior contract | **Installed** with Chromium |
| 1 | [Curated Playwright CLI skill](https://github.com/openai/skills/blob/main/skills/.curated/playwright/SKILL.md) | Fast agent-led browser exploration and snapshot/screenshot collection | Helps discover scenarios before committing them as test cases | **Installed** in Codex |
| 2 | [fast-check](https://fast-check.dev/docs/advanced/model-based-testing/) | Generate and shrink edge inputs or action sequences for a known state machine | Finds counterexamples to rules inferred from REA and a few manual scenarios | **Installed**; used in kit verification |
| 2 | A small local `reconstruction-kit` | Link cases, REA Evidence IDs, artifact digests, comparison results, and unresolved gaps | Automates the bookkeeping that makes evidence reusable across features | **Built** in `src/`; see [README.md](README.md) |

Playwright Test has retrying UI assertions and screenshot baselines; its trace viewer helps locate a divergent step. Its Electron support is marked experimental, and native Electron dialogs need separate handling. The curated Playwright skill is CLI-first and useful for exploration; it is not itself a persistent regression suite. [Playwright assertions](https://playwright.dev/docs/test-assertions), [visual comparisons](https://playwright.dev/docs/test-snapshots), [trace viewer](https://playwright.dev/docs/trace-viewer), [Electron support](https://playwright.dev/docs/api/class-electron).

The separate [Playwright Interactive skill](https://github.com/openai/skills/blob/main/skills/.curated/playwright-interactive/SKILL.md) requires `js_repl`, which is not exposed in this Codex session. Installing it now would not unlock its intended workflow. The [Playwright MCP server](https://github.com/microsoft/playwright-mcp) can automate exploratory interactions, but its own documentation describes higher tool/schema context cost than CLI use. I would choose the CLI skill for exploration and Playwright Test for durable cases before adding another browser MCP server.

## Conditional tools

| When the target requires it | Candidate | Concrete gain | Why it waits |
| --- | --- | --- | --- |
| Network behavior is central or browser capture misses traffic | [mitmproxy](https://github.com/mitmproxy/mitmproxy) | Capture HTTP(S)/WebSocket flows and export HAR; REA can inspect saved HAR without fetching recorded URLs | Proxy setup and traffic selection should follow a specific unanswered network question. [REA capture reader](https://github.com/morluto/rea/blob/main/docs/web-network-captures.md) |
| Candidate app depends on unstable APIs | [Mock Service Worker](https://github.com/mswjs/msw) | Deterministic success, failure, empty, delayed, and malformed responses in browser/Node tests | Mock cases must be derived from original observations; mocks alone cannot prove original behavior |
| Important UI is inaccessible or keyboard behavior matters | [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md) | Automated accessibility checks inside Playwright journeys | Complements behavior comparison; it does not establish exact parity with the original |
| Need detailed frontend performance diagnosis | [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Performance traces, network request details, console/source-mapped debugging | Its browser automation overlaps Playwright and REA; attach for a performance or debugging question, not as the default navigator |
| Original is a native Windows desktop app | [FlaUI](https://github.com/FlaUI/FlaUI) or [robocorp.windows](https://github.com/robocorp/robocorp/blob/master/windows/README.md) | Windows UI Automation controls and repeatable desktop actions | Browser tooling cannot test native controls. Choose a harness after inspecting the target's accessibility tree and language/runtime |
| Original contains native binary code | [Ghidra](https://github.com/NationalSecurityAgency/ghidra), or an already-licensed Hopper/IDA | Deep native disassembly and decompilation through REA | Current REA doctor reports no native provider. Install a version compatible with the selected REA release only after a native target is identified |
| Original is an Android APK | [JADX](https://github.com/skylot/jadx) and REA's supported headless integration | Decompiled Android code and references | The APK route has separate Java/JADX prerequisites; a random JADX download does not automatically configure REA |
| Original is .NET and decompiled C# detail is needed | [ILSpy / ilspycmd](https://github.com/icsharpcode/ILSpy) | Independent C# reconstruction to cross-check REA's managed metadata findings | Add for a concrete managed target; decompiled C# remains a reconstruction, not original source |

The curated [screenshot skill](https://github.com/openai/skills/blob/main/skills/.curated/screenshot/SKILL.md) is useful for an OS-level capture when no target-specific capture exists. It is not a substitute for action/state assertions. The community [REA-Prompts](https://github.com/JoasASantos/REA-Prompts) repository is reference text rather than a capability to install.

## Custom code worth building: `reconstruction-kit`

REA already has [reconstruction obligation ledgers](https://github.com/morluto/rea/blob/main/docs/reconstruction-obligation-ledgers.md) and [coverage evaluation](https://github.com/morluto/rea/blob/main/docs/reconstruction-coverage.md). A local wrapper should feed them and organize actual tests, not reinvent their evaluator.

Suggested structure after an original app is selected:

```text
reconstruction-kit/
  target.json              # original path, version, SHA-256, OS, test account/data
  cases/                   # one scenario and expected artifacts per behavior
  evidence/                # saved full REA Evidence bundles and capture references
  tests/                   # Playwright or Windows UI Automation cases
  reports/                 # pass / changed / unknown, with first divergent step
  src/check-ledger.*       # verifies links, digests, required cases and unresolved gaps
```

The case schema should require: feature ID, original artifact digest, initial state, action sequence, settlement condition, expected output/side effects, original capture ID, REA Evidence IDs, implementation owner, verifier command, result, and remaining unknowns. The wrapper can run cases on both apps with the same fixture, normalize only declared volatile values, and produce a compact divergence report. It should preserve complete raw captures for audit while showing the agent only the failed step and nearby evidence.

Once a feature has observed cases and an owner, the wrapper can emit a reviewed REA obligation and manifest binding. REA's formal ledger can then reject claims with missing comparable proof. The wrapper should never convert an inferred static relationship into an observed runtime result.

## Companion skill worth authoring

Create a short `behavioral-reconstruction` skill that references the existing REA skill and the `reconstruction-kit` commands. It would require the agent to:

1. Identify the shipped target and comparison scope.
2. Capture discriminating original-app cases before coding.
3. Trace only the code paths relevant to a case and retain Evidence IDs/coverage.
4. Implement one vertical slice and run differential cases.
5. Report passes, observed differences, and unknowns separately.

The skill should not copy REA's large tool catalog or prescribe one browser automation framework for every target. A project-specific `AGENTS.md` can name the selected original artifact, fixture locations, and completion boundary after the first pilot.

## Sequence I recommend here

1. Select one original application artifact and one high-value feature. The Branchline directory available in this workspace currently contains no implementation or target artifact.
2. For a browser or Electron target, attach the curated Playwright CLI skill for exploration and build 3–5 Playwright Test cases, including a failure and a persistence/restart case where relevant.
3. Save REA Evidence against the exact artifact digest; connect each case to its Evidence IDs and classify static inference versus observed behavior.
4. Build the `reconstruction-kit` around those real cases, then add fast-check for rules with many inputs or state transitions.
5. Add network, native, Android, .NET, or Windows desktop tools only when the pilot reveals that dependency.

The core kit is in this repository. In the development environment, Playwright, Chromium, `fast-check`, the curated Playwright skill, and the companion behavioral reconstruction skill were installed, and REA MCP was registered in Codex. Optional native, Android, network, and Windows desktop tools remain target-specific additions.
