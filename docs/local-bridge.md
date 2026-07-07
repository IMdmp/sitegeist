# Local Bridge

## Overview

The local bridge lets Sitegeist exchange data with tools running on the same machine. It has two directions:

- Terminal commands can ask the extension to inspect or operate on the active browser tab.
- Sitegeist chat can send current-page evidence to an operator-configured local review command.

The bridge keeps the browser extension independent from any specific coding harness. The local command can wrap Pi, Codex, Claude Code, a project-specific checker, or any other process that reads JSON from stdin and writes a review to stdout.

## Components

```text
Terminal CLI
  -> local WebSocket bridge
  -> Sitegeist extension side panel
  -> active browser tab

Sitegeist chat
  -> local_agent_review tool
  -> local WebSocket bridge
  -> review command
  -> stdout response back to chat
```

## Setup

Build and link the CLI:

```bash
cd cli
npm install
npm run build
npm link
```

Start the bridge:

```bash
sitegeist bridge
```

The default listener is `ws://127.0.0.1:17373`. Open the Sitegeist side panel so the extension connects.

## Browser Commands From Terminal

These commands send a request from the terminal through the bridge to the extension:

```bash
sitegeist tabs
sitegeist active
sitegeist navigate https://example.com
sitegeist eval 'document.title'
sitegeist click 'button[type="submit"]'
sitegeist type 'input[name="email"]' 'you@example.com'
sitegeist press Enter
sitegeist screenshot --out /tmp/sitegeist-shot.png
sitegeist evidence --out /tmp/sitegeist-evidence.json
sitegeist case --out /tmp/sitegeist-case.md
```

Use `--bridge-url` to target a non-default bridge URL.

## Local Agent Review From Chat

Start the bridge with a review command:

```bash
sitegeist bridge --review-command 'node /path/to/review-page-issue.mjs'
```

Or set the command through the environment:

```bash
SITEGEIST_REVIEW_COMMAND='node /path/to/review-page-issue.mjs' sitegeist bridge
```

When the model calls `local_agent_review`, Sitegeist captures the active tab evidence and sends it to the bridge. The bridge runs the configured command, passes the request JSON on stdin, and returns stdout to the chat.

The tool accepts:

- `problem`: concrete page issue or question to investigate.
- `workspaceHint`: optional repo, domain, or project hint for the local command.
- `includeScreenshot`: optional boolean for visual issues.

## Review Command Contract

The command receives this shape on stdin:

```json
{
  "protocolVersion": 1,
  "command": "review_page_issue",
  "request": {
    "problem": "Poster image is broken",
    "workspaceHint": "anopalabas.com",
    "evidence": {
      "active": {
        "id": 123,
        "url": "https://example.com/movie/example",
        "title": "Example",
        "active": true
      },
      "page": {
        "url": "https://example.com/movie/example",
        "title": "Example",
        "visibleText": "...",
        "headings": [],
        "landmarks": [],
        "controls": [],
        "links": [],
        "images": []
      },
      "console": [],
      "screenshot": {
        "type": "image",
        "mimeType": "image/png",
        "data": "..."
      },
      "capturedAt": "2026-07-06T00:00:00.000Z"
    }
  },
  "receivedAt": "2026-07-06T00:00:00.000Z"
}
```

The command should write human-readable review text to stdout. A zero exit code is treated as success. A non-zero exit code is returned to the chat as an error with captured stdout and stderr.

## Example Review Adapter

```javascript
import { readFile } from "node:fs/promises";

const input = await new Promise((resolve) => {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    body += chunk;
  });
  process.stdin.on("end", () => resolve(body));
});

const payload = JSON.parse(input);
const { problem, workspaceHint, evidence } = payload.request;
const pageUrl = evidence.page?.url || evidence.active?.url || "(unknown URL)";

console.log(`# Local review`);
console.log(`Problem: ${problem}`);
console.log(`Workspace: ${workspaceHint || "(not provided)"}`);
console.log(`URL: ${pageUrl}`);
console.log("");
console.log("Add project-specific file search, git inspection, or harness calls here.");
```

For a project-specific adapter, map domains or `workspaceHint` values to local repositories, then call the project checker or coding harness with the page evidence.

## Security Model

- The bridge binds to `127.0.0.1` by default.
- The review command is configured only when the local bridge starts.
- Web pages cannot choose the command.
- Browser-origin terminal commands are rejected unless they come from the connected Sitegeist extension.
- `local-agent-request` messages are accepted only from the registered extension socket.
- The local command is responsible for its own workspace allowlist and command execution policy.

Do not expose the bridge on a public interface unless a stronger authentication layer is added.

## Failure Modes

- If the bridge is not running, `local_agent_review` fails before capturing evidence.
- If no review command is configured, the bridge returns a setup message plus a short request summary.
- If the review command times out, the bridge terminates it and returns a timeout error.
- If the extension side panel closes, pending terminal commands are rejected.

## Related Files

- `cli/bridge.ts` - local WebSocket server and review command adapter
- `cli/cli.ts` - terminal command entry point
- `src/cli-bridge.ts` - extension-side bridge client and page evidence capture
- `src/tools/local-agent.ts` - chat tool for local agent review
