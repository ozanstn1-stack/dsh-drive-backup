# dsh-drive-backup

rclone backup tooling for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`dsh-drive-backup` gives your DSH agent a small, explicit set of backup tools on
top of [rclone](https://rclone.org/): see what is configured, check whether the
remote copy is current, verify it, and run a transfer — the last one only with
your approval.

Targets are an allow-list from config, commands are argv arrays (never shell
strings), a dry run is free, and every real transfer leaves one audit line.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `backup_targets` | read-only | Lists configured targets: local path, rclone destination, mode, timeout, excludes. |
| `backup_status` | read-only | Local size, remote size and the newest remote files for one target or all of them. |
| `backup_verify` | read-only | `rclone check` between the local path and the remote copy; reports matches, differences and samples. |
| `backup_transfer` | approved | Runs `rclone copy`/`sync` for one target. `dryRun: true` needs no approval; a real transfer asks first. |

## Modes

- **`copy`** (default) — uploads new and changed files, **never deletes** remote
  files. Safe for timestamped backups.
- **`sync`** — mirrors the local path; files missing locally are **deleted**
  remotely. Opt in per target.

## Install

```bash
dsh plugin --profile web add dsh-drive-backup
systemctl restart dsh-web   # or restart your DSH process
```

Then configure the rclone remote and your targets:

```yaml
- id: drive-backup
  config:
    remote: grive
    targets:
      - id: openviking
        label: OpenViking memory
        local: /root/backups
        remotePath: dsh-backups/openviking
        mode: copy
        timeoutMs: 600000
      - id: kod
        label: Code and configs
        local: /root/backups
        remotePath: dsh-backups/kod
        mode: copy
        excludes: ['*.log', '*.dump']
    verify:
      sizeOnly: true
    safety:
      readOnly: false
      requireApproval: true
      timeoutMs: 120000
      maxOutputBytes: 65536
    audit:
      file: /root/.dsh/logs/drive-backup-audit.log
```

`rclone` must already be configured for the remote (`rclone config`); this plugin
never touches rclone's config file and never reads credentials.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `remote` | `grive` | rclone remote name. |
| `rclone` | `rclone` | rclone executable name or absolute path. |
| `targets[].id` | — | Stable id used by the tools (`[a-z0-9_-]`). |
| `targets[].label` | `''` | Human label; the model may use it instead of the id. |
| `targets[].local` | — | Absolute local file or directory. |
| `targets[].remotePath` | — | Path below the remote root, relative, no `..`. |
| `targets[].mode` | `copy` | `copy` or `sync`. |
| `targets[].excludes` | `[]` | rclone exclude patterns. |
| `targets[].transfers` | `4` | Parallel transfers. |
| `targets[].timeoutMs` | `600000` | Wall-clock limit for this target. |
| `verify.sizeOnly` | `true` | Compare sizes only; `false` compares hashes (slow). |
| `safety.readOnly` | `false` | When true, `backup_transfer` refuses; inspection still works. |
| `safety.requireApproval` | `true` | Real transfers ask the host first. |
| `safety.timeoutMs` | `120000` | Default command timeout. |
| `safety.maxOutputBytes` | `65536` | Output cap per call. |
| `audit.file` | `<DSH_HOME>/logs/drive-backup-audit.log` | Audit file. |

## Safety model

- **Allow-list.** Only configured targets exist; an unknown id is rejected with
  the configured list, and the model is told not to guess names.
- **argv only.** `rclone` runs as executable plus argument array; target paths
  never become shell syntax, and remote paths are validated (relative, no `..`).
- **Dry run first.** `backup_transfer` with `dryRun: true` lists what would move and
  needs no approval.
- **Fail-closed approval.** A real transfer runs only on `allowed-once`; a
  missing or throwing approval answerer means nothing happens.
- **Bounded.** Each transfer has a timeout and an output cap.
- **Audited.** One JSON line per attempt:
  `{"ts":"…","tool":"backup_transfer","target":"openviking","mode":"copy","outcome":"executed",…}`.

## Example flow

```
backup_status                              → what is local, what is remote, how fresh
backup_transfer {id:"openviking", dryRun:true}  → what would be uploaded (no approval)
backup_transfer {id:"openviking"}               → approval card → transfer → audit line
backup_verify {id:"openviking"}            → "2 files match, 0 differ"
```

## Requirements

- DSH `>= 0.2.1-rc.4` (Node `^22.19.0 || >=24.0.0`).
- `rclone` on PATH (or configured by absolute path) with the remote set up.

## Development

```bash
npm run link-peers
node --test
```

## License

MIT
