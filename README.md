# REA reconstruction kit

## In simple terms

This kit helps us check whether an app we're building **behaves like the original**.

For example, we can tell it: “Open both apps, click Add, then reload.” It records what each app shows and saves, compares the results, and points to the first difference. It also links each feature to the REA evidence used to understand it and flags missing or outdated evidence.

That matters because a feature can look right in one screenshot but fail after an error, a reload, or a different input. The kit makes those checks repeatable, so we can find and fix differences one feature at a time. It does not clone an app automatically or prove that every behavior matches.

## How it fits with REA

REA helps investigate the shipped original. This kit adds repeatable browser comparisons between the original and the app we're building. It captures selected results, checks evidence references, and reports differences or unknowns. See the [REA playbook](REA_PLAYBOOK.md) for the investigation workflow and [tooling shortlist](TOOLING_SHORTLIST.md) for target-specific additions.

## Setup

This repository installs `@playwright/test`, `fast-check`, and `ajv` through `package-lock.json`. Install the project dependencies and Chromium in a fresh clone:

```powershell
npm ci
node .\node_modules\playwright\cli.js install chromium
npm test
```

REA is pinned to `rea-agents@6.7.0` in the MCP check script. It can be run through `npx`; connect it to a coding agent using REA's scoped setup workflow and restart that agent. The companion [`behavioral-reconstruction` skill](skills/behavioral-reconstruction/SKILL.md) lives in this repository and can be copied into a Codex skills directory. The curated [Playwright CLI skill](https://github.com/openai/skills/blob/main/skills/.curated/playwright/SKILL.md) is a useful optional companion for browser exploration.

On the development machine, Codex's REA registration, both skills, and Chromium were installed. A standalone MCP handshake returned 207 tools. Native REA providers were left to a target-specific setup.

## Use the kit

Copy `examples/demo` to a new project directory and edit `target.json` and `cases/*.json`. The original and candidate must be reachable at their declared `base_url` values. Record versions, a shared browser environment, feature claims, and the original artifact SHA-256 when one is available.

```powershell
npm run kit -- capture path/to/project case-id original
npm run kit -- capture path/to/project case-id candidate
npm run kit -- compare path/to/project case-id
npm run kit -- check path/to/project
```

`capture` saves full JSON under `runs/`. `compare` saves a report under `reports/` and returns `pass`, `changed`, or `unknown`. `check` aggregates required claims and returns `checks-passed`, `changed`, or `open`. The direct `node src/cli.js` entry point uses exit codes 0 for a pass or all checks passed, 2 for a difference, 3 for unknown/open, and 1 for invalid input or a runtime failure. The npm wrapper can return 1 for a nonzero child exit on Windows; use the JSON status or the direct entry point in automation. Captures are tied to hashes of the case and target manifest; changing either makes the older run unknown until recaptured.

Add `--trace` after the side in a `capture` command to save a Playwright trace. A case may request a `screenshot` observation; the PNG is saved under `runs/assets/` and its SHA-256 is compared exactly. Screenshot equality is byte equality, so use a separate Playwright visual assertion with an appropriate threshold when harmless pixel variation is expected.

The demo intentionally reports `open`: it has no REA Evidence reference, and its URLs require running demo servers. To exercise the browser runner without an external app:

```powershell
node --test
```

Those tests start local servers, compare matching behavior, introduce a deliberate divergence, and check that stale metadata and missing proof do not pass.

Check the pinned REA server command independently of a Codex session with `npm run check:rea-mcp`. It sends MCP `initialize` and `tools/list` over stdio and reports the live tool count.

## Case format

Each case has an `initial_path` and steps with unique IDs. Actions are `observe`, `click`, `fill`, `press`, `reload`, `navigate`, and `wait_for`. Observations are `text`, `value`, `visible`, `url_path`, `local_storage`, and `screenshot`. A locator may use CSS, role, text, label, or test ID. Supply `original_locator` and `candidate_locator` when the two apps expose the same behavior through different elements. Each step stores its selected observations in the run record.

Only selected observations are compared. The runner does not infer that an unobserved side effect is absent. It compares URL paths rather than hosts, so original and candidate may run on different origins. It makes no implicit normalization of text or storage values. Add explicit case design for asynchronous settlement with `wait_for`.

The kit checks that an Evidence reference points to a file whose `evidence_id` matches and, when configured, that its original artifact digest matches. **It does not authenticate REA Evidence cryptographically or prove app equivalence.** Use REA's [obligation ledger](https://github.com/morluto/rea/blob/main/docs/reconstruction-obligation-ledgers.md) for formal Evidence validation and closure. The `checks-passed` status means this kit's declared structural and case checks passed within the selected scope.

## Windows path note

If a Windows workspace path contains `&`, Playwright's generated `npx` command shim may fail. The direct browser installation command used here was:

```powershell
node .\node_modules\playwright\cli.js install chromium
```

`npm run kit -- ...` and `node --test` work from this path.
