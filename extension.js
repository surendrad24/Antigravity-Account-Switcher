const vscode = require('vscode');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

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
    console.log('Antigravity Account Switcher v1.0.1 is now active');

    // Path to the cross-platform Node.js profile manager script
    const scriptPath = path.join(context.extensionPath, 'scripts', 'profile_manager.js');

    // Number of profile slots shown in the status bar (configurable)
    const configuredSlots = vscode.workspace
        .getConfiguration('antigravitySwitcher')
        .get('maxProfiles', 7);
    const NUM_SLOTS = Math.max(1, Math.min(10, Number(configuredSlots) || 7));
    const configuredProfilesDirectory = vscode.workspace
        .getConfiguration('antigravitySwitcher')
        .get('profilesDirectory', '')
        .trim();
    const configuredPin = vscode.workspace
        .getConfiguration('antigravitySwitcher')
        .get('profilePin', '')
        .trim();
    const autoSnapshotMinutes = Number(vscode.workspace
        .getConfiguration('antigravitySwitcher')
        .get('autoSnapshotMinutes', 0)) || 0;

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
            default: {
                const xdgStatePath = path.join(
                    process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
                    'Antigravity',
                    'logs'
                );
                if (fs.existsSync(xdgStatePath)) return xdgStatePath;
                return path.join(getAntigravityDataPath(), 'logs');
            }
        }
    }

    const ANTIGRAVITY_DATA = getAntigravityDataPath();

    // File to store the active profile name (shared across all profiles)
    const ACTIVE_PROFILE_FILE = path.join(ANTIGRAVITY_DATA, 'active_profile.txt');

    // File to store pending workspace restoration
    const PENDING_WORKSPACE_FILE = path.join(ANTIGRAVITY_DATA, 'pending_workspace.txt');
    const ACTIVITY_LOG_FILE = path.join(ANTIGRAVITY_DATA, 'switcher_activity.log');
    const ANALYTICS_FILE = path.join(ANTIGRAVITY_DATA, 'switcher_analytics.json');

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

    function appendActivityLog(message) {
        try {
            const dir = path.dirname(ACTIVITY_LOG_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const line = `[${new Date().toISOString()}] ${message}\n`;
            fs.appendFileSync(ACTIVITY_LOG_FILE, line, 'utf8');
        } catch (e) {
            console.error('Error writing activity log:', e);
        }
    }

    function recordAnalytics(event, profileName = '') {
        try {
            let data = { events: [] };
            if (fs.existsSync(ANALYTICS_FILE)) data = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
            data.events = data.events || [];
            data.events.push({ at: new Date().toISOString(), event, profileName });
            if (data.events.length > 1000) data.events = data.events.slice(-1000);
            fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('Error recording analytics:', e);
        }
    }

    async function verifyPinIfEnabled() {
        if (!configuredPin) return true;
        const entered = await vscode.window.showInputBox({ prompt: 'Enter profile PIN', password: true });
        if (!entered || entered !== configuredPin) {
            vscode.window.showErrorMessage('Invalid PIN.');
            return false;
        }
        return true;
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
        '#90A4AE', // Blue Grey
        '#AED581', // Lime
        '#FF8A65', // Deep Orange
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
            const nodeArgs = [
                scriptPath,
                '--action', action,
                '--max', String(NUM_SLOTS),
            ];
            if (profileName) {
                nodeArgs.push('--profile', profileName);
            }
            if (configuredProfilesDirectory) {
                nodeArgs.push('--profiles-dir', configuredProfilesDirectory);
            }

            const nodeBin = process.argv[0] || 'node';
            execFile(nodeBin, nodeArgs, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
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
        console.log(`[DEBUG] Profile Manager Output: ${result.output}`);
        try {
            // Extract the first JSON line that contains a Profiles array.
            const jsonLine = result.output
                .split(/\r?\n/)
                .map(line => line.trim())
                .find(line => line.startsWith('{') && line.includes('"Profiles"'));
            if (jsonLine) {
                const parsed = JSON.parse(jsonLine);
                if (Array.isArray(parsed?.Profiles)) return parsed.Profiles;
            }
        } catch (e) {
            console.error('Error parsing profiles:', e);
        }
        return [];
    }

    async function getProfilesPayload() {
        const result = await runProfileManager('List');
        try {
            const jsonLine = result.output
                .split(/\r?\n/)
                .map(line => line.trim())
                .find(line => line.startsWith('{') && line.includes('"Profiles"'));
            if (jsonLine) return JSON.parse(jsonLine);
        } catch (e) {
            console.error('Error parsing profile payload:', e);
        }
        return { Profiles: [], DataPath: ANTIGRAVITY_DATA };
    }

    function copyDirRecursive(src, dest) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) copyDirRecursive(srcPath, destPath);
            else fs.copyFileSync(srcPath, destPath);
        }
    }

    function collectFiles(root) {
        const files = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else files.push({ rel: path.relative(root, full), content: fs.readFileSync(full).toString('base64') });
            }
        };
        walk(root);
        return files;
    }

    function restoreFiles(root, files) {
        for (const file of files) {
            const full = path.join(root, file.rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, Buffer.from(file.content, 'base64'));
        }
    }

    function encryptJsonObject(obj, passphrase) {
        const salt = crypto.randomBytes(16);
        const iv = crypto.randomBytes(12);
        const key = crypto.pbkdf2Sync(passphrase, salt, 200000, 32, 'sha256');
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        return JSON.stringify({
            v: 1,
            salt: salt.toString('base64'),
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            data: encrypted.toString('base64')
        }, null, 2);
    }

    function decryptJsonObject(payload, passphrase) {
        const parsed = JSON.parse(payload);
        const salt = Buffer.from(parsed.salt, 'base64');
        const iv = Buffer.from(parsed.iv, 'base64');
        const tag = Buffer.from(parsed.tag, 'base64');
        const data = Buffer.from(parsed.data, 'base64');
        const key = crypto.pbkdf2Sync(passphrase, salt, 200000, 32, 'sha256');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const out = Buffer.concat([decipher.update(data), decipher.final()]);
        return JSON.parse(out.toString('utf8'));
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
            appendActivityLog(`Rate limit detected; user selected profile "${selected}"`);
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
        console.log(`[DEBUG] Updating buttons with ${profiles.length} profiles`);

        for (let i = 0; i < NUM_SLOTS; i++) {
            const btn     = profileButtons[i];
            const profile = profiles[i];
            const slotNum = i + 1;
            const color   = SLOT_COLORS[i];

            if (profile && (profile.Name || profile.name)) {
                const name              = profile.Name || profile.name;
                const activeProfileName = getActiveProfile();
                const isActive          = activeProfileName && 
                    activeProfileName.toLowerCase() === name.toLowerCase();

                console.log(`[DEBUG] Slot ${slotNum}: Found profile "${name}" (Active: ${isActive})`);

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
                        const previousProfile = getActiveProfile();
                        if (previousProfile) {
                            await runProfileManager('Save', '__last_known_good');
                        }
                        setActiveProfile(profileName);
                        const result = await runProfileManager('Load', profileName);
                        if (!result.success) {
                            appendActivityLog(`Switch FAILED to "${profileName}": ${result.error}`);
                            if (previousProfile) {
                                await runProfileManager('Load', '__last_known_good');
                                setActiveProfile(previousProfile);
                            }
                            vscode.window.showErrorMessage(`Failed to switch: ${result.error}`);
                        } else {
                            appendActivityLog(`Switched to "${profileName}"`);
                            recordAnalytics('switch_success', profileName);
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

        const setupChoice = await vscode.window.showQuickPick(
            [
                { label: '$(copy) Copy Current Data (Keep Logins)', detail: 'Copies your current settings and logged-in accounts to the new profile.' },
                { label: '$(plus) Start Fresh (Empty Profile)', detail: 'Creates a brand new profile with no accounts or settings.' }
            ],
            { placeHolder: `How should we set up profile "${profileName}"?` }
        );

        if (!setupChoice) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: setupChoice.label.includes('Fresh') ? `Creating empty profile "${profileName}"...` : `Saving profile "${profileName}"...`,
            cancellable: false,
        }, async () => {
            // If they chose Start Fresh, we use a special "Reset" action in the script
            const action = setupChoice.label.includes('Fresh') ? 'Reset' : 'Save';
            const result = await runProfileManager(action, profileName);
            
            if (result.success) {
                appendActivityLog(`Created profile "${profileName}" via action "${action}"`);
                recordAnalytics('profile_create', profileName);
                vscode.window.showInformationMessage(`Profile "${profileName}" created successfully!`);
                updateProfileButtons();
            } else {
                vscode.window.showErrorMessage(`Failed to create profile: ${result.error}`);
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
        if (!await verifyPinIfEnabled()) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Deleting profile "${selected.profileName}"...`,
            cancellable: false,
        }, async () => {
            const result = await runProfileManager('Delete', selected.profileName);
            if (result.success) {
                appendActivityLog(`Deleted profile "${selected.profileName}"`);
                recordAnalytics('profile_delete', selected.profileName);
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
        if (!await verifyPinIfEnabled()) return;

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Switching to "${selected.profileName}"...`,
            cancellable: false,
        }, async () => {
            savePendingWorkspace();
            const previousProfile = getActiveProfile();
            if (previousProfile) {
                await runProfileManager('Save', '__last_known_good');
            }
            setActiveProfile(selected.profileName);
            const result = await runProfileManager('Load', selected.profileName);
            if (!result.success) {
                appendActivityLog(`Switch FAILED to "${selected.profileName}": ${result.error}`);
                if (previousProfile) {
                    await runProfileManager('Load', '__last_known_good');
                    setActiveProfile(previousProfile);
                }
                vscode.window.showErrorMessage(`Failed to switch: ${result.error}`);
            } else {
                appendActivityLog(`Switched to "${selected.profileName}"`);
                recordAnalytics('switch_success', selected.profileName);
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
            appendActivityLog(`Set active profile marker to "${selected.profileName}"`);
            vscode.window.showInformationMessage(
                `"${selected.profileName}" is now marked as the active profile.`
            );
            updateProfileButtons();
        }
    );
    context.subscriptions.push(setActiveCmd);

    const showLogCmd = vscode.commands.registerCommand('antigravity-switcher.showActivityLog', async () => {
        try {
            if (!fs.existsSync(ACTIVITY_LOG_FILE)) {
                vscode.window.showInformationMessage('No activity log yet.');
                return;
            }
            const content = fs.readFileSync(ACTIVITY_LOG_FILE, 'utf8').trim();
            const lines = content.split(/\r?\n/).slice(-30);
            const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'log' });
            await vscode.window.showTextDocument(doc, { preview: false });
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to open activity log: ${e.message}`);
        }
    });
    context.subscriptions.push(showLogCmd);

    const diagnosticsCmd = vscode.commands.registerCommand('antigravity-switcher.runDiagnostics', async () => {
        const profiles = await getProfiles();
        const active = getActiveProfile();
        const missing = [];
        if (!fs.existsSync(path.join(ANTIGRAVITY_DATA, 'User'))) missing.push('User');
        if (!fs.existsSync(path.join(ANTIGRAVITY_DATA, 'Cookies'))) missing.push('Cookies');
        const summary = [
            `Profiles: ${profiles.length}/${NUM_SLOTS}`,
            `Active marker: ${active || '(none)'}`,
            `Missing runtime files: ${missing.length ? missing.join(', ') : 'none'}`,
            `Profiles dir override: ${configuredProfilesDirectory || '(default)'}`
        ].join('\n');
        appendActivityLog(`Diagnostics run. ${summary.replace(/\n/g, ' | ')}`);
        vscode.window.showInformationMessage(summary);
    });
    context.subscriptions.push(diagnosticsCmd);

    const healthCmd = vscode.commands.registerCommand('antigravity-switcher.healthCheckProfiles', async () => {
        const payload = await getProfilesPayload();
        const profiles = payload.Profiles || [];
        const base = configuredProfilesDirectory || path.join(payload.DataPath || ANTIGRAVITY_DATA, 'Profiles');
        if (profiles.length === 0) {
            vscode.window.showInformationMessage('No profiles found to health-check.');
            return;
        }
        const report = profiles.map((p) => {
            const name = p.Name || p.name;
            const root = path.join(base, name);
            const hasPrefs = fs.existsSync(path.join(root, 'config_Preferences'));
            const hasCookies = fs.existsSync(path.join(root, 'config_Cookies'));
            const size = Number(p.Size || 0);
            let status = 'OK';
            if (size <= 0.01) status = 'EMPTY';
            else if (!hasPrefs || !hasCookies) status = 'PARTIAL';
            return `${name}: ${status} (${size} MB)`;
        });
        appendActivityLog(`Health check run for ${profiles.length} profiles`);
        const doc = await vscode.workspace.openTextDocument({ content: report.join('\n'), language: 'log' });
        await vscode.window.showTextDocument(doc, { preview: false });
    });
    context.subscriptions.push(healthCmd);

    const exportCmd = vscode.commands.registerCommand('antigravity-switcher.exportProfile', async () => {
        const profiles = await getProfiles();
        if (!profiles.length) {
            vscode.window.showInformationMessage('No profiles available to export.');
            return;
        }
        const picked = await vscode.window.showQuickPick(
            profiles.map(p => ({ label: p.Name || p.name, profileName: p.Name || p.name })),
            { placeHolder: 'Select profile to export' }
        );
        if (!picked) return;
        const targetRoot = await vscode.window.showInputBox({
            prompt: 'Enter destination folder path for export',
            value: path.join(os.homedir(), 'antigravity-profile-exports')
        });
        if (!targetRoot) return;
        const modePick = await vscode.window.showQuickPick(
            [
                { label: 'Full', value: 'full' },
                { label: 'Auth Only', value: 'auth' },
                { label: 'Settings Only', value: 'settings' }
            ],
            { placeHolder: 'Select export mode' }
        );
        if (!modePick) return;
        const payload = await getProfilesPayload();
        const store = configuredProfilesDirectory || path.join(payload.DataPath || ANTIGRAVITY_DATA, 'Profiles');
        const src = path.join(store, picked.profileName);
        const dest = path.join(targetRoot, picked.profileName);
        if (!fs.existsSync(src)) {
            vscode.window.showErrorMessage('Profile source folder not found.');
            return;
        }
        copyDirRecursive(src, dest);
        if (modePick.value === 'auth') {
            for (const e of fs.readdirSync(dest)) {
                if (!e.includes('Cookies') && !e.includes('Local Storage') && !e.includes('Session Storage') && !e.includes('User')) {
                    fs.rmSync(path.join(dest, e), { recursive: true, force: true });
                }
            }
        } else if (modePick.value === 'settings') {
            for (const e of fs.readdirSync(dest)) {
                if (!e.includes('Preferences') && !e.includes('User')) {
                    fs.rmSync(path.join(dest, e), { recursive: true, force: true });
                }
            }
        }
        fs.writeFileSync(path.join(dest, 'export_info.json'), JSON.stringify({
            name: picked.profileName, exportedAt: new Date().toISOString()
        }, null, 2));
        appendActivityLog(`Exported profile "${picked.profileName}" (${modePick.value}) to ${dest}`);
        recordAnalytics('profile_export', picked.profileName);
        vscode.window.showInformationMessage(`Exported "${picked.profileName}" to ${dest}`);
    });
    context.subscriptions.push(exportCmd);

    const importCmd = vscode.commands.registerCommand('antigravity-switcher.importProfile', async () => {
        const src = await vscode.window.showInputBox({
            prompt: 'Enter full path of exported profile folder to import'
        });
        if (!src) return;
        if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
            vscode.window.showErrorMessage('Invalid source folder.');
            return;
        }
        const name = await vscode.window.showInputBox({
            prompt: 'Profile name to import as',
            value: path.basename(src)
        });
        if (!name) return;
        if (/[\\/:*?"<>|\0]/.test(name)) {
            vscode.window.showErrorMessage('Invalid profile name.');
            return;
        }
        const payload = await getProfilesPayload();
        const store = configuredProfilesDirectory || path.join(payload.DataPath || ANTIGRAVITY_DATA, 'Profiles');
        const dest = path.join(store, name);
        if (fs.existsSync(dest)) {
            const overwrite = await vscode.window.showWarningMessage(
                `Profile "${name}" already exists. Overwrite?`,
                { modal: true },
                'Overwrite'
            );
            if (overwrite !== 'Overwrite') return;
            fs.rmSync(dest, { recursive: true, force: true });
        }
        copyDirRecursive(src, dest);
        appendActivityLog(`Imported profile "${name}" from ${src}`);
        recordAnalytics('profile_import', name);
        vscode.window.showInformationMessage(`Imported profile "${name}" successfully.`);
        updateProfileButtons();
    });
    context.subscriptions.push(importCmd);

    const repairCmd = vscode.commands.registerCommand('antigravity-switcher.repairCurrentSession', async () => {
        const confirm = await vscode.window.showWarningMessage(
            'This will clear runtime caches only (not Profiles). Continue?',
            { modal: true },
            'Repair'
        );
        if (confirm !== 'Repair') return;
        const targets = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache'];
        for (const t of targets) {
            const p = path.join(ANTIGRAVITY_DATA, t);
            if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
        }
        appendActivityLog('Repaired current session caches.');
        vscode.window.showInformationMessage('Session cache repaired. Restart Antigravity for full effect.');
    });
    context.subscriptions.push(repairCmd);

    const encExportCmd = vscode.commands.registerCommand('antigravity-switcher.exportProfileEncrypted', async () => {
        const profiles = await getProfiles();
        if (!profiles.length) return vscode.window.showInformationMessage('No profiles available to export.');
        const picked = await vscode.window.showQuickPick(
            profiles.map(p => ({ label: p.Name || p.name, profileName: p.Name || p.name })),
            { placeHolder: 'Select profile to encrypt-export' }
        );
        if (!picked) return;
        const pass = await vscode.window.showInputBox({ prompt: 'Encryption passphrase', password: true });
        if (!pass) return;
        const out = await vscode.window.showInputBox({
            prompt: 'Output encrypted file path',
            value: path.join(os.homedir(), `${picked.profileName}.agprofile.enc.json`)
        });
        if (!out) return;
        const payload = await getProfilesPayload();
        const store = configuredProfilesDirectory || path.join(payload.DataPath || ANTIGRAVITY_DATA, 'Profiles');
        const src = path.join(store, picked.profileName);
        const files = collectFiles(src);
        const encrypted = encryptJsonObject({ name: picked.profileName, files }, pass);
        fs.writeFileSync(out, encrypted, 'utf8');
        appendActivityLog(`Encrypted export created for "${picked.profileName}" at ${out}`);
        recordAnalytics('profile_export_encrypted', picked.profileName);
        vscode.window.showInformationMessage(`Encrypted export created: ${out}`);
    });
    context.subscriptions.push(encExportCmd);

    const encImportCmd = vscode.commands.registerCommand('antigravity-switcher.importProfileEncrypted', async () => {
        const source = await vscode.window.showInputBox({ prompt: 'Path to encrypted profile file' });
        if (!source || !fs.existsSync(source)) return vscode.window.showErrorMessage('Encrypted file not found.');
        const pass = await vscode.window.showInputBox({ prompt: 'Decryption passphrase', password: true });
        if (!pass) return;
        const targetName = await vscode.window.showInputBox({ prompt: 'Import profile name (optional)', value: '' });
        const blob = fs.readFileSync(source, 'utf8');
        let parsed;
        try {
            parsed = decryptJsonObject(blob, pass);
        } catch (e) {
            return vscode.window.showErrorMessage('Failed to decrypt file. Check passphrase.');
        }
        const profileName = targetName?.trim() || parsed.name;
        const payload = await getProfilesPayload();
        const store = configuredProfilesDirectory || path.join(payload.DataPath || ANTIGRAVITY_DATA, 'Profiles');
        const dest = path.join(store, profileName);
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        restoreFiles(dest, parsed.files || []);
        appendActivityLog(`Encrypted import restored profile "${profileName}" from ${source}`);
        recordAnalytics('profile_import_encrypted', profileName);
        vscode.window.showInformationMessage(`Encrypted profile imported as "${profileName}".`);
        updateProfileButtons();
    });
    context.subscriptions.push(encImportCmd);

    const analyticsCmd = vscode.commands.registerCommand('antigravity-switcher.showAnalytics', async () => {
        let data = { events: [] };
        if (fs.existsSync(ANALYTICS_FILE)) data = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
        const counts = {};
        for (const ev of data.events || []) {
            const key = `${ev.event}:${ev.profileName || '-'}`;
            counts[key] = (counts[key] || 0) + 1;
        }
        const lines = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} -> ${v}`);
        const content = lines.length ? lines.join('\n') : 'No analytics data yet.';
        const doc = await vscode.workspace.openTextDocument({ content, language: 'log' });
        await vscode.window.showTextDocument(doc, { preview: false });
    });
    context.subscriptions.push(analyticsCmd);

    if (autoSnapshotMinutes > 0) {
        const interval = setInterval(async () => {
            const active = getActiveProfile();
            if (!active) return;
            const snapName = `__snapshot_${active}`;
            const result = await runProfileManager('Save', snapName);
            if (result.success) {
                appendActivityLog(`Auto snapshot updated: ${snapName}`);
                recordAnalytics('auto_snapshot', active);
            }
        }, autoSnapshotMinutes * 60 * 1000);
        context.subscriptions.push({ dispose: () => clearInterval(interval) });
    }

    // Startup guard: if active profile looks empty but other non-empty profiles exist, suggest recovery.
    (async () => {
        const profiles = await getProfiles();
        const active = getActiveProfile();
        const activeEntry = profiles.find(p => (p.Name || p.name) === active);
        const activeSize = Number(activeEntry?.Size || 0);
        const fallback = profiles
            .filter(p => Number(p.Size || 0) > 1 && (p.Name || p.name) !== active)
            .sort((a, b) => Number(b.Size || 0) - Number(a.Size || 0))[0];
        if (active && activeSize <= 1 && fallback) {
            const pick = await vscode.window.showWarningMessage(
                `Active profile "${active}" looks empty. Restore "${fallback.Name || fallback.name}"?`,
                'Restore',
                'Ignore'
            );
            if (pick === 'Restore') {
                await runProfileManager('Load', fallback.Name || fallback.name);
                setActiveProfile(fallback.Name || fallback.name);
                appendActivityLog(`Startup guard restored "${fallback.Name || fallback.name}" from empty active "${active}"`);
            }
        }
    })();

    // Initial render of all buttons
    updateProfileButtons();
}

function deactivate() {
    console.log('Antigravity Account Switcher deactivated');
}

module.exports = { activate, deactivate };
