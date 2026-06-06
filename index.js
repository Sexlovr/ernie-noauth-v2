import express from 'express';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { db, getNextAccount, bumpAccountUsage, disableAccount } from './lib/database.js';
import { fetchErnieSSE } from './lib/ernieClient.js';
import { resolveModelParams, buildFullContext, buildOpenAIChunk } from './lib/translator.js';
import { getScreenshot, clickAt, typeText, launchInteractiveBrowser, getBrowserStatus } from './lib/browser_controller.js';
import { parseErnieCurl } from './lib/curlParser.js';
import { buildAdminPage } from './lib/page.js';

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
    res.send(buildAdminPage());
});

app.post('/admin/login', (req, res) => {
    const { password } = req.body;
    const expected = process.env.ADMIN_PASSWORD || 'admin';
    if (password === expected) return res.json({ success: true, token: expected });
    return res.status(401).json({ error: 'Incorrect Password' });
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

app.delete('/admin/accounts/:id', adminAuth, (req, res) => {
    try {
        db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
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
