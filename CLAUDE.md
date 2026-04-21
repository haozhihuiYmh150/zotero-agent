# Zotero Agent - Project Instructions

## Release Checklist (发版检查)

Before releasing a new version, always perform these checks:

1. **Security Check** - Ensure no leaked secrets (API keys, passwords, personal info, company info)
   ```bash
   grep -rn "api_key\|apiKey\|password\|secret\|token" src/ --include="*.ts"
   ```
2. **Build** - Run `npm run build` and ensure no errors
3. **Version** - Update version in `package.json`
4. **Rebuild** - Run `npm run build` again after version update
5. **Git Status** - Check `git status` for uncommitted changes
6. **Commit** - Stage and commit all changes with descriptive message
7. **Tag** - Create git tag for the version (e.g., `v0.2.0`)

## Project Structure

- `src/services/` - API services (ArxivService, PubMedService, LLMService)
- `src/tools/` - LLM tools (search, download, data tools)
- `src/modules/` - UI modules (sidePanel, agent)
- `doc/DESIGN.md` - Design philosophy documentation

## Key Design Decisions

See `doc/DESIGN.md` for:
- Context Proximity (上下文亲近度)
- Selected Text Handling (选中文本处理)
- Paper Sources Architecture
