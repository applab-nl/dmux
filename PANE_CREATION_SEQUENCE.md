# Pane Creation Sequence Diagram

This document illustrates the complete flow when a user creates a new agent pane in dmux.

## Visual Sequence Diagram

```
┌────────────┐
│    USER    │
└─────┬──────┘
      │
      ├─ TUI: Press 'n' key ─────────────────┐
      │                                       │
      └─ API: POST /api/panes ───────────────┤
                                              │
┌─────────────────────────────────────────────▼────────────────────────────────────────────────┐
│                            ENTRY POINT HANDLERS                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  TUI Path: useInputHandling.ts:354                                                           │
│    ↓                                                                                         │
│  PopupManager.launchNewPanePopup()                                                           │
│    ↓                                                                                         │
│  newPanePopup.tsx (Multi-line input, @file refs, ESC handling)                              │
│    ↓                                                                                         │
│  Returns: prompt string                                                                     │
│                                                                                              │
│  API Path: panesRoutes.ts:69                                                                 │
│    ↓                                                                                         │
│  Validate: { prompt, agent? } from request body                                             │
└──────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                          AGENT SELECTION LOGIC                                               │
│                      (DmuxApp.tsx:461 / panesRoutes.ts:95)                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  availableAgents = ['claude', 'opencode'] (or subset)                                        │
│           │                                                                                  │
│           ├─ 0 agents ──────► ERROR: "Install claude or opencode"                           │
│           │                                                                                  │
│           ├─ 1 agent ───────► Auto-select (skip popup)                                      │
│           │                                                                                  │
│           └─ 2+ agents ──────┬─ settings.defaultAgent exists? ──► Use default               │
│                              │                                                               │
│                              └─ No default ──► PopupManager.launchAgentChoicePopup()        │
│                                                         │                                    │
│                                          Returns: 'claude' | 'opencode' | null               │
└──────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                         CORE PANE CREATION ORCHESTRATOR                                      │
│                        createPane() - paneCreation.ts:36                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  PHASE 1: Settings & Project Root Resolution                                                │
│  ────────────────────────────────────────────────────                                       │
│    • Load settings from .dmux/settings.json                                                 │
│    • Determine project root (handle worktrees: git rev-parse --git-common-dir)              │
│    • Check if agent selection needed → return { needsAgentChoice: true }                    │
│    • Auto-select single agent if needed                                                     │
│                                                                                              │
│  PHASE 2: Hooks & Slug Generation                                                           │
│  ──────────────────────────────────────                                                     │
│    • Trigger: before_pane_create hook (DMUX_PROMPT, DMUX_AGENT env vars)                   │
│    • generateSlug(prompt) ──────────────────────────────────────────┐                       │
│                                                                      │                       │
│      ┌───────────────────────────────────────────────────────────────▼────────────────────┐ │
│      │                      SLUG GENERATION WATERFALL                                     │ │
│      │                        (slug.ts:142-212)                                           │ │
│      ├────────────────────────────────────────────────────────────────────────────────────┤ │
│      │                                                                                    │ │
│      │  1. OpenRouter API (if OPENROUTER_API_KEY set)                                    │ │
│      │     ├─ Try: google/gemini-2.5-flash (1-2 words, max 10 tokens)                   │ │
│      │     ├─ Try: x-ai/grok-4-fast:free                                                 │ │
│      │     └─ Try: openai/gpt-4o-mini                                                    │ │
│      │          ↓ (first success wins)                                                   │ │
│      │                                                                                    │ │
│      │  2. Long Prompt Detection (if >100 chars OR >15 words)                            │ │
│      │     └─ generateLongPromptSlug() ─────────────────────────┐                        │ │
│      │         • Check: isClaudeAvailable()                     │                        │ │
│      │         • Meta-prompt: "Analyze task, create 3-5 word slug" │                     │ │
│      │         • Max 40 chars, limit 5 words                    │                        │ │
│      │         • Returns: null if Claude not available          │                        │ │
│      │                                                                                    │ │
│      │  3. Basic Claude CLI (for any prompt)                                             │ │
│      │     └─ callClaudeCode("Generate 1-2 word kebab-case slug...")                     │ │
│      │          ↓ (5 second timeout)                                                     │ │
│      │                                                                                    │ │
│      │  4. Simple Text Processing                                                        │ │
│      │     • generateSimpleSlug(prompt)                                                  │ │
│      │     • Remove 40+ stopwords (the, a, an, new, page, ...)                          │ │
│      │     • Take first 3 meaningful words                                               │ │
│      │     • Max 30 chars, truncate at word boundary                                     │ │
│      │          ↓                                                                         │ │
│      │                                                                                    │ │
│      │  5. Timestamp Fallback (LAST RESORT)                                              │ │
│      │     └─ `dmux-${Date.now()}`  (e.g., "dmux-1731688800000")                        │ │
│      │                                                                                    │ │
│      └────────────────────────────────────────────────────────────────────────────────────┘ │
│                           │                                                                  │
│                           └──► Returns: slug (kebab-case string)                             │
│                                                                                              │
│  PHASE 3: Control Pane Management                                                           │
│  ──────────────────────────────────────                                                     │
│    • Load controlPaneId from .dmux/dmux.config.json                                         │
│    • Verify control pane exists in tmux (TmuxService.paneExists())                          │
│    • SELF-HEALING: If missing → update to current pane, save config                         │
│                                                                                              │
│  PHASE 4: Tmux Pane Creation & Layout                                                       │
│  ───────────────────────────────────────────                                                │
│    ┌─ First Content Pane? ──► setupSidebarLayout(controlPaneId)                             │
│    │                            • Split: control (40 cells) | content (rest)                │
│    │                            • Wait 300ms for tmux to settle                             │
│    │                                                                                         │
│    └─ Subsequent Panes? ──────► splitPane({ targetPane: lastDmuxPane })                     │
│                                  • Horizontal split from most recent pane                   │
│                                                                                              │
│    • Self-healing retry: If "can't find pane" → update controlPaneId, retry                │
│    • Set pane title: tmuxService.setPaneTitle(paneInfo, slug)                              │
│    • Apply optimal layout: recalculateAndApplyLayout(...)                                  │
│        └─ Grid layout engine (3-col preferred, max 80 chars/pane)                           │
│        └─ Spacer panes if last row would exceed MAX_COMFORTABLE_WIDTH                       │
│    • Refresh tmux client                                                                   │
│                                                                                              │
│  PHASE 5: Post-Pane Hook                                                                    │
│  ─────────────────────────                                                                  │
│    • Trigger: pane_created hook (DMUX_PANE_ID, DMUX_SLUG, DMUX_TMUX_PANE_ID)               │
│                                                                                              │
└──────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                          GIT WORKTREE CREATION                                               │
│                          paneCreation.ts:261-351                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  1. Prune stale worktrees                                                                   │
│     └─ execSync('git worktree prune', { cwd: projectRoot })                                 │
│                                                                                              │
│  2. Check if branch exists                                                                  │
│     └─ git show-ref --verify --quiet refs/heads/${slug}                                     │
│                                                                                              │
│  3. Build worktree command                                                                  │
│     ├─ Branch exists:     git worktree add "path" ${slug}                                   │
│     └─ Branch new:        git worktree add "path" -b ${slug}                                │
│                                                                                              │
│  4. Send command to tmux pane                                                               │
│     └─ tmuxService.sendShellCommand(paneInfo, worktreeCmd)                                  │
│     └─ tmuxService.sendTmuxKeys(paneInfo, 'Enter')                                          │
│                                                                                              │
│  5. Poll for worktree directory (max 5 seconds)                                             │
│     └─ while (!fs.existsSync(worktreePath) && elapsed < 5000)                               │
│         └─ wait 100ms, check again                                                          │
│                                                                                              │
│  6. Error handling                                                                          │
│     └─ If worktree fails: show error in pane, keep pane open (no throw)                    │
│                                                                                              │
│  7. Special case: Hooks editing session                                                     │
│     └─ If prompt matches /edit.*dmux.*hooks/i                                               │
│         └─ Initialize .dmux-hooks/ with documentation (AGENTS.md, etc.)                     │
│                                                                                              │
└──────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                            AGENT LAUNCHING                                                   │
│                          paneCreation.ts:353-389                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  ┌─ agent === 'claude' ────────────────────────────────────────────────────────────┐        │
│  │                                                                                  │        │
│  │  1. Build command with escaped prompt                                           │        │
│  │     └─ claude "${escapedPrompt}" --permission-mode=acceptEdits                  │        │
│  │                                                                                  │        │
│  │  2. Send to pane                                                                │        │
│  │     └─ tmuxService.sendShellCommand(paneInfo, claudeCmd)                        │        │
│  │     └─ tmuxService.sendTmuxKeys(paneInfo, 'Enter')                              │        │
│  │                                                                                  │        │
│  │  3. Auto-approve trust prompts (background async)                               │        │
│  │     └─ autoApproveTrustPrompt(paneInfo, prompt)                                 │        │
│  │         ├─ Wait 1.2s for Claude to start                                        │        │
│  │         ├─ Poll pane content every 100ms (max 10s)                              │        │
│  │         ├─ Look for trust prompt patterns                                       │        │
│  │         └─ Send: 'Enter' (new format) or 'y' + 'Enter' (old format)            │        │
│  │                                                                                  │        │
│  └──────────────────────────────────────────────────────────────────────────────────┘        │
│                                                                                              │
│  ┌─ agent === 'opencode' ──────────────────────────────────────────────────────────┐        │
│  │                                                                                  │        │
│  │  1. Launch opencode (no CLI prompt support)                                     │        │
│  │     └─ tmuxService.sendShellCommand(paneInfo, 'opencode')                       │        │
│  │     └─ tmuxService.sendTmuxKeys(paneInfo, 'Enter')                              │        │
│  │                                                                                  │        │
│  │  2. Paste prompt via tmux buffer                                                │        │
│  │     └─ Wait 1.5s for opencode to start                                          │        │
│  │     └─ Create buffer: tmux set-buffer -b dmux_prompt_TIMESTAMP "prompt"         │        │
│  │     └─ Paste buffer: tmux paste-buffer -b dmux_prompt_TIMESTAMP -t pane         │        │
│  │     └─ Delete buffer: tmux delete-buffer -b dmux_prompt_TIMESTAMP               │        │
│  │     └─ Send Enter                                                               │        │
│  │                                                                                  │        │
│  └──────────────────────────────────────────────────────────────────────────────────┘        │
│                                                                                              │
│  3. Focus new pane                                                                          │
│     └─ tmuxService.selectPane(paneInfo)                                                     │
│                                                                                              │
└──────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                     PANE OBJECT CREATION & PERSISTENCE                                       │
│                          paneCreation.ts:394-437                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  1. Create DmuxPane object                                                                  │
│     ┌────────────────────────────────────────────────────────────────────┐                  │
│     │  {                                                                 │                  │
│     │    id: `dmux-${Date.now()}`,           // Unique ID               │                  │
│     │    slug: "fix-auth-bug",                // Git branch/worktree    │                  │
│     │    prompt: "Fix the authentication...", // User's original prompt │                  │
│     │    paneId: "%38",                        // Tmux pane ID          │                  │
│     │    worktreePath: ".dmux/worktrees/...", // Absolute path          │                  │
│     │    agent: "claude",                      // Agent type            │                  │
│     │    autopilot: false                      // From settings         │                  │
│     │  }                                                                 │                  │
│     └────────────────────────────────────────────────────────────────────┘                  │
│                                                                                              │
│  2. CRITICAL: Save for first pane BEFORE destroying welcome pane                            │
│     ├─ Read current config                                                                  │
│     ├─ Add new pane to config.panes array                                                   │
│     ├─ Update config.lastUpdated timestamp                                                  │
│     ├─ atomicWriteJsonSync(configPath, config) ─── ATOMIC WRITE                            │
│     └─ destroyWelcomePaneCoordinated(projectRoot) ─── EVENT-BASED                           │
│                                                                                              │
│  3. Trigger hook                                                                            │
│     └─ worktree_created hook (full pane object passed)                                      │
│                                                                                              │
│  4. Return focus to control pane                                                            │
│     └─ tmuxService.selectPane(originalPaneId)                                               │
│     └─ tmuxService.setPaneTitle(originalPaneId, `dmux-${projectName}`)                      │
│                                                                                              │
│  5. Return result                                                                           │
│     └─ { pane: newPane, needsAgentChoice: false }                                           │
│                                                                                              │
└──────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                         TUI STATE UPDATE & REPAINT                                           │
│                      usePaneCreation.ts:41-125 (TUI only)                                    │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  1. Force initial repaint (prevent blank screen)                                            │
│     └─ forceRepaint()                                                                        │
│                                                                                              │
│  2. Persist pane to state                                                                   │
│     └─ const updatedPanes = [...panes, result.pane]                                         │
│     └─ await savePanes(updatedPanes)                                                        │
│                                                                                              │
│  3. Validate save was successful                                                            │
│     ├─ Wait 100ms                                                                           │
│     ├─ Re-read config file                                                                  │
│     ├─ Check if pane.id exists in savedPanes                                                │
│     └─ If missing → retry savePanes()                                                       │
│                                                                                              │
│  4. Aggressive screen clearing & refresh                                                    │
│     ├─ process.stdout.write('\x1b[2J\x1b[3J\x1b[H')  // Clear screen + scrollback          │
│     ├─ tmuxService.clearHistorySync()                                                       │
│     └─ tmuxService.refreshClientSync()                                                      │
│                                                                                              │
│  5. Reload panes from disk & repaint                                                        │
│     └─ await loadPanes()                                                                    │
│     └─ forceRepaint()                                                                        │
│                                                                                              │
└──────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                            BACKGROUND PROCESSES                                              │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                              │
│  ┌─ Trust Prompt Auto-Approval (Claude only) ────────────────────────────────┐              │
│  │  • Running in parallel, non-blocking                                      │              │
│  │  • Polls pane content every 100ms for up to 10s                           │              │
│  │  • Looks for trust prompt patterns                                        │              │
│  │  • Responds when stable content detected (5 checks)                       │              │
│  └───────────────────────────────────────────────────────────────────────────┘              │
│                                                                                              │
│  ┌─ Pane Status Monitoring (PaneAnalyzer workers) ───────────────────────────┐              │
│  │  • One worker thread per pane                                             │              │
│  │  • Polls every 1s for terminal motion (activity detection)                │              │
│  │  • Uses LLM (grok-4-fast:free) to detect: option_dialog, open_prompt,     │              │
│  │    in_progress                                                             │              │
│  │  • Updates pane status in real-time                                       │              │
│  └───────────────────────────────────────────────────────────────────────────┘              │
│                                                                                              │
│  ┌─ Dead Pane Cleanup (DmuxApp polling) ──────────────────────────────────────┐             │
│  │  • Polls every 2s                                                          │             │
│  │  • Checks if tmux pane still exists                                        │             │
│  │  • Removes dead panes from config                                          │             │
│  └───────────────────────────────────────────────────────────────────────────┘              │
│                                                                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────┐
│   AGENT READY ✅   │
│                    │
│  • Claude CLI or   │
│    opencode running│
│  • Prompt submitted│
│  • Worktree active │
│  • Pane tracked    │
└────────────────────┘
```

## Timeline Breakdown

### Phase Durations (Approximate)

| Phase | Duration | Blocking? |
|-------|----------|-----------|
| Popup input | User-dependent | Yes |
| Agent selection | 0ms (auto) to user-dependent (popup) | Yes |
| Settings load | <10ms | Yes |
| Slug generation | 50ms-5s depending on method | Yes |
| Tmux pane creation | 50-100ms | Yes |
| Layout application | 100-300ms | Yes |
| Git worktree creation | 500ms-5s (polling) | Yes |
| Agent launch | 100ms | Yes |
| Config persistence | 10-50ms | Yes |
| Trust prompt auto-approval | 0-10s (async) | No |
| TUI repaint | 100-200ms | Yes |

**Total (typical)**: 1-3 seconds from prompt submission to agent ready

## Key Decision Points

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DECISION TREE                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Q1: How many agents installed?                                    │
│      ├─ 0 → ERROR: Install claude or opencode                      │
│      ├─ 1 → Auto-select                                            │
│      └─ 2+ → Q2                                                     │
│                                                                     │
│  Q2: Default agent configured in settings?                         │
│      ├─ Yes → Use default                                          │
│      └─ No → Show agent choice popup                               │
│                                                                     │
│  Q3: Is prompt long (>100 chars or >15 words)?                     │
│      ├─ Yes → Try Claude CLI with meta-prompt for better slug      │
│      └─ No → Standard slug generation                              │
│                                                                     │
│  Q4: First content pane for this project?                          │
│      ├─ Yes → setupSidebarLayout() + save config + destroy welcome │
│      └─ No → splitPane() from last pane                            │
│                                                                     │
│  Q5: Control pane still exists in tmux?                            │
│      ├─ Yes → Use it                                               │
│      └─ No → Self-heal: update to current pane                     │
│                                                                     │
│  Q6: Git branch already exists?                                    │
│      ├─ Yes → git worktree add path BRANCH                         │
│      └─ No → git worktree add path -b BRANCH                       │
│                                                                     │
│  Q7: Which agent?                                                  │
│      ├─ Claude → Launch with --permission-mode=acceptEdits         │
│      └─ Opencode → Launch + paste prompt via tmux buffer           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Error Handling & Fallbacks

| Error Scenario | Handling Strategy |
|----------------|-------------------|
| No agents installed | Show error, abort creation |
| Slug generation fails (all methods) | Use `dmux-${timestamp}` |
| Control pane missing | Self-heal: update to current pane, retry |
| Tmux pane creation fails | Self-heal once, then throw error |
| Git worktree creation fails | Show error in pane, keep pane open for debugging |
| Config write fails | Log warning, retry on next save |
| Agent launch fails | Pane stays open, user sees error |
| Trust prompt detection fails | User handles manually (non-fatal) |

## Hooks Integration

dmux triggers hooks at three key points during pane creation:

```
before_pane_create
    ↓
  [Slug generation, tmux pane creation]
    ↓
pane_created (pane exists, worktree not yet created)
    ↓
  [Git worktree creation, agent launch]
    ↓
worktree_created (full setup complete)
```

### Hook Environment Variables

**before_pane_create**:
- `DMUX_PROMPT`: User's original prompt
- `DMUX_AGENT`: Selected agent ('claude' or 'opencode')

**pane_created**:
- `DMUX_PANE_ID`: dmux internal ID (`dmux-{timestamp}`)
- `DMUX_SLUG`: Generated slug (branch/worktree name)
- `DMUX_PROMPT`: User's original prompt
- `DMUX_AGENT`: Selected agent
- `DMUX_TMUX_PANE_ID`: tmux pane ID (e.g., `%38`)

**worktree_created**:
- Full `DmuxPane` object passed to hook script

## Critical Implementation Details

### 1. Atomic Config Writes

```typescript
// Prevents corruption during concurrent writes
atomicWriteJsonSync(configPath, config)
```

Uses temp file + rename for atomic filesystem operation.

### 2. Event-Based Welcome Pane Destruction

```typescript
// First pane: save config BEFORE destroying welcome pane
config.panes = [...existingPanes, newPane]
atomicWriteJsonSync(configPath, config)  // ← MUST happen first
destroyWelcomePaneCoordinated(projectRoot)  // ← Then destroy
```

Event-based approach prevents race conditions where TUI doesn't see new pane.

### 3. Self-Healing Control Pane

```typescript
if (controlPaneId) {
  const exists = await tmuxService.paneExists(controlPaneId)
  if (!exists) {
    controlPaneId = originalPaneId  // Use current pane
    config.controlPaneId = controlPaneId
    atomicWriteJsonSync(configPath, config)
  }
}
```

Automatically recovers from stale pane IDs (e.g., after tmux restart).

### 4. Slug Generation Cascade

Five fallback strategies ensure a slug is ALWAYS generated:
1. OpenRouter API (requires key)
2. Claude CLI meta-prompt (for long prompts)
3. Claude CLI basic (always tries)
4. Simple text processing (deterministic)
5. Timestamp (absolute last resort)

### 5. Agent-Specific Prompt Handling

**Claude**: Accepts prompt as CLI argument with escaping
```bash
claude "Fix the auth bug" --permission-mode=acceptEdits
```

**Opencode**: Doesn't accept CLI prompts, uses tmux buffer paste
```bash
opencode
# Wait 1.5s
# Paste via tmux buffer
# Press Enter
```

## File Locations Reference

| Component | File | Lines |
|-----------|------|-------|
| TUI keyboard handler | `src/hooks/useInputHandling.ts` | 354-363 |
| Pane creation hook (TUI) | `src/hooks/usePaneCreation.ts` | 41-125 |
| API endpoint | `src/server/routes/panesRoutes.ts` | 69-251 |
| Core creation logic | `src/utils/paneCreation.ts` | 36-443 |
| Slug generation | `src/utils/slug.ts` | 142-212 |
| Agent selection logic | `src/DmuxApp.tsx` | 461-480 |
| New pane popup | `src/components/popups/newPanePopup.tsx` | - |
| Popup manager | `src/services/PopupManager.ts` | 194-216 |
| Trust prompt auto-approval | `src/utils/paneCreation.ts` | 445-569 |
| Tmux service | `src/services/TmuxService.ts` | - |
| Layout engine | `src/utils/layoutManager.ts` | - |

---

**Document created**: 2024-11-15
**dmux version**: 3.3.1
**Author**: Generated from codebase analysis
