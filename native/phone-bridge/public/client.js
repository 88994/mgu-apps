'use strict';

(function () {
    const $ = (id) => document.getElementById(id);
    const state = $('state'), pairPanel = $('pair-panel'), terminal = $('terminal-panel');
    let expires = 0, busy = false;

    function showAuth(active) {
        pairPanel.classList.toggle('hidden', active);
        terminal.classList.toggle('hidden', !active);
        state.textContent = active ? 'Connected' : 'Not connected';
        state.classList.toggle('ok', active);
    }
    async function api(endpoint, body) {
        const res = await fetch('/api/' + endpoint, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Terminal-Request': '1' },
            body: JSON.stringify(body || {})
        });
        let json;
        try { json = await res.json(); } catch (e) { throw new Error('Invalid bridge response'); }
        if (!res.ok) throw new Error(json.error || 'Request failed');
        return json;
    }
    async function startup() {
        const match = /^#pair=([0-9a-f]{64})$/.exec(window.location.hash);
        // The one-time code is in the fragment, never in the HTTP request URL or referrer.
        if (match) {
            history.replaceState(null, '', location.pathname);
            try {
                const result = await api('pair', { token: match[1] });
                expires = result.expiresAt;
                showAuth(true);
                return;
            } catch (e) { $('pair-message').textContent = e.message + '. Start a new session on the car.'; }
        }
        try {
            const res = await fetch('/api/status', { cache: 'no-store' });
            if (!res.ok) throw new Error('Not connected');
            const data = await res.json();
            expires = data.expiresAt;
            showAuth(true);
        } catch (e) { showAuth(false); }
    }
    function dangerous(cmd) {
        return /\b(?:rm|dd|mkfs|fdisk|parted|mount|umount|chmod|chown|systemctl|reboot|shutdown|halt|poweroff|flash|killall|pkill)\b|\s[>]|\s*&&\s*|\s*;\s*/i.test(cmd);
    }
    async function run() {
        if (busy) return;
        const cmd = $('command').value.trim();
        if (!cmd) return;
        if (dangerous(cmd) && !confirm('This command may change or damage the head unit. Execute as root?')) return;
        busy = true;
        $('run').disabled = true;
        $('hint').textContent = 'Executing…';
        $('output').textContent += '\n\nroot@mgu # ' + cmd + '\n';
        try {
            const result = await api('exec', { command: cmd });
            $('output').textContent += (result.stdout || '') + (result.stderr ? '\n[stderr]\n' + result.stderr : '');
            if (result.truncated) $('output').textContent += '\n[output limit reached]';
            if (result.timedOut) $('output').textContent += '\n[15-second command timeout]';
            $('output').textContent += '\n[exit ' + result.code + ', ' + result.elapsedMs + 'ms]';
        } catch (e) {
            $('output').textContent += '\n[error] ' + e.message;
            if (/Session ended|Not paired/.test(e.message)) showAuth(false);
        } finally {
            busy = false; $('run').disabled = false;
            $('hint').textContent = 'Commands execute as root.';
            $('output').scrollTop = $('output').scrollHeight;
        }
    }
    $('run').addEventListener('click', run);
    $('command').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); run(); }
    });
    document.querySelectorAll('[data-cmd]').forEach((button) => {
        button.addEventListener('click', () => { $('command').value = button.getAttribute('data-cmd'); });
    });
    $('clear').addEventListener('click', () => { $('output').textContent = 'Output cleared.'; });
    $('disconnect').addEventListener('click', async () => {
        try { await api('logout'); } catch (e) { /* still remove the local UI */ }
        showAuth(false);
        $('pair-message').textContent = 'Disconnected. Start a new session on the car.';
    });
    setInterval(() => {
        if (!expires || terminal.classList.contains('hidden')) return;
        const secs = Math.max(0, Math.floor((expires - Date.now()) / 1000));
        $('expiry').textContent = 'Time remaining: ' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
        if (!secs) { showAuth(false); $('pair-message').textContent = 'Session expired. Pair again on the car.'; }
    }, 1000);
    startup();
})();
