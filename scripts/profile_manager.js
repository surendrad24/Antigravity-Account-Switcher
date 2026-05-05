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
const { execFileSync, spawnSync } = require('child_process');

// ─── CLI argument parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag) {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const action      = getArg('--action');
const profileName = getArg('--profile') || '';
const maxProfiles = parseInt(getArg('--max') || '7', 10);

if (!action || !['Save', 'Load', 'List', 'Delete'].includes(action)) {
    console.error('Invalid or missing --action. Must be one of: Save, Load, List, Delete');
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
                path.join(home, '.local', 'bin', 'antigravity'),
            ];
        default: // linux
            return [
                '/usr/bin/antigravity',
                '/usr/local/bin/antigravity',
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
const profilesStorePath   = path.join(antigravityDataPath, 'Profiles');
const userDataPath        = path.join(antigravityDataPath, 'User');

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
        fs.rmSync(dirPath, { recursive: true, force: true });
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

/** Kill all running Antigravity processes in a cross-platform way. */
function killAntigravityProcesses() {
    const procName = getAntigravityProcessName();
    try {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/F', '/IM', `${procName}.exe`], { stdio: 'ignore' });
        } else {
            // pkill -x does an exact-name match; ignore errors if no process found
            spawnSync('pkill', ['-x', procName], { stdio: 'ignore' });
            // Also try lowercase variant
            spawnSync('pkill', ['-xi', procName], { stdio: 'ignore' });
        }
    } catch (_) {}
}

/** Sleep for N milliseconds (synchronous via Atomics). */
function sleep(ms) {
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    Atomics.wait(view, 0, 0, ms);
}

/** Find and return the Antigravity executable path, or null. */
function findAntigravityExe() {
    for (const p of getAntigravityExecutablePaths()) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/** Launch Antigravity in a fully detached, non-blocking manner. */
function launchAntigravity(exePath) {
    const { spawn } = require('child_process');
    if (process.platform === 'win32') {
        // On Windows, use explorer.exe to detach cleanly (avoids console inheritance)
        spawn('explorer.exe', [`"${exePath}"`], {
            detached: true,
            shell: true,
            stdio: 'ignore'
        }).unref();
    } else {
        spawn(exePath, [], {
            detached: true,
            stdio: 'ignore',
            env: process.env
        }).unref();
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
    // Validate name (no path separators or shell-dangerous chars)
    if (/[\\/:*?"<>|\0]/.test(name)) {
        console.error('Profile name contains invalid characters');
        process.exit(1);
    }

    const existing = getProfiles();
    const exists   = existing.some(p => p.Name === name);

    if (!exists && existing.length >= maxProfiles) {
        console.error(`Maximum profile limit (${maxProfiles}) reached. Delete a profile first.`);
        process.exit(1);
    }

    if (!fs.existsSync(userDataPath)) {
        console.error(`User Data directory not found at: ${userDataPath}`);
        process.exit(1);
    }

    const targetPath = path.join(profilesStorePath, name);

    if (fs.existsSync(targetPath)) {
        removeDirRecursive(targetPath);
    }

    console.log(`Saving profile '${name}'...`);
    copyDirRecursive(userDataPath, targetPath);
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
    if (!exePath) {
        console.error('Could not find Antigravity executable');
        process.exit(1);
    }

    // Stop Antigravity
    console.log('Stopping Antigravity...');
    killAntigravityProcesses();
    sleep(3000);

    // Backup current User Data
    const backupPath = `${userDataPath}_switching_backup`;
    if (fs.existsSync(backupPath)) {
        removeDirRecursive(backupPath);
    }

    if (fs.existsSync(userDataPath)) {
        console.log('Backing up current session...');
        fs.renameSync(userDataPath, backupPath);
    }

    // Copy profile to User Data
    console.log(`Loading profile '${name}'...`);
    copyDirRecursive(profilePath, userDataPath);

    // Clean up backup asynchronously
    if (fs.existsSync(backupPath)) {
        // Best-effort background cleanup
        try {
            const { fork } = require('child_process');
            // Re-invoke this same script as a cleanup worker
            const child = fork(
                __filename,
                ['--action', '_cleanup', '--profile', backupPath],
                { detached: true, stdio: 'ignore' }
            );
            child.unref();
        } catch (_) {
            // Non-critical – cleanup on next switch
        }
    }

    // Restart Antigravity
    console.log('Starting Antigravity...');
    sleep(2000);
    launchAntigravity(exePath);

    console.log(`Profile '${name}' loaded successfully.`);
    console.log(JSON.stringify({ Success: true, Message: 'Profile loaded', Restarted: true }));
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

    if (count === 0) {
        console.log('No profiles saved yet.');
        console.log(JSON.stringify({ Profiles: [], Count: 0, MaxProfiles: maxProfiles }));
    } else {
        console.log(`Saved Profiles (${count}/${maxProfiles}):`);
        console.log('-----------------------------------');
        for (const p of profiles) {
            console.log(`  - ${p.Name} (Created: ${p.Created}, Size: ${p.Size} MB)`);
        }
        console.log(JSON.stringify({ Profiles: profiles, Count: count, MaxProfiles: maxProfiles }));
    }
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
    case '_cleanup':
        // Internal: called as a detached child to remove old backup
        if (profileName && fs.existsSync(profileName)) {
            setTimeout(() => removeDirRecursive(profileName), 5000);
        }
        break;
}
