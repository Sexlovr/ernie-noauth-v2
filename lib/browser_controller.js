import { spawn } from 'child_process';

let activeBrowser = null;
let activePage = null;
let xvfbProcess = null;

let browserEmail = null;
let browserStatus = 'idle'; // idle | starting | running | done | error
let statusMessage = '';

// ── Xvfb Only ──
function startXvfb() {
    if (xvfbProcess) return;
    console.log('[Xvfb] Starting virtual framebuffer...');
    xvfbProcess = spawn('Xvfb', [':99', '-screen', '0', '400x800x16', '-ac'], { shell: true });
    xvfbProcess.on('exit', () => { xvfbProcess = null; });
    process.env.DISPLAY = ':99';
}

function stopXvfb() {
    if (xvfbProcess) {
        try { xvfbProcess.kill('SIGKILL'); } catch (e) {}
        xvfbProcess = null;
    }
}

export async function getScreenshot() {
    if (!activePage) return null;
    try {
        return await activePage.screenshot({ type: 'jpeg', quality: 50, fullPage: false });
    } catch (e) {
        console.error('[Screenshot] Failed:', e.message);
        return null;
    }
}

export async function clickAt(x, y) {
    if (!activePage) throw new Error('No browser running');
    console.log(`[Click] Tapping at (${x}, ${y})`);
    await activePage.mouse.click(x, y);
}

export async function typeText(text) {
    if (!activePage) throw new Error('No browser running');
    console.log(`[Keyboard] Typing ${text.length} chars`);
    await activePage.keyboard.type(text, { delay: 30 });
}

export function getBrowserStatus() {
    return { status: browserStatus, message: statusMessage, email: browserEmail };
}

export async function launchInteractiveBrowser(email, db) {
    if (activeBrowser) {
        await activeBrowser.close().catch(() => {});
        activeBrowser = null;
        activePage = null;
    }

    browserEmail = email;
    browserStatus = 'starting';
    statusMessage = 'Booting Xvfb + Chromium...';

    startXvfb();
    await new Promise(r => setTimeout(r, 2000));

    const { chromium } = await import('playwright');

    activeBrowser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--no-first-run',
            '--disable-extensions',
            '--disable-features=Translate,OptimizationHints,MediaRouter',
            '--mute-audio',
            '--window-size=400,800',
            '--display=:99'
        ]
    });

    const context = await activeBrowser.newContext({
        viewport: { width: 400, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
    });

    activePage = await context.newPage();

    let capturedData = null;

    activePage.on('request', async request => {
        const url = request.url();
        if (url.includes('/eb/chat/conversation/v2')) {
            try {
                const headers = request.headers();
                const acsToken = headers['acs-token']; // Playwright lowercases ALL header names
                const postData = request.postDataJSON();
                
                if (acsToken && postData && postData.sign && postData.jt) {
                    const cookies = await context.cookies();
                    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                    
                    capturedData = {
                        acs_token: acsToken,
                        sign: postData.sign,
                        jt: postData.jt,
                        cookie_string: cookieString
                    };
                    console.log('[Browser] Successfully extracted Ernie Credentials!');
                }
            } catch (e) {
                // Ignore parse errors on other payloads
            }
        }
    });

    await activePage.goto('https://ernie.baidu.com/');
    browserStatus = 'running';
    statusMessage = 'Browser ready! Press NEW CHAT or send a message to capture credentials.';
    console.log('[Browser] Navigated to Ernie. Use screenshot panel to interact.');

    (async () => {
        try {
            let attempts = 0;
            while (!capturedData && attempts < 600) { // 10 minutes max
                await new Promise(r => setTimeout(r, 1000));
                attempts++;
            }

            if (!capturedData) {
                browserStatus = 'error';
                statusMessage = 'Timed out waiting for login (10 min).';
                throw new Error('Timed out waiting for Ernie credentials.');
            }

            statusMessage = 'Token captured! Saving to database...';

            const existing = db.prepare('SELECT id FROM accounts WHERE name = ?').get(email);
            if (existing) {
                db.prepare('UPDATE accounts SET acs_token = ?, sign = ?, jt = ?, cookie_string = ?, active = 1 WHERE id = ?')
                  .run(capturedData.acs_token, capturedData.sign, capturedData.jt, capturedData.cookie_string, existing.id);
                console.log(`[Browser] Credentials updated for existing account: ${email}`);
            } else {
                db.prepare('INSERT INTO accounts (name, acs_token, sign, jt, cookie_string) VALUES (?, ?, ?, ?, ?)')
                  .run(email, capturedData.acs_token, capturedData.sign, capturedData.jt, capturedData.cookie_string);
                console.log(`[Browser] Created new database account for: ${email}`);
            }

            browserStatus = 'done';
            statusMessage = `Account ${email} saved successfully!`;

        } catch (e) {
            console.error('[Browser Error]', e.message);
            browserStatus = 'error';
            statusMessage = e.message;
        } finally {
            if (activeBrowser) {
                await activeBrowser.close().catch(() => {});
                activeBrowser = null;
                activePage = null;
            }
            stopXvfb();
        }
    })();

    return { success: true, message: 'Browser launched! Use the screenshot panel.' };
}
