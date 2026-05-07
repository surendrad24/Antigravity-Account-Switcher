# Antigravity Multi-Account Switcher

**Version 1.0.1** — Cross-Platform Release (Windows · Linux · macOS)

Seamlessly switch between multiple accounts in Antigravity to bypass model rate limits without manual re-login.

---

## Features

### 🎨 Colorful Profile Buttons (Up to 10)
- **Profile slot buttons** in the status bar with distinct colors
  (Blue, Green, Orange, Purple, Pink, Teal, Amber, Blue Grey, Lime, Deep Orange)
- **One-click switching** — no confirmation dialogs
- Empty slots are grayed out with slot numbers

### ➕ Easy Profile Management
- **Save button (+)** — Save your current session as a new profile
- **Delete button (🗑️)** — Remove unwanted profiles
- Profiles are stored in a platform-appropriate directory:
  | OS      | Default profiles path |
  |---------|----------------------|
  | Windows | `%APPDATA%\Antigravity\Profiles` |
  | macOS   | `~/Library/Application Support/Antigravity/Profiles` |
  | Linux   | `~/.config/Antigravity/Profiles` (respects `$XDG_CONFIG_HOME`) |
- Optional custom storage path via setting: `antigravitySwitcher.profilesDirectory`

### ⚠️ Rate Limit Detection
- Automatically monitors for rate limit errors (supports Gemini and Claude)
- When detected, prompts you to switch to another account
- 1-minute cooldown between alerts to avoid spam

### 🖥️ Cross-Platform Support
- Works on **Windows**, **Linux**, and **macOS**
- No longer relies on PowerShell — uses a bundled Node.js script instead
- Finds the Antigravity executable automatically on each platform

---

## Installation

### Method 1: Install from VSIX (Recommended)

1. **Download** the `antigravity-account-switcher-1.0.0.vsix` file
2. **Open Antigravity**
3. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open Command Palette
4. Type: `Extensions: Install from VSIX...`
5. Select the downloaded `.vsix` file
6. Click **Reload** when prompted (or press `Ctrl+Shift+P` → `Developer: Reload Window`)

### Method 2: Command Line Install

**Windows (PowerShell / CMD):**
```powershell
& "$env:LOCALAPPDATA\Programs\Antigravity\bin\antigravity.cmd" --install-extension "path\to\antigravity-account-switcher-1.0.0.vsix"
```

**Linux / macOS (bash):**
```bash
antigravity --install-extension "path/to/antigravity-account-switcher-1.0.0.vsix"
# or if installed to a non-PATH location:
~/.local/bin/antigravity --install-extension "path/to/antigravity-account-switcher-1.0.0.vsix"
```

### Method 3: Manual Install (Copy Files)

1. Navigate to your extensions directory:
   - **Windows**: `%USERPROFILE%\.antigravity\extensions\`
   - **macOS / Linux**: `~/.antigravity/extensions/`
2. Create folder: `antigravity-account-switcher-1.0.0`
3. Copy these files into it:
   - `extension.js`
   - `package.json`
   - `scripts/profile_manager.js`
4. Restart Antigravity

---

## How It Works

1. **Save a Profile**: Log into an account in Antigravity, then click the **+** button and enter a name
2. **Switch Profiles**: Click any colored profile button to instantly switch (Antigravity will restart)
3. **Rate Limit Auto-Switch**: When you hit a rate limit, a prompt appears offering to switch accounts

---

## Commands

| Command | Description |
|---------|-------------|
| `Antigravity: Save Current Profile` | Save current session |
| `Antigravity: Switch Profile` | Switch via picker |
| `Antigravity: Delete Profile` | Delete a profile |
| `Antigravity: List Profiles` | Show saved profiles |
| `Antigravity: Set Active Profile (No Restart)` | Mark a profile as active without restarting |
| `Antigravity: Show Switcher Activity Log` | Open recent switcher activity log |
| `Antigravity: Run Switcher Diagnostics` | Run non-destructive profile/runtime checks |
| `Antigravity: Health Check Profiles` | Show profile health status (OK/PARTIAL/EMPTY) |
| `Antigravity: Export Profile Folder` | Export a profile folder (Full/Auth-only/Settings-only) |
| `Antigravity: Import Profile Folder` | Import a profile folder |
| `Antigravity: Export Profile Encrypted` | Export profile as encrypted file |
| `Antigravity: Import Profile Encrypted` | Import profile from encrypted file |
| `Antigravity: Repair Current Session Cache` | Clear runtime caches without deleting profiles |
| `Antigravity: Show Profile Analytics` | Open aggregated profile/switch stats |

---

## Advanced Settings Guide

Use `Settings` → search for `Antigravity Account Switcher`:

- `antigravitySwitcher.maxProfiles`
  - Range: `1` to `10`
  - Controls number of profile slots shown in status bar

- `antigravitySwitcher.profilesDirectory`
  - Optional custom path for profile storage
  - Leave empty to use OS default profile location

- `antigravitySwitcher.profilePin`
  - Optional PIN string
  - If set, switch/delete actions require PIN confirmation

- `antigravitySwitcher.autoSnapshotMinutes`
  - Auto snapshot interval in minutes
  - `0` disables snapshots
  - `>0` periodically updates `__snapshot_<activeProfile>`

### Selective Export Modes

When running `Antigravity: Export Profile Folder`, choose:

- `Full` → exports complete profile
- `Auth Only` → keeps auth/session-focused files
- `Settings Only` → keeps settings-focused files

### Encrypted Export/Import

- `Export Profile Encrypted` writes an AES-256-GCM encrypted profile file
- `Import Profile Encrypted` restores a profile using your passphrase
- Keep passphrases secure; without the passphrase, encrypted exports cannot be recovered

---

## Requirements

- Antigravity IDE (VS Code-compatible)
- Node.js is **not** required separately — the extension uses Antigravity's bundled Node runtime

## Supported Platforms

| Platform | Tested | Notes |
|----------|--------|-------|
| Windows 10/11 | ⚠️ | Code-path audited; supports `%APPDATA%` paths and detached relaunch |
| macOS (Intel/Apple Silicon) | ⚠️ | Code-path audited; uses `~/Library/Application Support` paths |
| Linux (Debian, Ubuntu, Fedora, Arch) | ✅ | Runtime tested; respects XDG Base Directory spec |

## Notes

- Profile switching **restarts Antigravity** to apply changes
- Each profile stores the complete authentication state
- Up to **10 profiles** supported (`antigravitySwitcher.maxProfiles`, default 7)
- The workspace you had open is automatically restored after a profile switch

---

Made for bypassing rate limits without the hassle of manual re-login! 🚀
