#!/usr/bin/env node
/**
 * Antigravity Profile Manager (Cross-Platform)
 * Replaces profile_manager.ps1 with a Node.js implementation that works on
 * Windows, Linux, and macOS.
 *
 * Usage:
 *   node profile_manager.js --action <Save|Load|List|Delete> [--profile <name>] [--max <n>]
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawnSync, spawn } = require('child_process');

// ─── CLI argument parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag) {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const action      = getArg('--action');
const profileName = getArg('--profile') || '';
const maxProfiles = parseInt(getArg('--max') || '7', 10);
const profilesDirArg = getArg('--profiles-dir');

if (!action || !['Save', 'Load', 'List', 'Delete', 'Reset'].includes(action)) {
    console.error('Invalid or missing --action. Must be one of: Save, Load, List, Delete, Reset');
    process.exit(1);
}


// ─── Platform-aware paths ────────────────────────────────────────────────────

/**
 * Returns the OS-appropriate base data directory for Antigravity.
 *
 * Windows : %APPDATA%\Antigravity
 * macOS   : ~/Library/Application Support/Antigravity
 * Linux   : ~/.config/Antigravity   (XDG_CONFIG_HOME respected)
 */
function getAntigravityDataPath() {
    switch (process.platform) {
        case 'win32':
            return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity');
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity');
        default: // linux and other Unix
            return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Antigravity');
    }
}

/**
 * Returns the OS-appropriate path to the .antigravity extension data directory.
 *
 * Windows : %APPDATA%\.antigravity  (APPDATA, not LOCALAPPDATA)
 * macOS   : ~/Library/Application Support/.antigravity  (checked) OR ~/.antigravity
 * Linux   : ~/.antigravity
 */
function getAntigravityExtPath() {
    const home = os.homedir();
    if (process.platform === 'win32') {
        // On Windows, hidden-dot dirs go under APPDATA\\.antigravity conventionally
        return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), '.antigravity');
    }
    if (process.platform === 'darwin') {
        // macOS Antigravity may put extension state in both locations; prefer ~/.antigravity
        // if it exists, else fall back to the Library path.
        const dotPath = path.join(home, '.antigravity');
        if (fs.existsSync(dotPath)) return dotPath;
        return path.join(home, 'Library', 'Application Support', '.antigravity');
    }
    return path.join(home, '.antigravity');
}

/**
 * Returns the root path where Antigravity stores Google OAuth credentials.
 *
 * All platforms use ~/.gemini/ (a hidden dir off the user home).
 * On Windows: C:\Users\<user>\.gemini\
 * On macOS:   /Users/<user>/.gemini/
 * On Linux:   /home/<user>/.gemini/
 */
function getGeminiRootPath() {
    return path.join(os.homedir(), '.gemini');
}

/**
 * Returns common paths where Antigravity might install its executable,
 * ordered by likelihood on each platform.
 */
function getAntigravityExecutablePaths() {
    const home = os.homedir();
    switch (process.platform) {
        case 'win32':
            return [
                path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Antigravity', 'Antigravity.exe'),
                path.join(process.env.PROGRAMFILES  || 'C:\\Program Files',  'Antigravity', 'Antigravity.exe'),
                path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Antigravity', 'Antigravity.exe'),
            ];
        case 'darwin':
            return [
                '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
                path.join(home, 'Applications', 'Antigravity.app', 'Contents', 'MacOS', 'Antigravity'),
                '/usr/local/bin/antigravity',
                '/opt/homebrew/bin/antigravity',
                path.join(home, '.local', 'bin', 'antigravity'),
            ];
        default: // linux
            return [
                '/usr/bin/antigravity',
                '/usr/local/bin/antigravity',
                '/usr/share/antigravity/antigravity',
                path.join(home, '.local', 'bin', 'antigravity'),
                path.join(home, 'bin', 'antigravity'),
                '/opt/antigravity/antigravity',
                '/snap/bin/antigravity',
            ];
    }
}

/**
 * Process name used when killing existing Antigravity processes.
 */
function getAntigravityProcessName() {
    switch (process.platform) {
        case 'win32':  return 'Antigravity';
        case 'darwin': return 'Antigravity';
        default:       return 'antigravity';
    }
}

const antigravityDataPath = getAntigravityDataPath();
const antigravityExtPath  = getAntigravityExtPath();

// The real Antigravity auth data lives in ~/.gemini/ directly (all platforms):
//   oauth_creds.json, google_accounts.json, installation_id,
//   state.json, settings.json, projects.json, trustedFolders.json
// NOTE: We do NOT back up ~/.gemini/antigravity/ (AI assistant app data)
//       and we handle ~/.gemini/history/ separately as 'gem_history'.
const geminiRootPath    = getGeminiRootPath();
const geminiHistoryPath = path.join(geminiRootPath, 'history');

// Auth-relevant files inside ~/.gemini/ root that belong to a specific Google account.
const GEMINI_AUTH_FILES = [
    'oauth_creds.json',
    'google_accounts.json',
    'installation_id',
    'state.json',
    'settings.json',
    'projects.json',
    'trustedFolders.json',
];

// Subdirectories of ~/.gemini/ to skip (AI assistant app data, not per-account auth).
// Comparison is case-insensitive to handle Windows filesystem behaviour.
const GEMINI_EXCLUDED_DIRS = ['antigravity'];
function isExcludedGeminiDir(name) {
    return GEMINI_EXCLUDED_DIRS.some(d => d.toLowerCase() === name.toLowerCase());
}

const profilesStorePath = profilesDirArg
    ? path.resolve(profilesDirArg)
    : path.join(antigravityDataPath, 'Profiles');

// Ensure profiles directory exists
fs.mkdirSync(profilesStorePath, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dirSizeMB(dirPath) {
    let total = 0;
    try {
        const walk = (d) => {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, entry.name);
                if (entry.isDirectory()) walk(full);
                else total += fs.statSync(full).size;
            }
        };
        walk(dirPath);
    } catch (_) {}
    return Math.round(total / (1024 * 1024) * 100) / 100;
}

function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath  = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function removeDirRecursive(dirPath) {
    if (!fs.existsSync(dirPath)) return;

    // Node 12+ has fs.rmSync; fall back for older runtimes
    if (fs.rmSync) {
        try {
            fs.rmSync(dirPath, { recursive: true, force: true });
        } catch (e) {}
    } else {
        // Polyfill for older Node
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
            const full = path.join(dirPath, entry.name);
            if (entry.isDirectory()) removeDirRecursive(full);
            else fs.unlinkSync(full);
        }
        fs.rmdirSync(dirPath);
    }
}

function removePathForce(targetPath) {
    if (!fs.existsSync(targetPath)) return;
    const stat = fs.lstatSync(targetPath);
    if (stat.isDirectory()) {
        removeDirRecursive(targetPath);
    } else {
        fs.unlinkSync(targetPath);
    }
}

function removePathWithRetry(targetPath, retries = 8, delayMs = 500) {
    if (!fs.existsSync(targetPath)) return true;
    for (let i = 0; i < retries; i++) {
        try {
            removePathForce(targetPath);
            if (!fs.existsSync(targetPath)) return true;
        } catch (_) {}
        sleep(delayMs);
    }
    return !fs.existsSync(targetPath);
}

function resolveOnPath(binName) {
    const pathVar = process.env.PATH || '';
    const dirs = pathVar.split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
        const candidate = path.join(dir, binName);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Sleep for N milliseconds.
 *
 * Uses Atomics.wait (synchronous, zero-overhead) on worker threads (Linux/macOS
 * in Node ≥ 9). Falls back to a busy-wait on the main thread (Windows) where
 * Atomics.wait is prohibited by spec.
 */
function sleep(ms) {
    try {
        const sab  = new SharedArrayBuffer(4);
        const view = new Int32Array(sab);
        // Atomics.wait throws "Cannot be performed on the main thread" on Windows
        // and returns "timed-out" on success on Linux/macOS.
        const result = Atomics.wait(view, 0, 0, ms);
        if (result === 'not-equal' || result === 'timed-out') return; // worked
    } catch (_) {
        // Fallback: busy-wait (only reached on Windows main thread)
        const end = Date.now() + ms;
        while (Date.now() < end) { /* spin */ }
    }
}

/** Kill all running Antigravity processes in a cross-platform way. */
function killAntigravityProcesses() {
    const procName = getAntigravityProcessName();
    try {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/F', '/IM', `${procName}.exe`], { stdio: 'ignore' });
        } else if (process.platform === 'darwin') {
            // macOS: pkill is available and more reliable than pgrep + kill loop.
            // -i = case-insensitive, -f = match full command line
            spawnSync('pkill', ['-9', '-if', 'antigravity'], { stdio: 'ignore' });
        } else {
            // Linux: pgrep -a lists PID + full cmdline; filter carefully to avoid
            // killing ourselves or the Node process running this script.
            console.log('[DEBUG] Attempting to kill all Antigravity processes...');
            const pgrep = spawnSync('pgrep', ['-a', '-i', '-f', 'antigravity'], { encoding: 'utf8' });
            if (pgrep.stdout) {
                const selfPid   = process.pid;
                const parentPid = process.ppid;
                const lines = pgrep.stdout.split('\n').filter(Boolean);
                for (const line of lines) {
                    const firstSpace = line.indexOf(' ');
                    if (firstSpace <= 0) continue;
                    const pid = Number(line.slice(0, firstSpace));
                    const cmd = line.slice(firstSpace + 1).toLowerCase();
                    if (!Number.isFinite(pid)) continue;
                    if (pid === selfPid || pid === parentPid) continue;
                    if (cmd.includes('profile_manager.js') || cmd.includes('node')) continue;
                    console.log(`[DEBUG] Killing app PID: ${pid}`);
                    spawnSync('kill', ['-9', String(pid)], { stdio: 'ignore' });
                }
            }
        }
    } catch (_) {}
}

/** Find and return the Antigravity executable path, or null. */
function findAntigravityExe() {
    console.log('[DEBUG] Searching for Antigravity executable...');
    // 1. Try PATH resolution without shell utilities.
    let fromPath;
    if (process.platform === 'win32') {
        fromPath = resolveOnPath('Antigravity.exe')
            || resolveOnPath('antigravity.exe')
            || resolveOnPath('antigravity.cmd');
    } else {
        fromPath = resolveOnPath('antigravity');
    }
    if (fromPath) {
        console.log(`[DEBUG] Found via PATH: ${fromPath}`);
        return fromPath;
    }

    // 2. Try standard locations.
    for (const p of getAntigravityExecutablePaths()) {
        console.log(`[DEBUG] Checking path: ${p}`);
        if (fs.existsSync(p)) {
            console.log(`[DEBUG] Found in standard location: ${p}`);
            return p;
        }
    }
    return null;
}

/** Launch Antigravity in a fully detached, non-blocking manner. */
function launchAntigravity(exePath) {
    if (process.platform === 'win32') {
        // On Windows .cmd wrappers must be launched with shell:true.
        // Try the resolved .exe first (shell not needed), then .cmd fallbacks.
        const attempts = exePath ? [exePath] : [];
        attempts.push('antigravity.cmd', 'antigravity');

        for (const bin of attempts) {
            const needsShell = bin.endsWith('.cmd') || bin.endsWith('.bat');
            try {
                spawn(bin, [], {
                    detached: true,
                    shell: needsShell,
                    stdio: 'ignore',
                }).unref();
                return true;
            } catch (_) {}
        }
        return false;
    } else {
        // macOS / Linux: detached spawn, no shell dependency.
        const attempts = exePath ? [exePath] : [];
        attempts.push('antigravity');

        for (const bin of attempts) {
            try {
                console.log(`[DEBUG] Launch attempt: ${bin}`);
                spawn(bin, [], {
                    detached: true,
                    stdio:    'ignore',
                    env:      process.env,
                    shell:    false,
                }).unref();
                return true;
            } catch (_) {}
        }
        return false;
    }
}


// ─── Actions ─────────────────────────────────────────────────────────────────
function getProfiles() {
    const profiles = [];
    if (!fs.existsSync(profilesStorePath)) return profiles;
    for (const entry of fs.readdirSync(profilesStorePath, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(profilesStorePath, entry.name);
        const stat     = fs.statSync(fullPath);
        profiles.push({
            Name:    entry.name,
            Created: stat.birthtime.toISOString().replace('T', ' ').slice(0, 16),
            Size:    dirSizeMB(fullPath)
        });
    }
    return profiles;
}
function saveProfile(name) {
    // Validate name
    if (/[\\/:*?"<>|\0]/.test(name)) {
        console.error('Profile name contains invalid characters');
        process.exit(1);
    }

    const existing = getProfiles();
    const exists   = existing.some(p => p.Name === name);

    if (!exists && existing.length >= maxProfiles) {
        console.error(`Maximum profile limit (${maxProfiles}) reached.`);
        process.exit(1);
    }

    const targetPath = path.join(profilesStorePath, name);

    if (fs.existsSync(targetPath)) {
        removeDirRecursive(targetPath);
    }

    console.log(`Saving all data to profile '${name}'...`);
    fs.mkdirSync(targetPath, { recursive: true });

    // 1. Copy from .config/Antigravity
    for (const entry of fs.readdirSync(antigravityDataPath, { withFileTypes: true })) {
        if (entry.name === 'Profiles' || entry.name.includes('_switching_backup') || entry.name === 'active_profile.txt') continue;
        const srcPath  = path.join(antigravityDataPath, entry.name);
        const destPath = path.join(targetPath, 'config_' + entry.name); // Prefix to avoid collisions
        try {
            if (entry.isDirectory()) copyDirRecursive(srcPath, destPath);
            else fs.copyFileSync(srcPath, destPath);
        } catch (e) {}
    }

    // 2. Copy from .antigravity (except the switcher extension itself)
    const targetExtPath = path.join(targetPath, 'ext_data');
    fs.mkdirSync(targetExtPath, { recursive: true });
    if (fs.existsSync(antigravityExtPath)) {
        for (const entry of fs.readdirSync(antigravityExtPath, { withFileTypes: true })) {
            if (entry.name === 'extensions') continue; // Don't swap the extensions themselves
            const srcPath  = path.join(antigravityExtPath, entry.name);
            const destPath = path.join(targetExtPath, entry.name);
            try {
                if (entry.isDirectory()) copyDirRecursive(srcPath, destPath);
                else fs.copyFileSync(srcPath, destPath);
            } catch (e) {}
        }
    }

    // 3. Save auth-relevant files from ~/.gemini/ root (oauth_creds, google_accounts, etc.)
    //    These are the Google OAuth tokens — the root cause of having to re-login.
    const targetGemAuthPath = path.join(targetPath, 'gem_auth');
    fs.mkdirSync(targetGemAuthPath, { recursive: true });
    if (fs.existsSync(geminiRootPath)) {
        for (const entry of fs.readdirSync(geminiRootPath, { withFileTypes: true })) {
            // Only copy auth-relevant named files; skip excluded dirs and the history dir
            if (isExcludedGeminiDir(entry.name)) continue;
            if (entry.name === 'history') continue; // saved separately below
            if (entry.isDirectory()) {
                // Save non-excluded subdirectories (e.g. any future auth dirs)
                const srcPath  = path.join(geminiRootPath, entry.name);
                const destPath = path.join(targetGemAuthPath, entry.name);
                try { copyDirRecursive(srcPath, destPath); } catch (e) {}
            } else if (GEMINI_AUTH_FILES.includes(entry.name)) {
                // Copy auth files by whitelist
                const srcPath  = path.join(geminiRootPath, entry.name);
                const destPath = path.join(targetGemAuthPath, entry.name);
                try { fs.copyFileSync(srcPath, destPath); } catch (e) {}
            }
        }
    }

    // 4. Save chat history from ~/.gemini/history/
    //    This is the root cause of chat history being lost on profile switch.
    const targetGemHistoryPath = path.join(targetPath, 'gem_history');
    if (fs.existsSync(geminiHistoryPath)) {
        fs.mkdirSync(targetGemHistoryPath, { recursive: true });
        try {
            copyDirRecursive(geminiHistoryPath, targetGemHistoryPath);
            console.log(`Chat history saved to profile '${name}'.`);
        } catch (e) {
            console.error(`Warning: could not save chat history: ${e.message}`);
        }
    }

    console.log(`Profile '${name}' saved successfully.`);
    console.log(JSON.stringify({ Success: true, Message: 'Profile saved' }));
}

function loadProfile(name) {
    const profilePath = path.join(profilesStorePath, name);

    if (!fs.existsSync(profilePath)) {
        console.error(`Profile '${name}' not found`);
        process.exit(1);
    }

    const exePath = findAntigravityExe();

    // Stop Antigravity
    console.log('Stopping Antigravity...');
    killAntigravityProcesses();
    // Wait for process to fully release file locks before clearing data.
    // Windows releases handles quickly; Linux Electron takes longer.
    const killWaitMs = process.platform === 'win32' ? 2000
                     : process.platform === 'darwin' ? 3000
                     : 5000; // linux
    sleep(killWaitMs);

    // Swap the entire directory
    console.log(`Switching to profile '${name}'...`);

    // 1. Clear current root data
    console.log(`[DEBUG] Clearing active data in ${antigravityDataPath} and ${antigravityExtPath}...`);
    
    // Clear .config/Antigravity
    const clearFailures = [];
    for (const entry of fs.readdirSync(antigravityDataPath, { withFileTypes: true })) {
        if (entry.name === 'Profiles' || entry.name === 'active_profile.txt') continue;
        const fullPath = path.join(antigravityDataPath, entry.name);
        if (!removePathWithRetry(fullPath)) clearFailures.push(fullPath);
    }

    // Clear .antigravity (except extensions)
    if (fs.existsSync(antigravityExtPath)) {
        for (const entry of fs.readdirSync(antigravityExtPath, { withFileTypes: true })) {
            if (entry.name === 'extensions') continue;
            const fullPath = path.join(antigravityExtPath, entry.name);
            if (!removePathWithRetry(fullPath)) clearFailures.push(fullPath);
        }
    }

    // Clear auth-relevant files in ~/.gemini/ root (excluding app dirs and history)
    if (fs.existsSync(geminiRootPath)) {
        for (const entry of fs.readdirSync(geminiRootPath, { withFileTypes: true })) {
            if (isExcludedGeminiDir(entry.name)) continue;
            if (entry.name === 'history') continue; // cleared separately below
            if (entry.isDirectory()) {
                // Clear non-excluded subdirs
                const fullPath = path.join(geminiRootPath, entry.name);
                if (!removePathWithRetry(fullPath)) clearFailures.push(fullPath);
            } else if (GEMINI_AUTH_FILES.includes(entry.name)) {
                // Remove auth files
                const fullPath = path.join(geminiRootPath, entry.name);
                try { fs.unlinkSync(fullPath); } catch (_) {}
            }
        }
    }

    // Clear chat history in ~/.gemini/history/ before restoring from profile
    if (fs.existsSync(geminiHistoryPath)) {
        if (!removePathWithRetry(geminiHistoryPath)) clearFailures.push(geminiHistoryPath);
    }

    if (clearFailures.length > 0) {
        console.error(`Failed to fully clear existing profile data:\n${clearFailures.join('\n')}`);
        process.exit(1);
    }

    // 2. Copy profile content to root
    console.log(`[DEBUG] Copying profile content from ${profilePath}...`);
    for (const entry of fs.readdirSync(profilePath, { withFileTypes: true })) {
        if (entry.name === 'ext_data') {
            // Restore .antigravity folder
            const extDataPath = path.join(profilePath, 'ext_data');
            for (const subEntry of fs.readdirSync(extDataPath, { withFileTypes: true })) {
                const srcPath  = path.join(extDataPath, subEntry.name);
                const destPath = path.join(antigravityExtPath, subEntry.name);
                try {
                    if (subEntry.isDirectory()) copyDirRecursive(srcPath, destPath);
                    else fs.copyFileSync(srcPath, destPath);
                } catch (e) {
                    console.error(`Failed to restore extension data: ${srcPath} -> ${destPath}`);
                    console.error(e.message);
                    process.exit(1);
                }
            }
        } else if (entry.name === 'gem_auth') {
            // Restore Google OAuth tokens and auth files to ~/.gemini/ root
            const gemAuthSrc = path.join(profilePath, 'gem_auth');
            for (const authEntry of fs.readdirSync(gemAuthSrc, { withFileTypes: true })) {
                const srcPath  = path.join(gemAuthSrc, authEntry.name);
                const destPath = path.join(geminiRootPath, authEntry.name);
                try {
                    if (authEntry.isDirectory()) copyDirRecursive(srcPath, destPath);
                    else fs.copyFileSync(srcPath, destPath);
                } catch (e) {
                    console.error(`Failed to restore auth file: ${srcPath} -> ${destPath}: ${e.message}`);
                }
            }
            console.log(`[DEBUG] Google auth tokens restored for profile '${name}'.`);
        } else if (entry.name === 'gem_history') {
            // Restore chat history to ~/.gemini/history/
            const historySrc = path.join(profilePath, 'gem_history');
            fs.mkdirSync(geminiHistoryPath, { recursive: true });
            try {
                copyDirRecursive(historySrc, geminiHistoryPath);
                console.log(`[DEBUG] Chat history restored for profile '${name}'.`);
            } catch (e) {
                console.error(`Failed to restore chat history: ${e.message}`);
            }
        } else if (entry.name === 'gem_data') {
            // Legacy: restore old .gemini/antigravity-browser-profile format (if any)
            // This handles profiles saved before the path fix.
            const legacyGemPath = path.join(os.homedir(), '.gemini', 'antigravity-browser-profile');
            fs.mkdirSync(legacyGemPath, { recursive: true });
            copyDirRecursive(path.join(profilePath, 'gem_data'), legacyGemPath);
        } else if (entry.name.startsWith('config_')) {
            // Restore .config/Antigravity folder
            const realName = entry.name.slice('config_'.length);
            const srcPath  = path.join(profilePath, entry.name);
            const destPath = path.join(antigravityDataPath, realName);
            try {
                if (entry.isDirectory()) copyDirRecursive(srcPath, destPath);
                else fs.copyFileSync(srcPath, destPath);
            } catch (e) {
                console.error(`Failed to restore config data: ${srcPath} -> ${destPath}`);
                console.error(e.message);
                process.exit(1);
            }
        }
    }

    // 3. Mark as active
    try {
        fs.writeFileSync(path.join(antigravityDataPath, 'active_profile.txt'), name);
    } catch (e) {}

    // Restart Antigravity
    console.log(`Starting Antigravity${exePath ? ` from: ${exePath}` : ' from PATH fallback'}...`);
    sleep(2000);
    const launchOk = launchAntigravity(exePath);
    if (!launchOk) {
        console.error('Failed to relaunch Antigravity automatically. Please open it manually.');
        process.exit(1);
    }

    console.log(`Profile '${name}' loaded successfully.`);
    console.log(JSON.stringify({ Success: true, Message: 'Profile loaded', Restarted: true }));
}

function resetProfile(name) {
    const targetPath = path.join(profilesStorePath, name);
    if (fs.existsSync(targetPath)) {
        removeDirRecursive(targetPath);
    }
    fs.mkdirSync(targetPath, { recursive: true });
    // Create a dummy file to ensure the folder is kept
    fs.writeFileSync(path.join(targetPath, '.empty_profile'), '');
    console.log(`Fresh empty profile '${name}' created.`);
    console.log(JSON.stringify({ Success: true, Message: 'Profile reset' }));
}

function deleteProfile(name) {
    const profilePath = path.join(profilesStorePath, name);

    if (!fs.existsSync(profilePath)) {
        console.error(`Profile '${name}' not found`);
        process.exit(1);
    }

    removeDirRecursive(profilePath);
    console.log(`Profile '${name}' deleted.`);
    console.log(JSON.stringify({ Success: true, Message: 'Profile deleted' }));
}

function listProfiles() {
    const profiles = getProfiles();
    const count    = profiles.length;
    // Extension relies on this JSON output.
    console.log(JSON.stringify({ 
        Profiles: profiles, 
        Count: count, 
        MaxProfiles: maxProfiles,
        DataPath: antigravityDataPath 
    }));
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────
switch (action) {
    case 'Save':
        if (!profileName) { console.error('--profile is required for Save'); process.exit(1); }
        saveProfile(profileName);
        break;
    case 'Load':
        if (!profileName) { console.error('--profile is required for Load'); process.exit(1); }
        loadProfile(profileName);
        break;
    case 'List':
        listProfiles();
        break;
    case 'Delete':
        if (!profileName) { console.error('--profile is required for Delete'); process.exit(1); }
        deleteProfile(profileName);
        break;
    case 'Reset':
        if (!profileName) { console.error('--profile is required for Reset'); process.exit(1); }
        resetProfile(profileName);
        break;
    case '_cleanup':
        // Internal: called as a detached child to remove old backup
        if (profileName && fs.existsSync(profileName)) {
            setTimeout(() => removeDirRecursive(profileName), 5000);
        }
        break;
}
