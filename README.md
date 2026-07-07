<p align="center">
  <img src="media/hero.png" alt="Sitegeist" width="400">
</p>

An AI assistant that lives in your browser sidebar. Built for collaboration, not autonomy theater. You guide, it executes.

Sitegeist can automate repetitive web tasks, extract data from any website, navigate across pages, fill out forms, compare products, compile research, and transform what it finds into documents, spreadsheets, or whatever you need. It works on any website through a Chrome/Edge side panel, using the AI provider of your choice.

Bring your own API key or log in with an existing subscription (Anthropic Claude, OpenAI/ChatGPT, GitHub Copilot, Google Gemini). Cloudflare Workers AI is also supported with your Cloudflare account ID and API token. Your data stays on your machine. Nothing is collected or tracked.

## Download & Install

Visit [sitegeist.ai](https://sitegeist.ai) for download links and step-by-step installation instructions.

Requires Chrome 141+ or Edge equivalent.

## Development

Clone this repo plus its local sibling dependency into the same parent directory:

```
parent/
  mini-lit/          # https://github.com/badlogic/mini-lit
  sitegeist/         # this repo
```

Install dependencies in each repo:

```bash
(cd ../mini-lit && npm install)
npm install
```

The Pi runtime packages are installed from npm as `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-web-ui`.

`npm install` sets up the Husky pre-commit hook automatically.

Start all dev watchers (mini-lit, sitegeist extension, marketing site):

```bash
./dev.sh
```

Changes in `../mini-lit` are rebuilt automatically and picked up by the sitegeist watcher.

To create a production build:

```bash
npm run build
```

The build script compiles `../mini-lit` first so a fresh clone does not depend on pre-existing local build output.

To run only the extension watcher without dependencies or the marketing site:

```bash
npm run dev
```

### Loading the extension

1. Open `chrome://extensions/` or `edge://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select `sitegeist/dist-chrome/`
5. Click "Details" on the Sitegeist extension and enable:
   - **Allow user scripts**
   - **Allow access to file URLs**

The extension hot-reloads when the dev watcher rebuilds.

### First run

On first launch, Sitegeist prompts you to connect at least one AI provider. You can log in with a subscription or enter an API key.

Some subscription logins require the CORS proxy (configurable in Settings > Proxy). The default proxy is `https://proxy.mariozechner.at/proxy`.

## Checks

```bash
./check.sh
```

Runs formatting, linting, and type checking for the extension and the `site/` subproject.

The Husky pre-commit hook runs the same checks before each commit.

## CLI bridge

Sitegeist can expose the active browser tab to terminal agents through a local WebSocket bridge.

See [docs/local-bridge.md](docs/local-bridge.md) for the full protocol, security model, and local review adapter contract.

Build and link the CLI once:

```bash
cd cli
npm install
npm run build
npm link
```

Start the bridge in a terminal:

```bash
sitegeist bridge
```

The bridge listens on `ws://127.0.0.1:17373` by default.

Open the Sitegeist side panel in Chrome so the extension connects to the bridge, then run:

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

To let Sitegeist chat hand browser evidence to a local coding harness, start the bridge with a review command:

```bash
sitegeist bridge --review-command 'node /path/to/review-page-issue.mjs'
```

You can also use `SITEGEIST_REVIEW_COMMAND` instead of the flag. When the chat calls the `local_agent_review` tool, the bridge passes a JSON payload to the command on stdin:

```json
{
  "protocolVersion": 1,
  "command": "review_page_issue",
  "request": {
    "problem": "Poster image is broken",
    "workspaceHint": "anopalabas.com",
    "evidence": {
      "active": {
        "url": "https://example.com/movie/example",
        "title": "Example"
      },
      "page": {
        "url": "https://example.com/movie/example",
        "title": "Example",
        "visibleText": "..."
      }
    }
  },
  "receivedAt": "2026-07-06T00:00:00.000Z"
}
```

The command should print its review to stdout. This keeps the browser extension independent from the local harness: the command can call Pi, Codex, Claude Code, a project-specific checker, or any other local agent.

The command is configured when you start the local bridge. Web pages cannot choose the command, and browser-origin bridge commands are rejected unless they come from the Sitegeist extension connection.

The extension behaves normally when the bridge is not running.

## Building

```bash
npm run build
```

The unpacked extension is written to `dist-chrome/`.

## Updating the website

```bash
cd site && ./run.sh deploy
```

Builds the static site and uploads it to `sitegeist.ai`. Requires SSH access to `slayer.marioslab.io`.

## Releasing

```bash
./release.sh patch   # 1.0.0 -> 1.0.1
./release.sh minor   # 1.0.0 -> 1.1.0
./release.sh major   # 1.0.0 -> 2.0.0
```

Bumps the version in `static/manifest.chrome.json`, commits, tags, and pushes. GitHub Actions builds the extension and creates a release at [github.com/badlogic/sitegeist/releases](https://github.com/badlogic/sitegeist/releases).

## License

AGPL-3.0. See [LICENSE](LICENSE).
