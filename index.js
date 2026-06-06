import express from 'express';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { db, getNextAccount, bumpAccountUsage, disableAccount } from './lib/database.js';
import { fetchErnieSSE } from './lib/ernieClient.js';
import { resolveModelParams, buildFullContext, buildOpenAIChunk } from './lib/translator.js';
import { getScreenshot, clickAt, typeText, launchInteractiveBrowser, getBrowserStatus } from './lib/browser_controller.js';
import { parseErnieCurl } from './lib/curlParser.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 7860;

app.use(express.json({ limit: '10mb' }));

const adminAuth = (req, res, next) => {
    const expected = process.env.ADMIN_PASSWORD || 'admin';
    const provided = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (provided !== expected) return res.status(401).send("Unauthorized");
    next();
};

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Ernie Proxy Gateway</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root { --primary: #3b82f6; --primary-hover: #2563eb; --bg: #0f172a; --surface: rgba(30, 41, 59, 0.7); --text: #f8fafc; --text-muted: #94a3b8; --border: rgba(255, 255, 255, 0.1); }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 2rem; font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; justify-content: center; align-items: flex-start; background: radial-gradient(circle at top right, #1e1b4b, #0f172a); }
        .glass-panel { background: var(--surface); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid var(--border); padding: 2.5rem; border-radius: 16px; width: 100%; max-width: 800px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); animation: fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1); margin-top: 2rem; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; }
        h1 { margin: 0; font-size: 1.875rem; font-weight: 700; background: linear-gradient(to right, #60a5fa, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .badge { background: rgba(16, 185, 129, 0.1); color: #34d399; padding: 0.35rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 500; display: flex; align-items: center; gap: 0.5rem; border: 1px solid rgba(16, 185, 129, 0.2); }
        .badge::before { content: ''; display: block; width: 8px; height: 8px; background: #34d399; border-radius: 50%; box-shadow: 0 0 8px #34d399; }
        h3 { font-size: 1.25rem; font-weight: 600; margin: 1.5rem 0 1rem; color: #e2e8f0; }
        .endpoint-box { background: rgba(0,0,0,0.3); border: 1px solid var(--border); padding: 1.25rem; border-radius: 10px; font-family: monospace; font-size: 0.95rem; color: #a5b4fc; display: flex; align-items: center; letter-spacing: 0.5px; margin-bottom: 2rem; }
        
        .browser-container { position: relative; width: 400px; height: 800px; margin: 0 auto; border: 2px solid var(--border); border-radius: 8px; overflow: hidden; background: #000; display: none; }
        .browser-container img { width: 100%; height: 100%; display: block; object-fit: contain; cursor: crosshair; }
        .browser-controls { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
        input, textarea { width: 100%; background: rgba(0,0,0,0.2); border: 1px solid var(--border); color: #e2e8f0; padding: 1rem; border-radius: 8px; font-family: inherit; font-size: 0.9rem; outline: none; }
        input:focus, textarea:focus { border-color: var(--primary); }
        button { background: var(--primary); color: white; border: none; padding: 0.875rem 1.5rem; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        button:hover { background: var(--primary-hover); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }
        .success { color: #34d399; }
        .error { color: #f87171; }
        #statusText { margin-top: 10px; font-weight: bold; }
    </style>
</head>
<body>
    <div class="glass-panel">
        <header>
            <h1>Ernie Proxy Gateway</h1>
            <div class="badge">VNC-Free Clicker Online</div>
        </header>
        
        <div class="tabs" style="display: flex; gap: 1rem; margin-bottom: 2rem; border-bottom: 1px solid var(--border);">
            <button class="tab-btn active" onclick="switchTab('harvester')" style="background: none; border: none; color: white; padding: 10px; border-bottom: 2px solid var(--primary); cursor: pointer; border-radius: 0;">Harvester</button>
            <button class="tab-btn" onclick="switchTab('accounts')" style="background: none; border: none; color: var(--text-muted); padding: 10px; cursor: pointer; border-radius: 0;">Accounts DB</button>
            <button class="tab-btn" onclick="switchTab('models')" style="background: none; border: none; color: var(--text-muted); padding: 10px; cursor: pointer; border-radius: 0;">Models</button>
        </div>

        <div id="tab-harvester" class="tab-content" style="display: block;">
        <p style="color: var(--text-muted);">Fully Stateless Ernie Setup. Use Admin Password to authenticate actions.</p>
        
        <h3>API Endpoint</h3>
        <div class="endpoint-box">POST /v1/chat/completions</div>
        
        <h3>Harvester Credentials</h3>
        <div class="browser-controls">
            <input type="password" id="adminPwd" placeholder="Admin Password (default 'admin')" value="admin">
            <input type="text" id="targetEmail" placeholder="Account Name / Email">
            <button onclick="launchBrowser()">Launch Screenshot Harvester</button>
        </div>

        </div>

        <div id="tab-accounts" class="tab-content" style="display: none;">
            <h3>Saved Accounts</h3>
            <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 1rem;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                    <thead style="background: rgba(255,255,255,0.05); text-align: left;">
                        <tr><th style="padding: 12px; border-bottom: 1px solid var(--border);">Email/Name</th><th style="padding: 12px; border-bottom: 1px solid var(--border);">Status</th><th style="padding: 12px; border-bottom: 1px solid var(--border);">Requests</th><th style="padding: 12px; border-bottom: 1px solid var(--border);">Last Used</th><th style="padding: 12px; border-bottom: 1px solid var(--border);">Action</th></tr>
                    </thead>
                    <tbody id="accountsTableBody">
                    </tbody>
                </table>
            </div>
            <button onclick="fetchAccounts()" style="background: var(--surface); border: 1px solid var(--border); width: auto;">↻ Refresh Accounts</button>
        </div>

        <div id="tab-models" class="tab-content" style="display: none;">
            <h3>Available Ernie Models</h3>
            <div class="endpoint-box">POST /v1/chat/completions</div>
            <p style="color: var(--text-muted); margin-bottom: 1rem; font-size: 0.9rem;">Combine the following model prefixes and suffixes to craft your request endpoint model name:</p>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; border: 1px solid var(--border);">
                    <h4 style="margin-top: 0;">Base Models</h4>
                    <p><code>EB50</code> - Base Model<br><code>EB51</code> - Version 5.1<br><code>EB-Cobuddy</code> - Cobuddy</p>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; border: 1px solid var(--border);">
                    <h4 style="margin-top: 0;">Feature Suffixes</h4>
                    <p><code>-Thinking</code> (or <code>-Think</code>)<br><code>-Search</code><br><code>-Slow</code></p>
                </div>
            </div>
            <p style="margin-top: 1rem;"><strong>Example:</strong> <code>EB50-Search-Thinking</code></p>
        </div>

    </div>

    <script>
        let browserInterval = null;
        let pToken = '';

        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active');
                btn.style.borderBottom = 'none';
                btn.style.color = 'var(--text-muted)';
            });
            document.getElementById('tab-' + tabId).style.display = 'block';
            event.target.style.borderBottom = '2px solid var(--primary)';
            event.target.style.color = 'white';

            if (tabId === 'accounts') fetchAccounts();
        }

        async function fetchAccounts() {
            if (!pToken) pToken = document.getElementById('adminPwd').value;
            try {
                const res = await fetch('/admin/accounts', {
                    headers: { 'Authorization': 'Bearer ' + pToken }
                });
                const accs = await res.json();
                if (res.ok) {
                    const tbody = document.getElementById('accountsTableBody');
                    if (accs.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="5" style="padding: 12px; text-align: center; color: var(--text-muted);">No accounts saved.</td></tr>';
                        return;
                    }
                    tbody.innerHTML = accs.map(a => 
                        '<tr>' +
                        '<td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">' + a.name + '</td>' +
                        '<td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); color: ' + (a.active ? '#34d399' : '#f87171') + '">' + (a.active ? 'Active' : 'Disabled') + '</td>' +
                        '<td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">' + a.request_count + '</td>' +
                        '<td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text-muted); font-size: 0.8rem;">' + (a.last_used || 'Never') + '</td>' +
                        '<td style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);"><button style="padding: 4px 8px; font-size: 0.75rem; width: auto; background: ' + (a.active ? '#f87171' : '#34d399') + '" onclick="toggleAccount(' + a.id + ', ' + (!a.active) + ')">' + (a.active ? 'Disable' : 'Enable') + '</button></td>' +
                        '</tr>'
                    ).join('');
                }
            } catch (e) {
                toast("Could not fetch accounts. Wrong password?", "red");
            }
        }

        async function toggleAccount(id, state) {
            await fetch('/admin/accounts/' + id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pToken },
                body: JSON.stringify({ active: state })
            });
            fetchAccounts();
        }

        async function toast(msg, color) {
            document.getElementById('statusText').innerText = msg;
            document.getElementById('statusText').style.color = color;
        }

        async function launchBrowser() {
            const email = document.getElementById('targetEmail').value.trim();
            pToken = document.getElementById('adminPwd').value;
            if (!email) return alert("Need name/email");
            
            toast("Starting virtual browser... Setting up Playwright and Xvfb...", "yellow");
            try {
                const res = await fetch('/admin/browser/launch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pToken },
                    body: JSON.stringify({ email })
                });
                const j = await res.json();
                if(res.ok) {
                    toast("Browser launched! Refreshing screenshots...", "#34d399");
                    document.getElementById('bcontainer').style.display = 'block';
                    document.getElementById('typeOps').style.display = 'flex';
                    startPolling();
                } else {
                    toast(j.error || "Failed", "#f87171");
                }
            } catch(e) {
                toast(e.message, "#f87171");
            }
        }

        function forceReloadImage() {
            if(!pToken) return;
            const img = document.getElementById('sshot');
            img.src = '/admin/browser/screenshot?token=' + encodeURIComponent(pToken) + '&t=' + Date.now();
        }

        function startPolling() {
            if(browserInterval) clearInterval(browserInterval);
            forceReloadImage();
            browserInterval = setInterval(() => {
                checkStatus();
                forceReloadImage();
            }, 3000); // 3 seconds requested by user!
        }

        async function checkStatus() {
            try {
                const res = await fetch('/admin/browser/status?token=' + pToken);
                const j = await res.json();
                if(j.status) {
                    if (j.status === 'done' || j.status === 'error') {
                        clearInterval(browserInterval);
                        toast((j.status==='error'?'Error: ':'Success: ') + j.message, j.status==='done'?'#34d399':'#f87171');
                    } else {
                        toast("Status: [" + j.status + "] " + j.message, "#fcd34d");
                    }
                }
            } catch(e){}
        }

        async function handleImgClick(e) {
            const img = e.target;
            const rect = img.getBoundingClientRect();
            // Map click coordinate based strictly on scaled image vs original Playwright (400x800)
            const scaleX = 400 / rect.width;
            const scaleY = 800 / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            
            await fetch('/admin/browser/click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pToken },
                body: JSON.stringify({ x, y })
            });
            setTimeout(forceReloadImage, 1500);
        }

        async function sendType() {
            const txt = document.getElementById('typeInput').value;
            if(!txt) return;
            await fetch('/admin/browser/type', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pToken },
                body: JSON.stringify({ text: txt })
            });
            document.getElementById('typeInput').value = '';
            setTimeout(forceReloadImage, 1500);
        }

        function fastRefresh() {
            forceReloadImage();
        }
    </script>
</body>
</html>
    `);
});

app.post('/admin/browser/launch', adminAuth, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email/Name required' });
        const result = await launchInteractiveBrowser(email, db);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/admin/browser/screenshot', adminAuth, async (req, res) => {
    try {
        const buf = await getScreenshot();
        if (!buf) return res.status(404).json({ error: 'No screenshot available yet' });
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(buf);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/admin/browser/click', adminAuth, async (req, res) => {
    try {
        const { x, y } = req.body;
        await clickAt(x, y);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/admin/browser/type', adminAuth, async (req, res) => {
    try {
        const { text } = req.body;
        await typeText(text);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/admin/browser/status', adminAuth, async (req, res) => {
    res.json(getBrowserStatus());
});

// Database Fetching / Toggling
app.get('/admin/accounts', adminAuth, (req, res) => {
    try {
        const accs = db.prepare('SELECT id, name, active, request_count, last_used FROM accounts ORDER BY id DESC').all();
        res.json(accs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/admin/accounts/:id', adminAuth, (req, res) => {
    try {
        const { active } = req.body;
        db.prepare('UPDATE accounts SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Manual cURL fallback — paste a cURL from browser DevTools
app.post('/admin/accounts', (req, res) => {
    try {
        const { curlString } = req.body;
        if (!curlString) return res.status(400).json({ error: 'curlString required in body' });
        const parsed = parseErnieCurl(curlString);
        db.prepare(`INSERT INTO accounts (name, acs_token, sign, jt, cookie_string) VALUES (?, ?, ?, ?, ?)`)
          .run(parsed.name, parsed.acs_token, parsed.sign, parsed.jt, parsed.cookie_string);
        res.json({ success: true, message: 'Account added via cURL paste' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.post('/v1/chat/completions', async (req, res) => {
    try {
        let account = getNextAccount();
        if (!account) {
            return res.status(500).json({ error: { message: "No active accounts available. Automated Harvester has not grabbed one yet. Please interact with the / endpoint clicker UI." } });
        }

        const { messages, model, stream } = req.body;
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'messages array is required' });
        }

        // FULL STATELESS DUMP: Ignore ALL "session hash" or "message_count" checks.
        // We literally just smash System, User, Assistant, into one prompt.
        const modelParams = resolveModelParams(model);
        const promptText = buildFullContext(messages);
        
        res.setHeader('Content-Type', stream ? 'text/event-stream' : 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const responseId = 'chatcmpl-' + uuidv4();
        let fullResponse = '';

        try {
            // Passing the stateless parsed model params
            const streamIterator = fetchErnieSSE(account, promptText, modelParams);
            bumpAccountUsage(account.id);

            for await (const event of streamIterator) {
                if (event.data) {
                    try {
                        const parsed = JSON.parse(event.data);
                        const payloadData = parsed.data || {};
                        
                        if (payloadData.content) {
                            let text = payloadData.content; 
                            text = text.replace(/\0/g, ''); // Remove null bytes

                            if (stream) {
                                res.write(buildOpenAIChunk(responseId, model, { content: text }));
                            }
                            fullResponse += text;
                        }
                    } catch (e) {
                         // Some chunks (major event lines) might throw parsing errors gently ignore them
                    }
                }
            }

            if (stream) {
                res.write('data: [DONE]\n\n');
                res.end();
            } else {
                res.json({
                    id: responseId,
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content: fullResponse },
                        finish_reason: 'stop'
                    }]
                });
            }

        } catch (apiError) {
            console.error('Ernie API Error:', apiError);
            if (apiError.message.includes('401') || apiError.message.includes('403') || apiError.message.includes('signature')) {
                disableAccount(account.id);
            }
            if (stream) {
                res.write(`data: ${JSON.stringify({ error: apiError.message })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
            } else if (!res.headersSent) {
                res.status(500).json({ error: apiError.message });
            }
        }

    } catch (err) {
        console.error('Proxy Error:', err);
        if (!res.headersSent) res.status(500).json({ error: err.message });
    }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Ernie-Proxy server running on port ${port}`);
});
