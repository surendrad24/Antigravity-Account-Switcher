# Antigravity Multi-Account Switcher

**Version 1.0.0** — Cross-Platform Release (Windows · Linux · macOS)

Seamlessly switch between multiple accounts in Antigravity to bypass model rate limits without manual re-login.

---

## Features

### 🎨 7 Colorful Profile Buttons
- **7 profile slot buttons** in the status bar with distinct colors
  (Blue, Green, Orange, Purple, Pink, Teal, Amber)
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

---

## Requirements

- Antigravity IDE (VS Code-compatible)
- Node.js is **not** required separately — the extension uses Antigravity's bundled Node runtime

## Supported Platforms

| Platform | Tested | Notes |
|----------|--------|-------|
| Windows 10/11 | ✅ | Uses `%APPDATA%` paths; launches via `explorer.exe` |
| macOS (Intel/Apple Silicon) | ✅ | Uses `~/Library/Application Support` |
| Linux (Debian, Ubuntu, Fedora, Arch) | ✅ | Respects XDG Base Directory spec |

## Notes

- Profile switching **restarts Antigravity** to apply changes
- Each profile stores the complete authentication state
- Up to **7 profiles** supported (configurable up to 10 in Settings)
- The workspace you had open is automatically restored after a profile switch

---

Made for bypassing rate limits without the hassle of manual re-login! 🚀
