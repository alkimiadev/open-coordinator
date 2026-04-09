<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/pattern-dark.svg" />
  <img alt="Warm paper pattern" src="assets/brand/pattern-light.svg" width="100%" />
</picture>

# Installation

## Prerequisites

- [Bun](https://bun.sh/) runtime (for package management and CLI)
- [Git](https://git-scm.com/) 2.15+ with worktree support
- [OpenCode](https://opencode.ai/) AI assistant

## Single-Command Install

```bash
bunx open-coordinator add
```

This updates your OpenCode config (default: `~/.config/opencode/opencode.json`).
OpenCode installs npm plugins automatically at startup (cached in `~/.cache/opencode/node_modules`).

## Manual Config

Add the plugin to your OpenCode configuration file:

```json
{
  "plugin": ["open-coordinator"]
}
```

Optional: target a specific config file:

```bash
bunx open-coordinator add --config /path/to/opencode.json
```

### CLI Options

```bash
bunx open-coordinator add --help
```

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to opencode.json/opencode.jsonc |
| `--plugin <name>` | Plugin name to add (default: `open-coordinator`) |
| `--dry-run` | Print result without writing |

## Local Development Installation

For development or testing with local changes:

```bash
git clone https://github.com/your-org/open-coordinator.git
cd open-coordinator
bun install
bun run build
```

Add the plugin using the absolute path:

```json
{
  "plugin": ["/absolute/path/to/open-coordinator"]
}
```

## Verify Installation

Run the mode command to confirm installation and view the tool list:

```bash
worktree_mode
```

Expected output includes the current mode status, default worktree root, and examples for:

- `worktree_mode`
- `worktree_overview`
- `worktree_make`
- `worktree_cleanup`
