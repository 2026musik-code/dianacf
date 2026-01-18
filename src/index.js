import { Hono } from 'https://esm.sh/hono@4.1.0'
import { html } from 'https://esm.sh/hono@4.1.0/html'

const app = new Hono()

app.get('/', (c) => {
  return c.html(html`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare Mini - Luxury Edition</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        glass: 'rgba(255, 255, 255, 0.1)',
                    },
                    backdropBlur: {
                        xs: '2px',
                    }
                }
            }
        }
    </script>
    <style>
        body {
            background: radial-gradient(circle at top left, #1a202c, #2d3748, #000);
            min-height: 100vh;
            color: white;
            font-family: 'Inter', sans-serif;
        }
        .glass-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 1rem;
        }
        .input-field {
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: white;
            transition: all 0.3s ease;
        }
        .input-field:focus {
            border-color: #a78bfa;
            outline: none;
            box-shadow: 0 0 10px rgba(167, 139, 250, 0.2);
        }
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            transition: transform 0.2s;
        }
        .btn-primary:hover {
            transform: scale(1.02);
            filter: brightness(1.1);
        }
        .loader {
            border: 3px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top: 3px solid #fff;
            width: 20px;
            height: 20px;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body class="p-4 md:p-8 flex justify-center items-start">

    <div class="max-w-4xl w-full space-y-8">
        <!-- Header -->
        <header class="text-center space-y-2">
            <h1 class="text-5xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
                Cloudflare Mini
            </h1>
            <p class="text-gray-400 text-lg">Canggih. Modern. Mewah.</p>
        </header>

        <!-- Credentials Section -->
        <div class="glass-card p-6 space-y-4">
            <h2 class="text-xl font-semibold text-purple-300">Credentials</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm text-gray-400 mb-1">Account ID</label>
                    <input type="text" id="accountId" class="input-field w-full p-3 rounded-lg" placeholder="Your CF Account ID">
                </div>
                <div>
                    <label class="block text-sm text-gray-400 mb-1">API Token</label>
                    <input type="password" id="apiToken" class="input-field w-full p-3 rounded-lg" placeholder="Your CF API Token">
                </div>
            </div>
        </div>

        <!-- Main Actions -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">

            <!-- Deploy Code -->
            <div class="glass-card p-6 lg:col-span-2 space-y-4">
                <div class="flex justify-between items-center">
                    <h2 class="text-xl font-semibold text-blue-300">Deploy Worker</h2>
                    <div class="flex space-x-2">
                        <button onclick="setMode('code')" id="btn-code" class="px-3 py-1 rounded bg-white/10 text-sm">Code</button>
                        <button onclick="setMode('github')" id="btn-github" class="px-3 py-1 rounded bg-transparent text-gray-400 text-sm">GitHub Link</button>
                    </div>
                </div>

                <div>
                    <label class="block text-sm text-gray-400 mb-1">Worker Name</label>
                    <input type="text" id="workerName" class="input-field w-full p-3 rounded-lg mb-4" placeholder="my-awesome-worker">
                </div>

                <div id="code-section">
                    <label class="block text-sm text-gray-400 mb-1">JavaScript Code</label>
                    <textarea id="workerCode" class="input-field w-full p-3 rounded-lg font-mono text-sm h-64" spellcheck="false">
export default {
  async fetch(request, env, ctx) {
    return new Response('Hello World!');
  },
};</textarea>
                </div>

                <div id="github-section" class="hidden">
                    <label class="block text-sm text-gray-400 mb-1">GitHub Raw URL</label>
                    <input type="text" id="githubUrl" class="input-field w-full p-3 rounded-lg" placeholder="https://raw.githubusercontent.com/user/repo/main/worker.js">
                    <p class="text-xs text-gray-500 mt-2">Enter the link to the raw JS file.</p>
                </div>

                <button onclick="deploy()" id="deployBtn" class="btn-primary w-full py-3 rounded-lg font-bold text-white shadow-lg flex justify-center items-center gap-2">
                    Deploy to Cloudflare
                </button>
            </div>

            <!-- Sidebar / Settings -->
            <div class="space-y-6">
                <!-- Update Web -->
                <div class="glass-card p-6 space-y-4 relative overflow-hidden">
                    <div class="absolute -top-10 -right-10 w-20 h-20 bg-pink-500 rounded-full blur-3xl opacity-20"></div>
                    <h3 class="text-lg font-semibold text-pink-300">System Update</h3>
                    <p class="text-sm text-gray-400">Update this dashboard directly from the source repository.</p>
                    <label class="block text-sm text-gray-400 mb-1">Current Worker Name</label>
                    <input type="text" id="selfName" class="input-field w-full p-2 rounded-lg text-sm mb-2" placeholder="dianacf">
                    <button onclick="updateSystem()" id="updateBtn" class="w-full py-2 rounded-lg border border-pink-500/50 text-pink-300 hover:bg-pink-500/10 transition flex justify-center items-center gap-2">
                        Update Web
                    </button>
                </div>

                <div class="glass-card p-6">
                    <h3 class="text-lg font-semibold text-gray-300">Status</h3>
                    <div id="status-log" class="mt-4 text-sm font-mono text-gray-400 space-y-2 h-32 overflow-y-auto">
                        <p>> Ready.</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // State Management
        let mode = 'code';

        function setMode(newMode) {
            mode = newMode;
            if (mode === 'code') {
                document.getElementById('code-section').classList.remove('hidden');
                document.getElementById('github-section').classList.add('hidden');
                document.getElementById('btn-code').classList.replace('bg-transparent', 'bg-white/10');
                document.getElementById('btn-code').classList.remove('text-gray-400');
                document.getElementById('btn-github').classList.replace('bg-white/10', 'bg-transparent');
                document.getElementById('btn-github').classList.add('text-gray-400');
            } else {
                document.getElementById('code-section').classList.add('hidden');
                document.getElementById('github-section').classList.remove('hidden');
                document.getElementById('btn-github').classList.replace('bg-transparent', 'bg-white/10');
                document.getElementById('btn-github').classList.remove('text-gray-400');
                document.getElementById('btn-code').classList.replace('bg-white/10', 'bg-transparent');
                document.getElementById('btn-code').classList.add('text-gray-400');
            }
        }

        function log(msg, type = 'info') {
            const el = document.getElementById('status-log');
            const p = document.createElement('p');
            p.textContent = '> ' + msg;
            if (type === 'error') p.style.color = '#f87171';
            if (type === 'success') p.style.color = '#4ade80';
            el.prepend(p);
        }

        async function deploy() {
            const accountId = document.getElementById('accountId').value;
            const apiToken = document.getElementById('apiToken').value;
            const workerName = document.getElementById('workerName').value;

            if (!accountId || !apiToken || !workerName) {
                log('Missing credentials or worker name', 'error');
                return;
            }

            const btn = document.getElementById('deployBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<div class="loader"></div> Processing...';
            btn.disabled = true;

            try {
                let payload = {
                    accountId,
                    apiToken,
                    workerName,
                    mode
                };

                if (mode === 'code') {
                    payload.content = document.getElementById('workerCode').value;
                } else {
                    payload.content = document.getElementById('githubUrl').value;
                }

                log('Sending deployment request...');
                const res = await fetch('/api/deploy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();

                if (data.success) {
                    log('Deployment successful!', 'success');
                } else {
                    log('Error: ' + (data.error || 'Unknown error'), 'error');
                }

            } catch (e) {
                log('System Error: ' + e.message, 'error');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }

        async function updateSystem() {
            const accountId = document.getElementById('accountId').value;
            const apiToken = document.getElementById('apiToken').value;
            const selfName = document.getElementById('selfName').value;

            if (!accountId || !apiToken || !selfName) {
                log('Missing credentials or worker name for update', 'error');
                return;
            }

            const btn = document.getElementById('updateBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<div class="loader"></div>';
            btn.disabled = true;

            try {
                log('Initiating system update...');
                const res = await fetch('/api/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accountId, apiToken, workerName: selfName })
                });

                const data = await res.json();

                if (data.success) {
                    log('Update successful! Reloading...', 'success');
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    log('Update failed: ' + (data.error || 'Unknown'), 'error');
                }
            } catch (e) {
                log('Update Error: ' + e.message, 'error');
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    </script>
</body>
</html>
  `)
})

// Helper to interact with Cloudflare API
async function uploadToCloudflare(accountId, apiToken, workerName, scriptContent) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`;

    // We upload as a module
    // To do this properly with metadata, we need FormData, but for simple JS files,
    // sending raw JS with Content-Type: application/javascript often works for non-module workers,
    // but for ES modules, we should use FormData.
    // Let's try simple PUT first which works for "Service Workers" format,
    // For "Modules", we might need to handle FormData.
    // Given the prompt "Deploy code file JS", simple JS is expected.

    // Detect if content seems to be a module (imports/exports)
    const isModule = scriptContent.includes('export default') || scriptContent.includes('import ');

    let headers = {
        'Authorization': `Bearer ${apiToken}`
    };

    let body;

    if (isModule) {
        // Construct FormData manually or use a simple workaround
        // Since we are in a Worker, we have FormData.
        const formData = new FormData();
        formData.append('files', new Blob([scriptContent], { type: 'application/javascript+module' }), 'worker.js');
        formData.append('metadata', JSON.stringify({ main_module: 'worker.js' }));

        body = formData;
        // Do not set Content-Type header for FormData, fetch does it automatically with boundary
    } else {
        headers['Content-Type'] = 'application/javascript';
        body = scriptContent;
    }

    const response = await fetch(url, {
        method: 'PUT',
        headers: isModule ? { 'Authorization': headers['Authorization'] } : headers,
        body: body
    });

    const result = await response.json();
    return result;
}

app.post('/api/deploy', async (c) => {
    try {
        const { accountId, apiToken, workerName, mode, content } = await c.req.json();

        let finalCode = content;

        if (mode === 'github') {
            const ghRes = await fetch(content);
            if (!ghRes.ok) throw new Error('Failed to fetch from GitHub');
            finalCode = await ghRes.text();
        }

        const result = await uploadToCloudflare(accountId, apiToken, workerName, finalCode);

        if (result.success) {
            return c.json({ success: true });
        } else {
            return c.json({ success: false, error: result.errors?.[0]?.message || JSON.stringify(result) });
        }

    } catch (e) {
        return c.json({ success: false, error: e.message });
    }
});

app.post('/api/update', async (c) => {
    try {
        const { accountId, apiToken, workerName } = await c.req.json();

        // Fetch the latest version of THIS file from GitHub
        // Using the raw URL for the index.js
        // Assuming the repo structure from user context
        const repoUrl = 'https://raw.githubusercontent.com/2026musik-code/dianacf/main/src/index.js';

        const ghRes = await fetch(repoUrl);
        if (!ghRes.ok) throw new Error('Failed to fetch update from GitHub');

        const latestCode = await ghRes.text();

        const result = await uploadToCloudflare(accountId, apiToken, workerName, latestCode);

        if (result.success) {
             return c.json({ success: true });
        } else {
            return c.json({ success: false, error: result.errors?.[0]?.message || JSON.stringify(result) });
        }

    } catch (e) {
        return c.json({ success: false, error: e.message });
    }
});

export default app
