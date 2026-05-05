const vscode = require('vscode');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Antigravity Multi-Account Switcher
 * Version 1.0.0 — Cross-Platform (Windows · Linux · macOS)
 *
 * Features:
 * - 7 colorful profile slot buttons for one-click account switching
 * - Save/Delete profile buttons
 * - Profile switching with automatic Antigravity restart
 * - Rate limit detection with auto-switch prompt
 * - Full cross-platform support (Windows, Linux, macOS)
 *
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('Antigravity Account Switcher v1.0.0 is now active');

    // Path to the cross-platform Node.js profile manager script
    const scriptPath = path.join(context.extensionPath, 'scripts', 'profile_manager.js');

    // Number of profile slots shown in the status bar
    const NUM_SLOTS = 7;

    // ============================================
    // CROSS-PLATFORM PATHS
    // ============================================

    /**
     * Returns the OS-appropriate base data directory for Antigravity.
     *   Windows : %APPDATA%\Antigravity
     *   macOS   : ~/Library/Application Support/Antigravity
     *   Linux   : $XDG_CONFIG_HOME/Antigravity  (defaults to ~/.config/Antigravity)
     */
    function getAntigravityDataPath() {
        switch (process.platform) {
            case 'win32':
                return path.join(
                    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
                    'Antigravity'
                );
            case 'darwin':
                return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity');
            default: // linux + other Unix
                return path.join(
                    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
                    'Antigravity'
                );
        }
    }

    /**
     * Returns the OS-appropriate logs directory for Antigravity.
     *   Windows : %APPDATA%\Antigravity\logs
     *   macOS   : ~/Library/Logs/Antigravity
     *   Linux   : $XDG_STATE_HOME/Antigravity/logs  (defaults to ~/.local/state/Antigravity/logs)
     */
    function getAntigravityLogsPath() {
        switch (process.platform) {
            case 'win32':
                return path.join(getAntigravityDataPath(), 'logs');
            case 'darwin':
                return path.join(os.homedir(), 'Library', 'Logs', 'Antigravity');
            default:
                return path.join(
                    process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
                    'Antigravity',
                    'logs'
                );
        }
    }

    const ANTIGRAVITY_DATA = getAntigravityDataPath();

    // File to store the active profile name (shared across all profiles)
    const ACTIVE_PROFILE_FILE = path.join(ANTIGRAVITY_DATA, 'active_profile.txt');

    // File to store pending workspace restoration
    const PENDING_WORKSPACE_FILE = path.join(ANTIGRAVITY_DATA, 'pending_workspace.txt');

    // ============================================
    // ACTIVE PROFILE HELPERS
    // ============================================

    /**
     * Get the currently active profile name from shared file.
     */
    function getActiveProfile() {
        try {
            if (fs.existsSync(ACTIVE_PROFILE_FILE)) {
                return fs.readFileSync(ACTIVE_PROFILE_FILE, 'utf8').trim();
            }
        } catch (e) {
            console.error('Error reading active profile:', e);
        }
        return null;
    }

    /**
     * Set the active profile name in shared file.
     */
    function setActiveProfile(profileName) {
        try {
            const dir = path.dirname(ACTIVE_PROFILE_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(ACTIVE_PROFILE_FILE, profileName, 'utf8');
            return true;
        } catch (e) {
            console.error('Error saving active profile:', e);
            return false;
        }
    }

    // ============================================
    // WORKSPACE PERSISTENCE HELPERS
    // ============================================

    /**
     * Save current workspace path for restoration after profile switch.
     */
    function savePendingWorkspace() {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspacePath = workspaceFolders[0].uri.fsPath;
                const dir = path.dirname(PENDING_WORKSPACE_FILE);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(PENDING_WORKSPACE_FILE, workspacePath, 'utf8');
                console.log('Saved workspace for restoration:', workspacePath);
                return true;
            }
        } catch (e) {
            console.error('Error saving pending workspace:', e);
        }
        return false;
    }

    /**
     * Get and clear the pending workspace path.
     */
    function getPendingWorkspace() {
        try {
            if (fs.existsSync(PENDING_WORKSPACE_FILE)) {
                const workspacePath = fs.readFileSync(PENDING_WORKSPACE_FILE, 'utf8').trim();
                fs.unlinkSync(PENDING_WORKSPACE_FILE);
                return workspacePath;
            }
        } catch (e) {
            console.error('Error reading pending workspace:', e);
        }
        return null;
    }

    // ============================================
    // WORKSPACE RESTORATION ON STARTUP
    // ============================================
    const pendingWorkspace = getPendingWorkspace();
    if (pendingWorkspace && fs.existsSync(pendingWorkspace)) {
        const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (currentWorkspace !== pendingWorkspace) {
            console.log('Restoring workspace:', pendingWorkspace);
            vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(pendingWorkspace), false);
            vscode.window.showInformationMessage(`Restored workspace: ${path.basename(pendingWorkspace)}`);
        }
    }

    // ============================================
    // SLOT COLOURS (7 slots)
    // ============================================
    const SLOT_COLORS = [
        '#4FC3F7', // Light Blue
        '#81C784', // Light Green
        '#FFB74D', // Orange
        '#BA68C8', // Purple
        '#F06292', // Pink
        '#4DB6AC', // Teal
        '#FFD54F', // Amber
    ];

    // ============================================
    // RATE LIMIT DETECTION
    // ============================================
    const RATE_LIMIT_PATTERNS = [
        // Google / Gemini
        'rate limit', 'quota exceeded', 'too many requests', 'limit reached',
        'resource exhausted', '429', 'RESOURCE_EXHAUSTED',
        // Claude / Anthropic
        'overloaded', 'capacity', 'rate_limit_error', 'overloaded_error',
        'api_error', 'Request limit', 'usage limit',
        'model is currently overloaded', 'temporarily unavailable',
    ];

    const RATE_LIMIT_COOLDOWN = 60000; // 1 minute
    let lastRateLimitAlert = 0;

    // ============================================
    // PROFILE MANAGER INVOCATION (Cross-Platform)
    // ============================================

    /**
     * Invoke the Node.js profile manager script.
     * Uses the same `node` process that is running this extension.
     */
    function runProfileManager(action, profileName = '') {
        return new Promise((resolve) => {
            // Build argument array
            const nodeArgs = [
                scriptPath,
                '--action', action,
                '--max', String(NUM_SLOTS),
            ];
            if (profileName) {
                nodeArgs.push('--profile', profileName);
            }

            // Resolve node executable path — prefer the bundled one used by vscode
            const nodeBin = process.execPath || 'node';

            // Build shell command string safely
            // Wrap paths in quotes in case they contain spaces
            const quotedNode   = `"${nodeBin.replace(/"/g, '\\"')}"`;
            const quotedScript = `"${scriptPath.replace(/"/g, '\\"')}"`;
            const profileArg   = profileName
                ? `--profile "${profileName.replace(/"/g, '\\"')}"`
                : '';
            const command = `${quotedNode} ${quotedScript} --action ${action} --max ${NUM_SLOTS} ${profileArg}`;

            exec(command, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) {
                    resolve({ success: false, output: stdout, error: stderr || error.message });
                } else {
                    resolve({ success: true, output: stdout, error: null });
                }
            });
        });
    }

    /**
     * Get list of saved profiles by calling the profile manager.
     */
    async function getProfiles() {
        const result = await runProfileManager('List');
        try {
            // The script outputs JSON on the last line containing a JSON object
            const match = result.output.match(/\{[\s\S]*?"Profiles"[\s\S]*?\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                return Array.isArray(parsed.Profiles) ? parsed.Profiles : [];
            }
        } catch (e) {
            console.error('Error parsing profiles:', e);
        }
        return [];
    }

    // ============================================
    // RATE LIMIT HELPERS
    // ============================================

    function containsRateLimitError(text) {
        const lowerText = text.toLowerCase();
        return RATE_LIMIT_PATTERNS.some(p => lowerText.includes(p.toLowerCase()));
    }

    async function handleRateLimitDetected() {
        const now = Date.now();
        if (now - lastRateLimitAlert < RATE_LIMIT_COOLDOWN) return;
        lastRateLimitAlert = now;

        const profiles = await getProfiles();
        if (profiles.length === 0) {
            vscode.window.showWarningMessage(
                '⚠️ Rate limit detected! Save some profiles to quickly switch accounts.'
            );
            return;
        }

        const selected = await vscode.window.showWarningMessage(
            '⚠️ Rate limit detected! Switch to another account?',
            ...profiles.map(p => p.Name || p.name),
            'Dismiss'
        );

        if (selected && selected !== 'Dismiss') {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Switching to "${selected}"...`,
                cancellable: false,
            }, async () => {
                await runProfileManager('Load', selected);
            });
        }
    }

    // ============================================
    // RATE LIMIT MONITORING
    // ============================================

    // Monitor diagnostic messages for rate limit errors
    const diagnosticListener = vscode.languages.onDidChangeDiagnostics((e) => {
        for (const uri of e.uris) {
            const diagnostics = vscode.languages.getDiagnostics(uri);
            for (const diag of diagnostics) {
                if (containsRateLimitError(diag.message)) {
                    handleRateLimitDetected();
                    return;
                }
            }
        }
    });
    context.subscriptions.push(diagnosticListener);

    // Monitor log file for rate limit errors (poll every 30 seconds)
    let lastLogSize = 0;
    const logCheckInterval = setInterval(async () => {
        try {
            const logsDir = getAntigravityLogsPath();
            if (!fs.existsSync(logsDir)) return;

            // Find most recent log directory (sorted descending)
            const logDirs = fs.readdirSync(logsDir)
                .filter(f => fs.statSync(path.join(logsDir, f)).isDirectory())
                .sort()
                .reverse();

            if (logDirs.length === 0) return;

            const mainLog = path.join(logsDir, logDirs[0], 'main.log');
            if (!fs.existsSync(mainLog)) return;

            const stats = fs.statSync(mainLog);
            if (stats.size <= lastLogSize) return;

            const fd = fs.openSync(mainLog, 'r');
            const buffer = Buffer.alloc(Math.min(stats.size - lastLogSize, 10000));
            fs.readSync(fd, buffer, 0, buffer.length, lastLogSize);
            fs.closeSync(fd);
            lastLogSize = stats.size;

            const newContent = buffer.toString('utf8');
            if (containsRateLimitError(newContent)) {
                handleRateLimitDetected();
            }
        } catch (e) {
            // Ignore log reading errors silently
        }
    }, 30000);

    context.subscriptions.push({ dispose: () => clearInterval(logCheckInterval) });

    // ============================================
    // STATUS BAR BUTTONS (7 slots)
    // ============================================

    // Create 7 profile slot buttons with different colours
    const profileButtons = [];
    for (let i = 0; i < NUM_SLOTS; i++) {
        const btn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000 - i);
        btn.command = `antigravity-switcher.slotAction${i}`;
        btn.tooltip = `Profile Slot ${i + 1}`;
        profileButtons.push(btn);
        context.subscriptions.push(btn);
    }

    // Save button (+)
    const saveButton = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left, 1000 - NUM_SLOTS
    );
    saveButton.text = '$(add)';
    saveButton.tooltip = 'Save current session as a new profile';
    saveButton.command = 'antigravity-switcher.saveProfile';
    saveButton.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    context.subscriptions.push(saveButton);

    // Delete button (trash)
    const deleteButton = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left, 1000 - NUM_SLOTS - 1
    );
    deleteButton.text = '$(trash)';
    deleteButton.tooltip = 'Delete a profile';
    deleteButton.command = 'antigravity-switcher.deleteProfile';
    deleteButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    context.subscriptions.push(deleteButton);

    /**
     * Refresh all profile buttons based on current saved profiles.
     */
    async function updateProfileButtons() {
        const profiles = await getProfiles();

        for (let i = 0; i < NUM_SLOTS; i++) {
            const btn     = profileButtons[i];
            const profile = profiles[i];
            const slotNum = i + 1;
            const color   = SLOT_COLORS[i];

            if (profile) {
                const name            = profile.Name || profile.name;
                const activeProfileName = getActiveProfile();
                const isActive        = activeProfileName &&
                    activeProfileName.toLowerCase() === name.toLowerCase();

                if (isActive) {
                    btn.text            = `$(check) ${name}`;
                    btn.tooltip         = `"${name}" is currently active`;
                    btn.color           = '#FFFFFF';
                    btn.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
                } else {
                    btn.text            = `$(account) ${name}`;
                    btn.tooltip         = `Click to switch to "${name}"`;
                    btn.color           = color;
                    btn.backgroundColor = undefined;
                }
            } else {
                btn.text            = `$(circle-slash) ${slotNum}`;
                btn.tooltip         = `Slot ${slotNum} is empty - Click + to save`;
                btn.color           = new vscode.ThemeColor('disabledForeground');
                btn.backgroundColor = undefined;
            }
            btn.show();
        }

        saveButton.show();
        deleteButton.show();
    }

    // Register slot action commands (one per slot)
    for (let i = 0; i < NUM_SLOTS; i++) {
        const slotNum = i;
        const cmd = vscode.commands.registerCommand(
            `antigravity-switcher.slotAction${i}`,
            async () => {
                const profiles = await getProfiles();
                const profile  = profiles[slotNum];

                if (profile) {
                    const profileName       = profile.Name || profile.name;
                    const activeProfileName = getActiveProfile();

                    if (activeProfileName &&
                        activeProfileName.toLowerCase() === profileName.toLowerCase()) {
                        vscode.window.showInformationMessage(
                            `"${profileName}" is already the active profile.`
                        );
                        return;
                    }

                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Switching to "${profileName}"...`,
                        cancellable: false,
                    }, async () => {
                        savePendingWorkspace();
                        setActiveProfile(profileName);
                        const result = await runProfileManager('Load', profileName);
                        if (!result.success) {
                            vscode.window.showErrorMessage(`Failed to switch: ${result.error}`);
                        }
                        // Antigravity will restart automatically
                    });
                } else {
                    vscode.window.showInformationMessage(
                        `Slot ${slotNum + 1} is empty. Click the + button to save your current session.`
                    );
                }
            }
        );
        context.subscriptions.push(cmd);
    }

    // ============================================
    // MAIN COMMANDS
    // ============================================

    // Command: Save Profile
    const saveCmd = vscode.commands.registerCommand('antigravity-switcher.saveProfile', async () => {
        const profiles = await getProfiles();

        if (profiles.length >= NUM_SLOTS) {
            vscode.window.showWarningMessage(
                `All ${NUM_SLOTS} profile slots are full. Delete a profile first to save a new one.`
            );
            return;
        }

        const profileName = await vscode.window.showInputBox({
            prompt: 'Enter a name for this profile (e.g., your account name)',
            placeHolder: 'Profile name',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Profile name cannot be empty';
                }
                if (/[\\/:*?"<>|\0]/.test(value)) {
                    return 'Profile name contains invalid characters';
                }
                if (profiles.some(p => (p.Name || p.name).toLowerCase() === value.toLowerCase())) {
                    return 'A profile with this name already exists';
                }
                return null;
            },
        });

        if (!profileName) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Saving profile "${profileName}"...`,
            cancellable: false,
        }, async () => {
            const result = await runProfileManager('Save', profileName);
            if (result.success) {
                setActiveProfile(profileName);
                vscode.window.showInformationMessage(`Profile "${profileName}" saved and set as active!`);
                updateProfileButtons();
            } else {
                vscode.window.showErrorMessage(`Failed to save profile: ${result.error}`);
            }
        });
    });
    context.subscriptions.push(saveCmd);

    // Command: Delete Profile
    const deleteCmd = vscode.commands.registerCommand('antigravity-switcher.deleteProfile', async () => {
        const profiles = await getProfiles();

        if (profiles.length === 0) {
            vscode.window.showInformationMessage('No profiles to delete.');
            return;
        }

        const items = profiles.map(p => ({
            label: `$(trash) ${p.Name || p.name}`,
            description: 'Click to delete',
            profileName: p.Name || p.name,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a profile to delete',
        });

        if (!selected) return;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${selected.profileName}"?`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Deleting profile "${selected.profileName}"...`,
            cancellable: false,
        }, async () => {
            const result = await runProfileManager('Delete', selected.profileName);
            if (result.success) {
                vscode.window.showInformationMessage(`Profile "${selected.profileName}" deleted.`);
                updateProfileButtons();
            } else {
                vscode.window.showErrorMessage(`Failed to delete profile: ${result.error}`);
            }
        });
    });
    context.subscriptions.push(deleteCmd);

    // Command: Switch Profile (Command Palette)
    const switchCmd = vscode.commands.registerCommand('antigravity-switcher.switchProfile', async () => {
        const profiles = await getProfiles();

        if (profiles.length === 0) {
            vscode.window.showInformationMessage('No profiles saved yet. Use the + button to save one.');
            return;
        }

        const items = profiles.map((p, i) => ({
            label: `$(account) ${p.Name || p.name}`,
            description: `Slot ${i + 1}`,
            profileName: p.Name || p.name,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a profile to switch to',
        });

        if (!selected) return;

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Switching to "${selected.profileName}"...`,
            cancellable: false,
        }, async () => {
            savePendingWorkspace();
            setActiveProfile(selected.profileName);
            const result = await runProfileManager('Load', selected.profileName);
            if (!result.success) {
                vscode.window.showErrorMessage(`Failed to switch: ${result.error}`);
            }
        });
    });
    context.subscriptions.push(switchCmd);

    // Command: List Profiles
    const listCmd = vscode.commands.registerCommand('antigravity-switcher.listProfiles', async () => {
        const profiles = await getProfiles();

        if (profiles.length === 0) {
            vscode.window.showInformationMessage('No profiles saved yet.');
            return;
        }

        const profileList = profiles.map((p, i) => `${i + 1}. ${p.Name || p.name}`).join('\n');
        vscode.window.showInformationMessage(`Saved Profiles:\n${profileList}`);
    });
    context.subscriptions.push(listCmd);

    // Command: Set Active Profile (without switching / restarting)
    const setActiveCmd = vscode.commands.registerCommand(
        'antigravity-switcher.setActiveProfile',
        async () => {
            const profiles = await getProfiles();

            if (profiles.length === 0) {
                vscode.window.showInformationMessage('No profiles saved yet.');
                return;
            }

            const items = profiles.map((p, i) => ({
                label: `$(account) ${p.Name || p.name}`,
                description: `Slot ${i + 1}`,
                profileName: p.Name || p.name,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select which profile is currently active (no restart)',
            });

            if (!selected) return;

            setActiveProfile(selected.profileName);
            vscode.window.showInformationMessage(
                `"${selected.profileName}" is now marked as the active profile.`
            );
            updateProfileButtons();
        }
    );
    context.subscriptions.push(setActiveCmd);

    // Initial render of all buttons
    updateProfileButtons();
}

function deactivate() {
    console.log('Antigravity Account Switcher deactivated');
}

module.exports = { activate, deactivate };
