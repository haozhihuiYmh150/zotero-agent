# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-04-21

### Added
- **PubMed Support** - Search and download papers from PubMed
- **Batch Download** - Download multiple papers at once (`下载前3篇`)
- **PDF Auto-fetch** - Automatically try to get PDF via Unpaywall, with PMC fallback
- **Context Proximity** - Smart paper lookup from chat history (no need to re-select just-downloaded papers)
- **Design Documentation** - Added `doc/DESIGN.md` with architecture decisions

### Changed
- Refactored tool system to use standard OpenAI function calling flow
- Improved streaming response with real-time tool call display

## [0.1.0] - 2026-04-20

### Added
- Initial release
- arXiv search and download
- Paper Q&A and summarization
- Selected text analysis
- Slash commands for configuration
- Draggable floating panel
