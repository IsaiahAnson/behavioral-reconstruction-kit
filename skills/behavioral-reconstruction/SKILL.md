---
name: behavioral-reconstruction
description: Reconstruct a feature of a shipped application with evidence-linked behavior cases and differential verification. Use for building an app with similar functionality to an original, especially when REA captures or artifact analysis are involved. Skip for ordinary source-only maintenance.
---

# Behavioral reconstruction

Work toward a declared, tested behavior boundary. A source trace, decompiler output, or passing example alone does not establish equivalence.

1. Identify the original artifact or page, its version, the candidate app, and the user-visible behavior in scope. Record the artifact digest when a shipped file is available. Ask for a missing original target only after checking the current workspace and prior context.
2. Describe a few original-app cases that distinguish plausible rules: normal behavior plus relevant empty, invalid, boundary, persistence, or interruption cases. Capture the initial state, action, settlement condition, visible result, and side effects.
3. Use the `reverse-engineer-anything` skill when evidence depends on shipped artifacts or runtime behavior. Start with a summary and reuse retained Evidence. Trace only code and data relevant to the case. Keep observations, static inferences, and unknowns separate.
4. Build the feature in the candidate from a concise behavior contract. Give each required rule an implementation owner and an evidence reference.
5. Run comparable cases against original and candidate. Report the first observed difference and preserve both raw captures. A missing, stale, or incomplete capture stays unknown.
6. If the project includes the `rea-reconstruction-kit`, read its `README.md` and use its `capture`, `compare`, and `check` commands. Its Evidence ID checks are reference checks; use REA's authenticated obligation ledger when formal closure is needed.

Finish by stating the tested boundary, passing cases, remaining differences, and unknowns. Do not generalize from the tested cases to all app behavior.
