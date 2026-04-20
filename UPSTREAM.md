# Upstream Dependencies

This document tracks the upstream template and dependencies for reproducibility.

## Template

| Field | Value |
|-------|-------|
| Repository | https://github.com/windingwind/zotero-plugin-template |
| Branch | main |
| Commit SHA | 306d4e2a0959a7b2f5e44bb38169fb25f841dbaf |
| Commit Date | 2025-12-16 11:22:04 +0800 |
| Cloned Date | 2026-04-20 |

## How to Sync with Upstream

If you need to pull updates from the template:

```bash
# Add upstream remote (one-time)
git remote add upstream https://github.com/windingwind/zotero-plugin-template.git

# Fetch upstream changes
git fetch upstream

# Compare with original commit
git diff 306d4e2a..upstream/main -- <file>

# Cherry-pick specific commits if needed
git cherry-pick <commit-sha>
```

## Version Lock

To ensure reproducibility, key dependencies are locked:

- `zotero-plugin-scaffold`: ^0.8.2
- `zotero-types`: ^4.1.0-beta.4
- `zotero-plugin-toolkit`: ^5.1.0-beta.13

Run `npm ci` (not `npm install`) in CI/CD for deterministic builds.
