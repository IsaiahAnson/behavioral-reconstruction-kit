# Set up REA with the reconstruction kit

REA investigates the shipped original app and produces Evidence. This kit runs repeatable browser cases against the original and your candidate app. You can run the kit's demo before installing REA; use REA when you need to support a claim about the original with evidence.

## 1. Check Node.js and install the kit

Install Node.js and npm, then check their versions:

~~~sh
node --version
npm --version
~~~

This guide uses **rea-agents@6.7.0**, the version pinned by **npm run check:rea-mcp**. That release supports Node.js 22.19 or newer in the 22.x line, 24.11 or newer in the 24.x line, or Node.js 26 and newer. Newer REA releases may require a newer Node.js version.

In the reconstruction kit repository, install its dependencies and browser:

~~~sh
npm ci
npm run setup:browser
~~~

## 2. Connect REA to your coding agent

Run REA's setup command in a terminal:

~~~sh
npx -y rea-agents@6.7.0 setup
~~~

Select the agent you use, review the configuration paths and proposed changes, then approve the setup. Restart that agent when setup finishes so it can load the new MCP connection and REA workflow. REA's [installation guide](https://github.com/morluto/rea/blob/main/docs/installation.md) covers supported clients and optional native analysis engines.

## 3. Check the connection

From the reconstruction kit repository, run:

~~~sh
npm run check:rea-mcp
~~~

This starts the pinned REA MCP server, performs a handshake, and prints a positive **tool_count** when the server works. It does not by itself prove your agent loaded the connection. If you selected Codex, you can also inspect its registration with:

~~~sh
npx -y rea-agents@6.7.0 doctor --client codex --format json
~~~

If your agent does not show REA tools after setup, restart it and use the diagnostics from **doctor** or the [official installation guide](https://github.com/morluto/rea/blob/main/docs/installation.md).

## 4. Save original-app evidence beside your cases

1. Choose one feature and record the exact original app version, starting state, action, and expected result.
2. Ask your REA-enabled agent to investigate that feature in the shipped original. Have it save the full Evidence JSON and give you the Evidence ID. For JavaScript or Electron artifacts, REA can begin static analysis without a native decompiler; native binaries may need a configured provider.
3. Copy the Evidence JSON into your own project folder, such as **../my-reconstruction/evidence/add-behavior.json**.
4. In that project's **target.json**, add a reference to the relevant claim. Replace the sample ID below with the exact **evidence_id** from your saved REA record (often under **data.evidence_id**):

~~~json
"evidence_refs": [
  {
    "file": "evidence/add-behavior.json",
    "evidence_id": "ev_<the 64 hexadecimal characters from REA>"
  }
]
~~~

5. Capture the same behavior in the original and candidate, then run **compare** and **check** as shown in the [main README](README.md#compare-your-own-apps).

If **check** stays **open**, read its reasons. Missing Evidence, a mismatched ID or artifact digest, or a case without a passing comparison must be resolved separately. A saved code trace alone does not prove that the user-visible behavior occurred.

## When updating REA

This repository intentionally checks **rea-agents@6.7.0**. To use another release, first verify its [Node.js requirements](https://github.com/morluto/rea#quick-start), then update the pinned version in **scripts/check-rea-mcp.js** and this guide together. Rerun REA setup for your agent and restart it; setup manages its own versioned registration. The official [REA installation guide](https://github.com/morluto/rea/blob/main/docs/installation.md) is the source for current provider and platform instructions.
