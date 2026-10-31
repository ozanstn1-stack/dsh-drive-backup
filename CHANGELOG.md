# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-31

### Added

- `backup_targets`: read-only inventory of the configured targets with local
  path, rclone destination, mode, timeout and excludes.
- `backup_status`: local and remote size plus the newest remote files, for one
  target or all of them.
- `backup_verify`: `rclone check` between a target's local path and its remote
  copy, honouring the target's excludes so verification compares exactly the
  files a transfer would upload.
- `backup_run`: approved `rclone copy`/`sync` per target. `dryRun: true` is free
  and needs no approval; a real transfer goes through the approval gate and
  writes one audit line.
- Config schema for the remote, targets (allow-list), transfer mode, excludes,
  verification mode, safety limits and the audit file.
- Target and remote-path validation, argv-only command building, and pure
  parsers for `rclone size --json`, `lsf` and `check --combined` output.
- Unit tests for every builder and parser plus the approval gate, read-only
  refusal, dry-run path and audit output.
