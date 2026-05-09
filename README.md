# Antigravity Multi-Account Switcher

**Version 1.0.2** — Cross-Platform Release (Windows · Linux · macOS)

Seamlessly switch between multiple Google accounts in Antigravity — **login session and chat history are fully preserved** across every profile switch.

---

## What's New in v1.0.2

### 🔐 Session Persistence Fixed (No More Re-Login!)
Previous versions lost your Google login on every profile switch because the OAuth token path was wrong (`~/.gemini/antigravity-browser-profile` — a directory that does not exist). v1.0.2 correctly saves and restores the real auth files from `~/.gemini/`:

- `oauth_creds.json` — Google OAuth refresh tokens
- `google_accounts.json` — signed-in account list
- `installation_id`, `state.json`, `settings.json`, `projects.json`, `trustedFolders.json`

### 💬 Chat History Now Persisted Per Profile
`~/.gemini/history/` (which contains all your Antigravity chat history per workspace) is now saved and restored with each profile — your conversation history follows you when you switch accounts.

### 🖥️ Full Cross-Platform Hardening
Seven platform-specific bugs fixed across Windows and macOS:

| Fix | Platform |
|-----|----------|
| `Atomics.wait()` crash on main thread → busy-wait fallback | Windows |
| `pgrep -a` not available → replaced with `pkill -9 -if` | macOS |
| `.cmd` launchers need `shell: true` to spawn | Windows |
| `.antigravity` ext path auto-detects `~/Library/...` fallback | macOS |
| Case-insensitive directory exclusion (`Antigravity` vs `antigravity`) | Windows |
| Added `/opt/homebrew/bin/antigravity` to search paths (Apple Silicon) | macOS |
| Platform-aware post-kill wait: Win=2s, macOS=3s, Linux=5s | All |

> **⚠️ Important after upgrading:** Re-save all your profiles once (click the `+` button → "Copy Current Data") so the new auth and history data gets captured in each profile snapshot.

---

## Features

### 🎨 Colorful Profile Buttons (Up to 10)
- **Profile slot buttons** in the status bar with distinct colors
  (Blue, Green, Orange, Purple, Pink, Teal, Amber, Blue Grey, Lime, Deep Orange)
- **One-click switching** — no confirmation dialogs
- Active profile shows a ✓ checkmark; empty slots are grayed out

### ➕ Easy Profile Management
- **Save button (+)** — Save current session as a named profile
- **Delete button (🗑️)** — Remove unwanted profiles
- Profiles stored in a platform-appropriate directory:

  | OS      | Default profiles path |
  |---------|----------------------|
  | Windows | `%APPDATA%\Antigravity\Profiles` |
  | macOS   | `~/Library/Application Support/Antigravity/Profiles` |
  | Linux   | `~/.config/Antigravity/Profiles` (respects `$XDG_CONFIG_HOME`) |

- Optional custom storage path via setting: `antigravitySwitcher.profilesDirectory`

### 🔒 What Gets Saved Per Profile

| Data | Location Backed Up |
|------|--------------------|
| Antigravity app data (Cookies, Local Storage, Session, User) | `~/.config/Antigravity/` (Linux) · `%APPDATA%\Antigravity\` (Win) · `~/Library/Application Support/Antigravity/` (macOS) |
| Google OAuth tokens & account list | `~/.gemini/oauth_creds.json`, `google_accounts.json`, etc. |
| Chat history | `~/.gemini/history/` |
| Extension state | `~/.antigravity/` (excl. extensions themselves) |

### ⚠️ Rate Limit Detection
- Automatically monitors for rate limit errors (supports Gemini and Claude)
- When detected, prompts you to switch to another account
- 1-minute cooldown between alerts to avoid spam

---

## Installation

### Method 1: Install from VSIX (Recommended)

1. **Download** `antigravity-account-switcher-1.0.2.vsix`
2. **Open Antigravity**
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
4. Type: `Extensions: Install from VSIX...`
5. Select the downloaded `.vsix` file
6. Click **Reload** when prompted

### Method 2: Command Line Install

**Windows (PowerShell / CMD):**
```powershell
& "$env:LOCALAPPDATA\Programs\Antigravity\bin\antigravity.cmd" --install-extension "path\to\antigravity-account-switcher-1.0.2.vsix"
```

**Linux / macOS (bash):**
```bash
antigravity --install-extension "path/to/antigravity-account-switcher-1.0.2.vsix"
# or if installed to a non-PATH location:
~/.local/bin/antigravity --install-extension "path/to/antigravity-account-switcher-1.0.2.vsix"
```

### Method 3: Manual Install (Copy Files)

1. Navigate to your extensions directory:
   - **Windows**: `%APPDATA%\.antigravity\extensions\`
   - **macOS / Linux**: `~/.antigravity/extensions/`
2. Create folder: `fusionlancers.antigravity-account-switcher-1.0.2`
3. Copy these files into it:
   - `extension.js`
   - `package.json`
   - `scripts/profile_manager.js`
4. Restart Antigravity

---

## How It Works

1. **Save a Profile**: Log into a Google account in Antigravity, then click **+** and enter a name. Choose "Copy Current Data" to preserve your login.
2. **Switch Profiles**: Click any colored profile button — Antigravity restarts with the selected account's full session (no re-login needed).
3. **Rate Limit Auto-Switch**: When you hit a rate limit, a prompt appears offering to switch accounts automatically.

---

## Commands

| Command | Description |
|---------|-------------|
| `Antigravity: Save Current Profile` | Save current session as a named profile |
| `Antigravity: Switch Profile` | Switch via quick-pick list |
| `Antigravity: Delete Profile` | Delete a saved profile |
| `Antigravity: List Profiles` | Show all saved profiles |
| `Antigravity: Set Active Profile (No Restart)` | Mark a profile active without restarting |
| `Antigravity: Show Switcher Activity Log` | Open recent switcher activity log |
| `Antigravity: Run Switcher Diagnostics` | Run non-destructive profile/runtime checks |
| `Antigravity: Health Check Profiles` | Show profile health status (OK/PARTIAL/EMPTY) |
| `Antigravity: Export Profile Folder` | Export profile (Full / Auth-only / Settings-only) |
| `Antigravity: Import Profile Folder` | Import a profile folder |
| `Antigravity: Export Profile Encrypted` | Export profile as AES-256-GCM encrypted file |
| `Antigravity: Import Profile Encrypted` | Decrypt and restore an encrypted profile |
| `Antigravity: Repair Current Session Cache` | Clear runtime caches without deleting profiles |
| `Antigravity: Show Profile Analytics` | Aggregated profile/switch usage stats |

---

## Advanced Settings

Open **Settings** and search `Antigravity Account Switcher`:

| Setting | Default | Description |
|---------|---------|-------------|
| `antigravitySwitcher.maxProfiles` | `7` | Number of profile slot buttons (1–10) |
| `antigravitySwitcher.profilesDirectory` | *(empty)* | Custom profile storage path (leave empty for OS default) |
| `antigravitySwitcher.profilePin` | *(empty)* | Optional PIN required before switching/deleting |
| `antigravitySwitcher.autoSnapshotMinutes` | `0` | Auto-save snapshot interval in minutes (`0` = disabled) |

### Selective Export Modes

When exporting via `Antigravity: Export Profile Folder`:

- **Full** — complete profile snapshot
- **Auth Only** — Cookies, Local/Session Storage, User data only
- **Settings Only** — Preferences and User data only

### Encrypted Export/Import

- `Export Profile Encrypted` writes an **AES-256-GCM** encrypted profile bundle
- `Import Profile Encrypted` decrypts and restores it using your passphrase
- Without the passphrase, encrypted exports cannot be recovered — keep it safe

---

## Requirements

- Antigravity IDE (VS Code-compatible)
- Node.js is **not** required separately — the extension uses Antigravity's bundled Node runtime

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| Windows 10/11 | ✅ | Fully hardened: `taskkill`, `.cmd` shell launch, APPDATA paths, busy-wait sleep |
| macOS (Intel + Apple Silicon) | ✅ | `pkill`, Homebrew path, Library fallback for `.antigravity`, 3s kill wait |
| Linux (Debian, Ubuntu, Fedora, Arch) | ✅ | Runtime tested; respects XDG Base Directory spec; `pgrep`+`kill` |

---

## Changelog

### v1.0.2 — Session Persistence & Cross-Platform Hardening
- **Fixed**: Google login lost on every switch (wrong `~/.gemini` auth path)
- **Fixed**: Chat history wiped on every switch (`~/.gemini/history/` now saved per profile)
- **Fixed**: `Atomics.wait()` crash on Windows main thread
- **Fixed**: `pgrep -a` flag not available on macOS (now uses `pkill`)
- **Fixed**: `.cmd` wrappers need `shell: true` on Windows
- **Fixed**: `.antigravity` ext path auto-detects macOS Library fallback
- **Fixed**: Case-insensitive directory exclusion for Windows filesystem
- **Added**: `/opt/homebrew/bin/antigravity` to macOS executable search paths (Apple Silicon)
- **Improved**: Platform-aware post-kill wait times (Win=2s, macOS=3s, Linux=5s)

### v1.0.1 — Diagnostics & Stability
- Added diagnostics, activity logs, encrypted export/import
- Linux stability improvements

### v1.0.0 — Initial Release
- Cross-platform account switcher (Windows, Linux, macOS)
- 7 colorful profile slot buttons, rate limit auto-detection

---

Made for bypassing rate limits without the hassle of manual re-login! 🚀
