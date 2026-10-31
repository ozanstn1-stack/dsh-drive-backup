# Publish checklist

Every plugin from this workspace is published the same way: public GitHub repo,
public npm package, and one entry file in the community plugin list. Nothing is
private, and nothing ships before the local verification passes.

## 0. Definition of done

- [ ] `node --test` green.
- [ ] Installed into a DSH profile and verified: `systemctl is-active dsh-web`
      (or the equivalent), clean `boot.log`, tools return real output, and
      destructive tools refuse without approval.
- [ ] Public GitHub repo with `LICENSE` (MIT), `README.md`, `README.tr.md`,
      `CHANGELOG.md`, and the `dsh-plugin` topic.
- [ ] Public npm package at the same version as the git tag.
- [ ] One entry file prepared for the community plugin list.

## 1. Local release preparation

```bash
cd /root/work/<plugin>
node --test
git status                     # only intended files
```

Check the published surface, because `files` decides what npm ships:

```bash
npm pack --dry-run
```

- `package.json` must declare `dsh.bundle.patch`; `dsh.client` alone is not
  installable.
- `cordis.patch.yml` must be in `files`.
- `NOT.md`, `node_modules/`, and test artifacts must stay out.
- `version` must match `CHANGELOG.md` and the git tag.

## 2. Public GitHub repository

Owner: `ozanstn1-stack`. Repo name: the package name (`dsh-vps-ops`).

```bash
git add -A
git -c user.name="ozanstn1-stack" -c user.email="ozanstn1@gmail.com" \
    commit -m "feat: <summary>"
git tag -a v0.1.0 -m "v0.1.0"
```

Create the repo as **public** (do not let it default to private), then push:

```bash
git remote add origin git@github.com:ozanstn1-stack/<plugin>.git
git push -u origin main --tags
```

If the account token is read-only, either ask the user for a fine-grained token
with `Contents: read/write`, `Pull requests: read/write`, `Metadata: read`, or
create an empty public repo in the browser and push over SSH.

After the push:

- [ ] Repo is public and the default branch is `main`.
- [ ] `LICENSE`, `README.md`, `README.tr.md`, `CHANGELOG.md` render.
- [ ] Topic `dsh-plugin` added (Settings → Topics, or the API).
- [ ] Repository field in `package.json` points at the repo.

## 3. npm package

```bash
set -a; . /root/.dsh/.env; set +a      # loads NPM_TOKEN
npm whoami                              # must print the expected account
npm publish --access public
npm view <plugin> version dist-tags
```

- The token lives in `/root/.dsh/.env` (mode 600) and in the DS Bot Secrets
  panel. Never print it, log it, or commit it.
- `publishConfig.access` must be `public`.
- The published `repository` field must point back at the GitHub repo, or the
  market cannot link the package to the repo.
- Never reuse a version: bump `package.json`, add a `CHANGELOG.md` section,
  commit, tag, then publish.

## 4. Community plugin list entry

The list lives in `awesome-dsh-plugin/awesome-dsh-plugin`, one file per plugin:
`data/plugins/<owner>__<repo>.yml`. One file is the whole submission; the
READMEs are generated, so never edit them.

```yaml
url: https://github.com/ozanstn1-stack/dsh-vps-ops
name: ozanstn1-stack/dsh-vps-ops
category: tools
description:
  en: 'Read-first VPS operations tools: systemd status and actions, disk, Docker, log tails, configured backups, and quiet-hours schedules.'
  zh: '先读后写的 VPS 运维工具：systemd 状态与操作、磁盘、Docker、日志尾部、可配置备份与静默时段计划。'
```

Rules that have actually blocked submissions:

- Repo must be at least **1 day old** before the PR is opened (CI checks it).
- The repo must declare `dsh.bundle` in `package.json`.
- Add the `dsh-plugin` topic to the repo.
- At most **3 entries** per pull request.
- `description.en` is required; a `: ` inside it must be quoted.
- Description must match the code exactly — no numbers or API names that do not
  exist.
- Choose the closest `category`: `tools` for operational toolkits, `dev` for
  build/dev tooling, `ui`, `usage`, `memory`, `security`, `remote`, `session`,
  `notify`, `docs`, `workflow`, `model`, `vision`, `voice`, `browser`, `git`,
  `wsl`, `identity`, `market`, `fun`, `theme`, `agi`, `skill`.

Open the PR with that single file added. If the account cannot open a PR, hand
the file to the user as a one-step action.

## 5. After publishing

- [ ] `npm i -g <plugin>` or `dsh plugin add <plugin>` from the registry works
      on a clean profile.
- [ ] `dsh --profile <name> --dump-config` shows the plugin row.
- [ ] `boot.log` stays clean after a restart.
- [ ] Tag and npm version agree.
- [ ] Release notes on GitHub (`vX.Y.Z`) describe the change.

## 6. Rollback

- Bad npm release: publish a patch version; do not unpublish (npm keeps the
  name and users may already have it).
- Broken plugin in a profile: `dsh plugin --profile <name> remove <plugin>`,
  then restore `package.json.bak-<tag>-<date>` and `cordis.patch.yml.bak-<tag>-<date>`.
- Bad market entry: PR that corrects only your own entry file.
