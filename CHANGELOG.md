# Changelog

## [Unreleased]

### Added

- Cloudflare Workers AI as a configurable AI provider with account ID and API token settings
- Local `sitegeist` CLI bridge for tab listing, navigation, page eval, trusted browser input, screenshots, raw evidence capture, and Markdown case files from the active browser tab
- `local_agent_review` chat tool for sending current-page evidence to an operator-configured local review command
- White-label brand configuration for product name, manifest identity, welcome chips, mascot assets, links, CLI command name, and proof-brand builds
- Version history and one-click restore for saved skills
- Skill installation from a JSON URL with validation and review before saving
- Full-page and element-region screenshot modes for the image extraction tool
- Trusted native input gestures for chart drag selection, hover tooltips, wheel zoom, positioned clicks, and SVG chart tick helpers
- Inbound `agent-turn` bridge verb: local clients can run a headless agent turn against the active tab over the CLI bridge, streamed back as normalized frames with a resumable session id; busy-rejects while the visible panel is streaming and excludes the human-blocking and debugger tools
- Pinned work window for inbound bridge turns: headless turns run in a dedicated browser window so they keep working while the user browses in their own tabs; toggleable on the debug page ("Pinned Window", default on)

### Changed

- Migrated AI runtime packages from deprecated `@mariozechner/pi-*` packages to `@earendil-works/pi-*`

### Fixed

- Fresh-clone development setup no longer requires the removed `../pi-mono` sibling repository
- Production builds now compile the local `../mini-lit` dependency before bundling Sitegeist
- Chat messages disappearing or leaving the composer stuck in stop mode after completed turns
- Dev hot reload invalidating a sidepanel page opened as a normal browser tab
- Cloudflare Workers AI model selector missing newer hosted models, including GLM-5.2
- Model selector not refreshing the selected model after choosing a Cloudflare Workers AI model
- Cloudflare Workers AI requests not applying the saved Account ID during streaming
- Dependency audit vulnerabilities in the extension and static site toolchains
- Side panel stuck on "Loading..." forever when startup fails; init errors now render with a stack trace
- IndexedDB version conflict ("requested version (4) is less than the existing version (5)") for profiles previously upgraded by an unmerged v5 build; storage now opens at v6

## [1.0.0] - 2026-03-15

### Added

- Browser-based OAuth login for Anthropic (Claude Pro/Max), OpenAI Codex (ChatGPT Plus/Pro), GitHub Copilot, and Google Gemini CLI
- Combined "API Keys & OAuth" settings tab with subscription login and API key entry
- Welcome setup dialog on first launch when no providers are configured
- Auto-select default model for the first provider with a key
- Provider and auth type indicator in the header bar
- Image extraction tool (`extract_image`) with selector and screenshot modes
- Subsequence-based fuzzy search in the model selector
- CORS proxy warning in OAuth sections (orange when enabled, red when disabled)
- GitHub Actions workflow for tagged releases
- `release.sh` script for version bumping and tagged releases

### Changed

- Default model changed to `claude-sonnet-4-6` with `medium` thinking level
- CORS proxy enabled by default
- Model selector only shows models from providers with configured keys
- API key prompt dialog now shows both OAuth login and API key entry for supported providers
- Tool execution set to sequential mode (parallel caused rendering issues in sidebar)
- Site converted to static (removed backend, admin, waitlist signups)
- Download links point to GitHub Releases
- License changed from MIT to AGPL-3.0

### Fixed

- Settings dialog tabs not responding to clicks (upstream `pi-web-ui` built with `tsgo` broke Lit decorator reactivity)
- CORS proxy toggle not updating (same root cause)
- Proxy not applied to API requests (esbuild bundled duplicate `streamSimple` references, breaking identity check)
- Model selector button not updating after picking a model (added `state_change` event to Agent)
- Duplicate tool component rendering during streaming (cleared streaming container on `message_end`)
- Screenshot tool capturing sidepanel instead of the webpage
