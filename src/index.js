import { Hono } from 'hono'
import { html } from 'hono/html'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

const app = new Hono()

// --- Middleware ---

const authMiddleware = async (c, next) => {
  // Skip auth for login, public assets, and admin routes
  if (c.req.path === '/login' || c.req.path === '/api/login' || c.req.path.startsWith('/admin') || c.req.path.startsWith('/api/admin')) {
    await next()
    return
  }

  const accountId = getCookie(c, 'cf_account_id')
  const apiToken = getCookie(c, 'cf_api_token')

  if (!accountId || !apiToken) {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Unauthorized' }, 401)
    return c.redirect('/login')
  }

  c.set('accountId', accountId)
  c.set('apiToken', apiToken)

  await next()
}

const adminMiddleware = async (c, next) => {
  const adminSession = getCookie(c, 'admin_session')
  if (c.req.path === '/admin' || c.req.path === '/api/admin/login') {
    await next()
    return
  }
  if (!adminSession) {
     if (c.req.path.startsWith('/api/')) return c.json({ error: 'Unauthorized' }, 401)
     return c.redirect('/admin')
  }
  await next()
}

// --- Helpers ---

async function getAdminPassword(env) {
    const pass = await env.MINI_KV.get('admin:password')
    return pass || 'admin'
}

async function updateAdminPassword(env, newPass) {
    await env.MINI_KV.put('admin:password', newPass)
}

async function verifyToken(apiToken) {
    try {
        const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            }
        })
        const data = await res.json()
        return data.success
    } catch (e) {
        return false
    }
}

// KV Helpers
async function getKeys(env) {
    const list = await env.MINI_KV.list()
    const keys = []
    for (const k of list.keys) {
        const val = await env.MINI_KV.get(k.name, { type: 'json' })
        if (val) keys.push(val)
    }
    return keys
}

async function getKey(env, key) {
    return await env.MINI_KV.get('key:' + key, { type: 'json' })
}

async function createKey(env, durationHours) {
    const key = Math.random().toString(36).substring(2, 8).toUpperCase()
    const data = {
        key,
        duration: durationHours,
        created_at: Date.now(),
        started_at: null,
        user_agent: null,
        ip: null,
        status: 'unused'
    }
    await env.MINI_KV.put('key:' + key, JSON.stringify(data))
    return data
}

async function deleteKey(env, key) {
    await env.MINI_KV.delete('key:' + key)
}

async function updateKey(env, key, data) {
    await env.MINI_KV.put('key:' + key, JSON.stringify(data))
}

async function cfRequest(endpoint, method, apiToken, body = null) {
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
        }
    }
    if (body) {
        options.body = JSON.stringify(body)
    }
    const res = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, options)
    return await res.json()
}

// --- Views ---

const commonHead = html`
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
        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        ::-webkit-scrollbar-track {
            background: rgba(0,0,0,0.1);
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.2);
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(255,255,255,0.3);
        }
    </style>
</head>
`

const loginPage = html`
<!DOCTYPE html>
<html lang="en">
${commonHead}
<body class="flex justify-center items-center h-screen">
    <div class="glass-card p-8 w-full max-w-md space-y-6">
        <header class="text-center">
            <h1 class="text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
                CF Mini
            </h1>
            <p class="text-gray-400 text-sm mt-2">Login to manage your Cloudflare resources</p>
        </header>

        <form id="loginForm" class="space-y-4">
            <div>
                <label class="block text-sm text-gray-400 mb-1">Access Key (Optional)</label>
                <input type="text" id="accessKey" class="input-field w-full p-3 rounded-lg" placeholder="Enter Access Key from Admin">
            </div>
            <div class="border-t border-white/10 my-4"></div>
            <div>
                <label class="block text-sm text-gray-400 mb-1">Account ID</label>
                <input type="text" id="accountId" class="input-field w-full p-3 rounded-lg" placeholder="Account ID" required>
            </div>
            <div>
                <label class="block text-sm text-gray-400 mb-1">API Token</label>
                <input type="password" id="apiToken" class="input-field w-full p-3 rounded-lg" placeholder="API Token" required>
            </div>
            <div id="error-msg" class="text-red-400 text-sm hidden"></div>
            <button type="submit" id="loginBtn" class="btn-primary w-full py-3 rounded-lg font-bold text-white shadow-lg flex justify-center items-center gap-2">
                Login
            </button>
        </form>
    </div>

    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const accountId = document.getElementById('accountId').value;
            const apiToken = document.getElementById('apiToken').value;
            const accessKey = document.getElementById('accessKey').value;
            const btn = document.getElementById('loginBtn');
            const errorMsg = document.getElementById('error-msg');

            btn.innerHTML = '<div class="loader"></div>';
            btn.disabled = true;
            errorMsg.classList.add('hidden');

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accountId, apiToken, accessKey })
                });
                const data = await res.json();

                if (data.success) {
                    window.location.href = '/';
                } else {
                    errorMsg.textContent = data.error || 'Login failed';
                    errorMsg.classList.remove('hidden');
                }
            } catch (e) {
                errorMsg.textContent = 'System error';
                errorMsg.classList.remove('hidden');
            } finally {
                btn.innerHTML = 'Login';
                btn.disabled = false;
            }
        });
    </script>
</body>
</html>
`

// --- Routes ---

app.get('/api/me', async (c) => {
    const accessKey = getCookie(c, 'access_key');
    if (!accessKey) return c.json({ remaining: null });

    const keyData = await getKey(c.env, accessKey);
    if (!keyData || keyData.status !== 'active') return c.json({ remaining: 0 });

    const expiry = keyData.started_at + (keyData.duration * 3600 * 1000);
    const remaining = Math.max(0, expiry - Date.now());

    return c.json({ remaining, total: keyData.duration * 3600 * 1000 });
})

app.use('/api/admin/*', adminMiddleware)

app.get('/login', (c) => c.html(loginPage))

app.post('/api/login', async (c) => {
    const { accountId, apiToken, accessKey } = await c.req.json()

    if (!accountId || !apiToken) {
        return c.json({ success: false, error: 'Missing credentials' })
    }

    if (!accessKey) {
         return c.json({ success: false, error: 'Access Key is required' })
    }

    const keyData = await getKey(c.env, accessKey)
    if (!keyData) {
        return c.json({ success: false, error: 'Invalid Access Key' })
    }

    const now = Date.now();

    // Check if new
    if (keyData.status === 'unused') {
        keyData.status = 'active';
        keyData.started_at = now;
        keyData.user_agent = c.req.header('User-Agent');
        keyData.ip = c.req.header('CF-Connecting-IP') || '127.0.0.1';
        await updateKey(c.env, accessKey, keyData);
    }

    // Check expiration
    const expiry = keyData.started_at + (keyData.duration * 3600 * 1000);
    if (now > expiry) {
        return c.json({ success: false, error: 'Access Key Expired' })
    }

    // Verify token
    const isValid = await verifyToken(apiToken)
    if (!isValid) {
        return c.json({ success: false, error: 'Invalid API Token' })
    }

    setCookie(c, 'cf_account_id', accountId, { httpOnly: true, secure: true, path: '/', maxAge: 86400 * 7 })
    setCookie(c, 'cf_api_token', apiToken, { httpOnly: true, secure: true, path: '/', maxAge: 86400 * 7 })
    setCookie(c, 'access_key', accessKey, { httpOnly: true, secure: true, path: '/', maxAge: 86400 * 7 })

    return c.json({ success: true })
})

app.get('/logout', (c) => {
    deleteCookie(c, 'cf_account_id')
    deleteCookie(c, 'cf_api_token')
    deleteCookie(c, 'access_key')
    return c.redirect('/login')
})

app.get('/admin/logout', (c) => {
    deleteCookie(c, 'admin_session')
    return c.redirect('/admin')
})

// --- Admin Routes ---

app.get('/admin', (c) => {
    const session = getCookie(c, 'admin_session')

    if (!session) {
        return c.html(html`
<!DOCTYPE html>
<html lang="en">
${commonHead}
<body class="flex justify-center items-center h-screen">
    <div class="glass-card p-8 w-full max-w-sm space-y-6">
        <h1 class="text-2xl font-bold text-center text-white">Admin Login</h1>
        <form id="adminForm" class="space-y-4">
            <input type="password" id="password" class="input-field w-full p-3 rounded-lg" placeholder="Password" required>
            <button type="submit" class="btn-primary w-full py-3 rounded-lg font-bold text-white">Login</button>
        </form>
    </div>
    <script>
        document.getElementById('adminForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('password').value;
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            if(data.success) window.location.reload();
            else alert('Invalid password');
        });
    </script>
</body>
</html>
        `)
    }

    return c.html(html`
<!DOCTYPE html>
<html lang="en">
${commonHead}
<body class="p-8">
    <div class="max-w-4xl mx-auto space-y-6">
        <header class="flex justify-between items-center glass-card p-4">
            <h1 class="text-2xl font-bold text-pink-500">Admin Dashboard</h1>
            <a href="/admin/logout" class="text-red-400 text-sm">Logout</a>
        </header>

        <!-- Admin Settings -->
        <div class="glass-card p-6">
             <h2 class="text-lg font-bold text-white mb-4">Admin Settings</h2>
             <div class="flex gap-4 items-center">
                 <input type="password" id="new-admin-pass" placeholder="New Password" class="input-field p-2 rounded text-sm">
                 <button onclick="changeAdminPass()" class="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded text-sm">Change Password</button>
             </div>
        </div>

        <!-- Generate Key -->
        <div class="glass-card p-6">
            <h2 class="text-lg font-bold text-white mb-4">Generate Access Key</h2>
            <div class="flex gap-4">
                <select id="duration" class="input-field p-2 rounded">
                    <option value="1">1 Hour</option>
                    <option value="6">6 Hours</option>
                    <option value="12">12 Hours</option>
                    <option value="24">24 Hours</option>
                </select>
                <button onclick="generateKey()" class="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded">Generate</button>
            </div>
            <div id="new-key-display" class="mt-4 hidden p-4 bg-green-500/20 text-green-300 rounded text-center text-xl font-mono"></div>
        </div>

        <!-- Active Keys -->
        <div class="glass-card p-6">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-lg font-bold text-white">Active Keys</h2>
                <button onclick="loadKeys()" class="text-xs bg-white/10 px-2 py-1 rounded">Refresh</button>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left text-gray-400">
                    <thead class="text-xs text-gray-200 uppercase bg-white/5">
                        <tr>
                            <th class="px-4 py-2">Key</th>
                            <th class="px-4 py-2">Duration</th>
                            <th class="px-4 py-2">Status</th>
                            <th class="px-4 py-2">Started</th>
                            <th class="px-4 py-2">IP / UA</th>
                            <th class="px-4 py-2">Remaining</th>
                            <th class="px-4 py-2">Action</th>
                        </tr>
                    </thead>
                    <tbody id="key-table-body"></tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        async function changeAdminPass() {
            const password = document.getElementById('new-admin-pass').value;
            if (!password) return alert('Enter a password');
            if (!confirm('Change admin password?')) return;

            const res = await fetch('/api/admin/password', {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            if (data.success) {
                alert('Password changed');
                document.getElementById('new-admin-pass').value = '';
            } else {
                alert('Error: ' + data.error);
            }
        }

        async function generateKey() {
            const duration = document.getElementById('duration').value;
            const res = await fetch('/api/admin/keys/generate', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ duration: parseInt(duration) })
            });
            const data = await res.json();
            if(data.success) {
                const display = document.getElementById('new-key-display');
                display.textContent = data.key;
                display.classList.remove('hidden');
                loadKeys();
            }
        }

        async function loadKeys() {
            const res = await fetch('/api/admin/keys');
            const data = await res.json();
            const tbody = document.getElementById('key-table-body');
            tbody.innerHTML = '';

            data.keys.forEach(k => {
                let remaining = '-';
                if (k.status === 'active' && k.started_at) {
                    const expiry = k.started_at + (k.duration * 3600 * 1000);
                    const diff = expiry - Date.now();
                    if (diff > 0) {
                        const h = Math.floor(diff / 3600000);
                        const m = Math.floor((diff % 3600000) / 60000);
                        remaining = h + 'h ' + m + 'm';
                    } else {
                        remaining = 'Expired';
                    }
                }

                const tr = document.createElement('tr');
                tr.className = 'border-b border-white/5 hover:bg-white/5';
                tr.innerHTML = \`
                    <td class="px-4 py-3 font-mono text-white">\${k.key}</td>
                    <td class="px-4 py-3">\${k.duration}h</td>
                    <td class="px-4 py-3 \${k.status === 'active' ? 'text-green-400' : 'text-yellow-400'}">\${k.status}</td>
                    <td class="px-4 py-3">\${k.started_at ? new Date(k.started_at).toLocaleTimeString() : '-'}</td>
                    <td class="px-4 py-3 truncate max-w-xs" title="\${k.user_agent}">
                        \${k.ip || '-'}<br>
                        <span class="text-xs text-gray-500">\${(k.user_agent || '').substring(0, 20)}...</span>
                    </td>
                    <td class="px-4 py-3 font-bold">\${remaining}</td>
                    <td class="px-4 py-3">
                        <button onclick="deleteKey('\${k.key}')" class="text-red-400 hover:text-red-300">Delete</button>
                    </td>
                \`;
                tbody.appendChild(tr);
            });
        }

        async function deleteKey(key) {
            if(!confirm('Delete key?')) return;
            await fetch('/api/admin/keys/' + key, { method: 'DELETE' });
            loadKeys();
        }

        loadKeys();
        setInterval(loadKeys, 10000);
    </script>
</body>
</html>
    `)
})

app.post('/api/admin/login', async (c) => {
    const { password } = await c.req.json()
    const currentPass = await getAdminPassword(c.env)
    if (password === currentPass) {
        setCookie(c, 'admin_session', '1', { path: '/', httpOnly: true })
        return c.json({ success: true })
    }
    return c.json({ success: false })
})

app.put('/api/admin/password', async (c) => {
    const { password } = await c.req.json()
    if (!password) return c.json({ success: false, error: 'Password required' })
    await updateAdminPassword(c.env, password)
    return c.json({ success: true })
})

app.post('/api/admin/keys/generate', async (c) => {
    const { duration } = await c.req.json()
    const data = await createKey(c.env, duration)
    return c.json({ success: true, key: data.key })
})

app.get('/api/admin/keys', async (c) => {
    const keys = await getKeys(c.env)
    return c.json({ keys })
})

app.delete('/api/admin/keys/:key', async (c) => {
    const key = c.req.param('key')
    await deleteKey(c.env, key)
    return c.json({ success: true })
})

// Protected Routes (Normal User)
app.use('/*', authMiddleware)

app.get('/', (c) => {
  return c.html(html`
<!DOCTYPE html>
<html lang="en">
${commonHead}
<body class="p-4 md:p-8 flex justify-center items-start">
    <div class="max-w-6xl w-full space-y-6">
        <!-- Header -->
        <header class="flex justify-between items-center glass-card p-4">
            <div class="flex items-center gap-4">
                 <h1 class="text-2xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
                    CF Mini
                </h1>
                <nav class="hidden md:flex space-x-1">
                    <a href="/" class="px-3 py-1 rounded-md bg-white/10 text-white text-sm">Deploy</a>
                    <a href="/workers" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">Workers</a>
                    <a href="/dns" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">DNS</a>
                    <a href="/ai" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">AI Gen</a>
                </nav>
            </div>
            <div class="flex items-center gap-3">
                <span class="text-xs text-gray-500 font-mono">${c.get('accountId')}</span>
                <a href="/logout" class="text-sm text-red-300 hover:text-red-400">Logout</a>
            </div>
        </header>

        <!-- Progress Bar -->
        <div id="progress-container" class="fixed bottom-0 left-0 w-full h-2 bg-gray-800 hidden z-50">
            <div id="progress-bar" class="h-full bg-blue-500 transition-all duration-1000 ease-linear" style="width: 100%;"></div>
        </div>

        <script>
             (async () => {
                 const progressBar = document.getElementById('progress-bar');
                 const progressContainer = document.getElementById('progress-container');

                 let localRemaining = 0;
                 let totalDuration = 0;

                 async function syncSession() {
                     try {
                        const res = await fetch('/api/me');
                        const data = await res.json();

                        // If remaining is 0 or undefined, session is invalid/expired
                        if (!data.remaining || data.remaining <= 0) {
                             window.location.href = '/logout';
                             return;
                        }

                        localRemaining = data.remaining;
                        totalDuration = data.total;
                        progressContainer.classList.remove('hidden');
                        updateBar();

                     } catch(e) {
                         // On network error we might want to retry or ignore,
                         // but if 401/403 it would be caught above usually if api returns status
                     }
                 }

                 function updateBar() {
                     if (totalDuration > 0) {
                         const pct = Math.max(0, (localRemaining / totalDuration) * 100);
                         progressBar.style.width = pct + '%';

                         // Change color based on urgency
                         if (pct < 10) progressBar.classList.replace('bg-blue-500', 'bg-red-500');
                         else if (pct < 30) progressBar.classList.replace('bg-blue-500', 'bg-yellow-500');
                     }
                 }

                 // Initial sync
                 await syncSession();

                 // Poll every 5 seconds to check revocation
                 setInterval(syncSession, 5000);

                 // Local countdown for smooth animation between polls
                 setInterval(() => {
                     if (localRemaining > 0) {
                         localRemaining -= 1000;
                         updateBar();
                     } else if (totalDuration > 0) {
                         // If we hit 0 locally, force a sync (which will likely logout)
                         syncSession();
                     }
                 }, 1000);
             })();
        </script>

        <!-- Main Content -->
        <main id="main-content">
             <!-- Deploy Section (Preserved) -->
            <div class="glass-card p-6 space-y-4">
                <div class="flex justify-between items-center">
                    <h2 class="text-xl font-semibold text-blue-300">Quick Deploy Worker</h2>
                    <div class="flex space-x-2">
                        <button onclick="setMode('code')" id="btn-code" class="px-3 py-1 rounded bg-white/10 text-sm">Code</button>
                        <button onclick="setMode('github')" id="btn-github" class="px-3 py-1 rounded bg-transparent text-gray-400 text-sm">GitHub</button>
                    </div>
                </div>

                <div>
                    <label class="block text-sm text-gray-400 mb-1">Worker Name</label>
                    <input type="text" id="workerName" class="input-field w-full p-3 rounded-lg mb-4" placeholder="my-awesome-worker">
                </div>

                <div id="code-section">
                    <div class="flex justify-between items-end mb-1">
                        <label class="block text-sm text-gray-400">JavaScript Code</label>
                        <button onclick="toggleAiAssist()" class="text-xs text-purple-300 hover:text-white flex items-center gap-1">
                            ✨ AI Assist
                        </button>
                    </div>

                    <div id="ai-assist-panel" class="hidden mb-4 p-3 bg-white/5 rounded-lg border border-white/10 space-y-3">
                        <textarea id="aiEditPrompt" class="input-field w-full p-2 rounded text-sm h-20" placeholder="Describe how to change the code (e.g., 'Add basic auth')"></textarea>
                        <div class="flex gap-2">
                             <select id="aiEditModel" class="input-field p-2 rounded text-xs bg-black/50 flex-1">
                                <option value="gemini-3-pro-preview">Gemini 3.0 Pro (Preview)</option>
                                <option value="gemini-3-flash-preview">Gemini 3.0 Flash (Preview)</option>
                                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Exp)</option>
                                <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                            </select>
                            <button onclick="applyAiEdit()" id="btn-ai-edit" class="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded text-xs font-bold">Generate & Apply</button>
                        </div>
                    </div>

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
                </div>

                <button onclick="deploy()" id="deployBtn" class="btn-primary w-full py-3 rounded-lg font-bold text-white shadow-lg flex justify-center items-center gap-2">
                    Deploy
                </button>

                <div id="status-log" class="mt-4 text-sm font-mono text-gray-400 space-y-2 max-h-32 overflow-y-auto"></div>
            </div>
        </main>
    </div>

    <script>
        let mode = 'code';

        window.addEventListener('load', () => {
            const name = localStorage.getItem('edit_worker_name');
            const code = localStorage.getItem('edit_worker_code');
            if (name) {
                document.getElementById('workerName').value = name;
                if (code) {
                    document.getElementById('workerCode').value = code;
                }
                localStorage.removeItem('edit_worker_name');
                localStorage.removeItem('edit_worker_code');
                log('Loaded worker: ' + name);
            }
        });

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

        function toggleAiAssist() {
            document.getElementById('ai-assist-panel').classList.toggle('hidden');
        }

        async function applyAiEdit() {
            const apiKey = localStorage.getItem('gemini_key');
            if (!apiKey) {
                alert('Gemini API Key missing. Please go to "AI Gen" tab to save it.');
                return;
            }

            const prompt = document.getElementById('aiEditPrompt').value;
            const currentCode = document.getElementById('workerCode').value;
            const model = document.getElementById('aiEditModel').value;

            if (!prompt) { alert('Please enter instructions.'); return; }

            const btn = document.getElementById('btn-ai-edit');
            const originalText = btn.textContent;
            btn.textContent = 'Generating...';
            btn.disabled = true;

            const fullPrompt = 'Current Code:\\n' + currentCode + '\\n\\nInstructions:\\n' + prompt + '\\n\\nPlease provide the updated full code.';

            try {
                const res = await fetch('/api/ai/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: fullPrompt, apiKey, model })
                });
                const data = await res.json();

                if (data.success) {
                    document.getElementById('workerCode').value = data.code;
                    log('AI updated the code successfully.', 'success');
                    document.getElementById('aiEditPrompt').value = ''; // clear prompt
                    toggleAiAssist(); // close panel
                } else {
                    alert('Error: ' + data.error);
                }
            } catch (e) {
                alert('System Error: ' + e.message);
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }

        async function deploy() {
            const workerName = document.getElementById('workerName').value;

            if (!workerName) {
                log('Missing worker name', 'error');
                return;
            }

            const btn = document.getElementById('deployBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<div class="loader"></div> Processing...';
            btn.disabled = true;

            try {
                let payload = { workerName, mode };

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

                if (res.status === 401) {
                    window.location.href = '/login';
                    return;
                }

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
    </script>
</body>
</html>
  `)
})

app.get('/workers', (c) => {
    return c.html(html`
<!DOCTYPE html>
<html lang="en">
${commonHead}
<body class="p-4 md:p-8 flex justify-center items-start">
    <div class="max-w-6xl w-full space-y-6">
        <header class="flex justify-between items-center glass-card p-4">
             <h1 class="text-2xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
                CF Mini
            </h1>
            <nav class="hidden md:flex space-x-1">
                <a href="/" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">Deploy</a>
                <a href="/workers" class="px-3 py-1 rounded-md bg-white/10 text-white text-sm">Workers</a>
                <a href="/dns" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">DNS</a>
                <a href="/ai" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">AI Gen</a>
            </nav>
            <div class="flex items-center gap-3">
                <span class="text-xs text-gray-500 font-mono">${c.get('accountId')}</span>
                <a href="/logout" class="text-sm text-red-300 hover:text-red-400">Logout</a>
            </div>
        </header>

        <div class="glass-card p-6">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold text-purple-300">Workers List</h2>
                <button onclick="loadWorkers()" class="text-xs bg-white/10 px-2 py-1 rounded hover:bg-white/20">Refresh</button>
            </div>
            <div id="worker-list" class="space-y-2">
                <div class="loader mx-auto"></div>
            </div>
        </div>
    </div>
    <script>
        let currentWorkerId = null;

        async function loadWorkers() {
            const list = document.getElementById('worker-list');
            list.innerHTML = '<div class="loader mx-auto"></div>';

            try {
                const res = await fetch('/api/workers');
                if (res.status === 401) { window.location.href = '/login'; return; }
                const data = await res.json();

                if (data.success) {
                    if (data.result.length === 0) {
                         list.innerHTML = '<p class="text-gray-500 text-center">No workers found.</p>';
                         return;
                    }
                    list.innerHTML = data.result.map(w => \`
                        <div class="flex justify-between items-center bg-black/20 p-3 rounded-lg border border-white/5">
                            <div>
                                <h3 class="font-semibold text-white">\${w.id}</h3>
                                <p class="text-xs text-gray-400">\${w.modified_on}</p>
                            </div>
                            <div class="flex gap-2">
                                <button onclick="manageDomains('\${w.id}')" class="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded hover:bg-green-500/30">Domains</button>
                                <button onclick="editWorker('\${w.id}')" class="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded hover:bg-blue-500/30">Edit</button>
                                <button onclick="deleteWorker('\${w.id}')" class="text-xs bg-red-500/20 text-red-300 px-2 py-1 rounded hover:bg-red-500/30">Delete</button>
                            </div>
                        </div>
                    \`).join('');
                } else {
                    list.innerHTML = '<p class="text-red-400">Failed to load workers.</p>';
                }
            } catch (e) {
                 list.innerHTML = '<p class="text-red-400">Error loading workers.</p>';
            }
        }

        async function editWorker(id) {
            try {
                const res = await fetch('/api/workers/' + id + '/content');
                if (!res.ok) throw new Error('Failed to fetch code');
                const code = await res.text();

                localStorage.setItem('edit_worker_name', id);
                localStorage.setItem('edit_worker_code', code);
                window.location.href = '/';
            } catch(e) {
                alert('Error: ' + e.message);
            }
        }

        async function deleteWorker(id) {
            if(!confirm('Delete worker ' + id + '?')) return;
            try {
                const res = await fetch('/api/workers/' + id, { method: 'DELETE' });
                const data = await res.json();
                if(data.success) {
                    loadWorkers();
                } else {
                    alert('Failed: ' + data.error);
                }
            } catch(e) {
                alert('Error: ' + e.message);
            }
        }

        async function manageDomains(workerId) {
            currentWorkerId = workerId;
            document.getElementById('domain-modal').classList.remove('hidden');
            document.querySelector('#domain-modal h3').textContent = 'Domains for ' + workerId;
            loadWorkerDomains();
        }

        function closeDomainModal() {
             document.getElementById('domain-modal').classList.add('hidden');
        }

        async function loadWorkerDomains() {
            const list = document.getElementById('domain-list');
            list.innerHTML = '<div class="loader mx-auto"></div>';
            try {
                const res = await fetch('/api/workers/' + currentWorkerId + '/domains');
                const data = await res.json();
                if (data.success) {
                     if (data.result.length === 0) {
                        list.innerHTML = '<p class="text-gray-500 text-center text-sm">No custom domains.</p>';
                        return;
                    }
                    list.innerHTML = data.result.map(d => \`
                        <div class="flex justify-between items-center bg-black/20 p-2 rounded border border-white/5 mb-2">
                            <span class="text-sm text-white">\${d.hostname}</span>
                            <button onclick="deleteWorkerDomain('\${d.id}')" class="text-xs text-red-300 hover:text-white">Del</button>
                        </div>
                    \`).join('');
                } else {
                    list.innerHTML = '<p class="text-red-400">Failed.</p>';
                }
            } catch(e) {
                list.innerHTML = '<p class="text-red-400">Error.</p>';
            }
        }

        async function addWorkerDomain() {
            const hostname = document.getElementById('new-domain').value;
            if(!hostname) return;

            const btn = document.getElementById('add-domain-btn');
            btn.textContent = '...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/workers/' + currentWorkerId + '/domains', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ hostname })
                });
                const data = await res.json();
                if(data.success) {
                    document.getElementById('new-domain').value = '';
                    loadWorkerDomains();
                } else {
                    alert('Failed: ' + (data.errors?.[0]?.message || 'Unknown'));
                }
            } catch(e) {
                alert('Error: ' + e.message);
            } finally {
                btn.textContent = 'Add';
                btn.disabled = false;
            }
        }

        async function deleteWorkerDomain(domainId) {
            if(!confirm('Detach domain?')) return;
             try {
                const res = await fetch('/api/workers/domains/' + domainId, { method: 'DELETE' });
                const data = await res.json();
                if(data.success) {
                    loadWorkerDomains();
                } else {
                    alert('Failed: ' + (data.errors?.[0]?.message || 'Unknown'));
                }
            } catch(e) {
                alert('Error: ' + e.message);
            }
        }

        loadWorkers();
    </script>

    <!-- Domain Modal -->
    <div id="domain-modal" class="fixed inset-0 bg-black/80 hidden flex justify-center items-center p-4 z-50">
        <div class="glass-card p-6 w-full max-w-md space-y-4 bg-[#1a202c]">
            <h3 class="text-lg font-bold text-white">Manage Domains</h3>

            <div class="flex gap-2">
                <input id="new-domain" placeholder="sub.example.com" class="input-field w-full p-2 rounded text-sm">
                <button id="add-domain-btn" onclick="addWorkerDomain()" class="px-4 py-2 bg-green-600 rounded text-white text-sm">Add</button>
            </div>

            <div id="domain-list" class="max-h-60 overflow-y-auto space-y-2">
                <!-- Domains -->
            </div>

            <div class="flex justify-end pt-2">
                <button onclick="closeDomainModal()" class="px-4 py-2 text-gray-300 hover:text-white">Close</button>
            </div>
        </div>
    </div>
</body>
</html>
    `)
})

app.get('/dns', (c) => {
    return c.html(html`
<!DOCTYPE html>
<html lang="en">
${commonHead}
<body class="p-4 md:p-8 flex justify-center items-start">
    <div class="max-w-6xl w-full space-y-6">
        <header class="flex justify-between items-center glass-card p-4">
             <h1 class="text-2xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
                CF Mini
            </h1>
            <nav class="hidden md:flex space-x-1">
                <a href="/" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">Deploy</a>
                <a href="/workers" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">Workers</a>
                <a href="/dns" class="px-3 py-1 rounded-md bg-white/10 text-white text-sm">DNS</a>
                <a href="/ai" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">AI Gen</a>
            </nav>
            <div class="flex items-center gap-3">
                <span class="text-xs text-gray-500 font-mono">${c.get('accountId')}</span>
                <a href="/logout" class="text-sm text-red-300 hover:text-red-400">Logout</a>
            </div>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- Zone List -->
            <div class="glass-card p-6">
                <h2 class="text-xl font-semibold text-pink-300 mb-4">Zones</h2>
                <div id="zone-list" class="space-y-2">
                    <div class="loader mx-auto"></div>
                </div>
            </div>

            <!-- DNS Records -->
            <div class="glass-card p-6 md:col-span-2">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold text-blue-300">DNS Records</h2>
                    <button id="add-record-btn" onclick="showAddRecordModal()" class="hidden text-xs bg-blue-500/20 text-blue-300 px-3 py-1 rounded hover:bg-blue-500/30">+ Add Record</button>
                </div>
                <div id="dns-list" class="space-y-2 max-h-[500px] overflow-y-auto">
                    <p class="text-gray-500 text-center">Select a zone to view records.</p>
                </div>
            </div>
        </div>

        <!-- Add Record Modal (Simple implementation) -->
        <div id="modal-overlay" class="fixed inset-0 bg-black/80 hidden flex justify-center items-center p-4 z-50">
            <div class="glass-card p-6 w-full max-w-lg space-y-4 bg-[#1a202c]">
                <h3 class="text-lg font-bold text-white">Add DNS Record</h3>
                <div class="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <select id="dns-type" class="input-field p-2 rounded">
                        <option value="A">A</option>
                        <option value="CNAME">CNAME</option>
                        <option value="AAAA">AAAA</option>
                        <option value="TXT">TXT</option>
                    </select>
                    <input id="dns-name" placeholder="Name (@ for root)" class="input-field p-2 rounded col-span-2">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" id="dns-proxied" checked> <label class="text-sm text-gray-300">Proxy</label>
                    </div>
                </div>
                <input id="dns-content" placeholder="Content (e.g. 1.2.3.4)" class="input-field w-full p-2 rounded">

                <div class="flex justify-end gap-2">
                    <button onclick="closeModal()" class="px-4 py-2 text-gray-300 hover:text-white">Cancel</button>
                    <button onclick="createRecord()" class="px-4 py-2 bg-blue-600 rounded text-white">Save</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentZoneId = null;
        let dnsRecords = [];
        let currentRecordId = null;

        async function loadZones() {
            const list = document.getElementById('zone-list');
            list.innerHTML = '<div class="loader mx-auto"></div>';

            try {
                const res = await fetch('/api/zones');
                if (res.status === 401) { window.location.href = '/login'; return; }
                const data = await res.json();

                if (data.success) {
                    if (data.result.length === 0) {
                        list.innerHTML = '<p class="text-gray-500 text-center">No zones found.</p>';
                        return;
                    }
                    list.innerHTML = data.result.map(z => \`
                        <div onclick="loadDns('\${z.id}', '\${z.name}')" class="cursor-pointer bg-white/5 p-3 rounded hover:bg-white/10 transition">
                            <h3 class="font-semibold text-white">\${z.name}</h3>
                            <p class="text-xs text-gray-500">\${z.status}</p>
                        </div>
                    \`).join('');
                } else {
                    list.innerHTML = '<p class="text-red-400">Failed to load zones.</p>';
                }
            } catch (e) {
                 list.innerHTML = '<p class="text-red-400">Error loading zones.</p>';
            }
        }

        async function loadDns(zoneId, zoneName) {
            currentZoneId = zoneId;
            const list = document.getElementById('dns-list');
            document.getElementById('add-record-btn').classList.remove('hidden');
            list.innerHTML = '<div class="loader mx-auto"></div>';

            try {
                const res = await fetch('/api/zones/' + zoneId + '/dns');
                const data = await res.json();

                if (data.success) {
                    dnsRecords = data.result;
                     if (data.result.length === 0) {
                        list.innerHTML = '<p class="text-gray-500 text-center">No records found for ' + zoneName + '.</p>';
                        return;
                    }
                    list.innerHTML = data.result.map(r => \`
                        <div class="flex flex-col md:flex-row justify-between items-start md:items-center bg-black/20 p-3 rounded-lg border border-white/5 gap-2">
                            <div class="flex items-center gap-3">
                                <span class="bg-blue-500/20 text-blue-300 text-xs px-2 py-1 rounded font-bold w-12 text-center">\${r.type}</span>
                                <div>
                                    <p class="text-sm text-white">\${r.name}</p>
                                    <p class="text-xs text-gray-400 truncate max-w-[200px]">\${r.content}</p>
                                </div>
                            </div>
                             <div class="flex items-center gap-2">
                                <span class="\${r.proxied ? 'text-orange-400' : 'text-gray-500'} text-xs">\${r.proxied ? 'Proxied' : 'DNS Only'}</span>
                                <button onclick="editDns('\${r.id}')" class="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded hover:bg-blue-500/30">Edit</button>
                                <button onclick="deleteDns('\${r.id}')" class="text-xs bg-red-500/20 text-red-300 px-2 py-1 rounded hover:bg-red-500/30">Del</button>
                            </div>
                        </div>
                    \`).join('');
                } else {
                    list.innerHTML = '<p class="text-red-400">Failed to load records.</p>';
                }
            } catch (e) {
                 list.innerHTML = '<p class="text-red-400">Error loading records.</p>';
            }
        }

        function showAddRecordModal() {
            if (!currentZoneId) return;
            currentRecordId = null;
            document.getElementById('dns-type').value = 'A';
            document.getElementById('dns-name').value = '';
            document.getElementById('dns-content').value = '';
            document.getElementById('dns-proxied').checked = true;
            document.querySelector('#modal-overlay h3').textContent = 'Add DNS Record';
            document.getElementById('modal-overlay').classList.remove('hidden');
        }

        function editDns(id) {
            const r = dnsRecords.find(x => x.id === id);
            if (!r) return;
            currentRecordId = id;
            document.getElementById('dns-type').value = r.type;
            document.getElementById('dns-name').value = r.name;
            document.getElementById('dns-content').value = r.content;
            document.getElementById('dns-proxied').checked = r.proxied;
            document.querySelector('#modal-overlay h3').textContent = 'Edit DNS Record';
            document.getElementById('modal-overlay').classList.remove('hidden');
        }

        function closeModal() {
            document.getElementById('modal-overlay').classList.add('hidden');
        }

        async function createRecord() {
            const type = document.getElementById('dns-type').value;
            const name = document.getElementById('dns-name').value;
            const content = document.getElementById('dns-content').value;
            const proxied = document.getElementById('dns-proxied').checked;

            if (!name || !content) return alert('Fill all fields');

            try {
                let url = '/api/zones/' + currentZoneId + '/dns';
                let method = 'POST';
                if (currentRecordId) {
                    url += '/' + currentRecordId;
                    method = 'PUT';
                }

                const res = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, name, content, proxied })
                });
                const data = await res.json();
                if (data.success) {
                    closeModal();
                    loadDns(currentZoneId);
                } else {
                    alert('Error: ' + (data.errors?.[0]?.message || 'Unknown'));
                }
            } catch (e) {
                alert('System Error: ' + e.message);
            }
        }

        async function deleteDns(recordId) {
            if (!confirm('Delete record?')) return;
            try {
                const res = await fetch('/api/zones/' + currentZoneId + '/dns/' + recordId, {
                    method: 'DELETE'
                });
                const data = await res.json();
                if (data.success) {
                    loadDns(currentZoneId);
                } else {
                     alert('Error: ' + (data.errors?.[0]?.message || 'Unknown'));
                }
            } catch (e) {
                alert('System Error: ' + e.message);
            }
        }

        loadZones();
    </script>
</body>
</html>
    `)
})

app.get('/ai', (c) => {
    return c.html(html`
<!DOCTYPE html>
<html lang="en">
${commonHead}
<body class="p-4 md:p-8 flex justify-center items-start">
    <div class="max-w-6xl w-full space-y-6">
        <header class="flex justify-between items-center glass-card p-4">
             <h1 class="text-2xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
                CF Mini
            </h1>
            <nav class="hidden md:flex space-x-1">
                <a href="/" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">Deploy</a>
                <a href="/workers" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">Workers</a>
                <a href="/dns" class="px-3 py-1 rounded-md hover:bg-white/5 text-gray-300 text-sm">DNS</a>
                <a href="/ai" class="px-3 py-1 rounded-md bg-white/10 text-white text-sm">AI Gen</a>
            </nav>
            <div class="flex items-center gap-3">
                <span class="text-xs text-gray-500 font-mono">${c.get('accountId')}</span>
                <a href="/logout" class="text-sm text-red-300 hover:text-red-400">Logout</a>
            </div>
        </header>

        <main class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- Settings & Chat -->
            <div class="glass-card p-6 space-y-4 md:col-span-1">
                <h2 class="text-xl font-semibold text-purple-300">AI Assistant</h2>

                <div class="space-y-2">
                    <label class="block text-xs text-gray-400">Gemini API Key</label>
                    <div class="flex gap-2">
                        <input type="password" id="aiKey" class="input-field w-full p-2 rounded text-sm" placeholder="Paste Key Here">
                        <button onclick="saveKey()" id="btn-save-key" class="bg-white/10 px-3 py-1 rounded text-xs hover:bg-white/20">Save</button>
                    </div>
                    <p id="key-status" class="text-xs text-gray-500">Not connected</p>
                </div>

                <div class="space-y-2">
                    <label class="block text-xs text-gray-400">Model</label>
                    <select id="aiModel" class="input-field w-full p-2 rounded text-sm bg-black/50">
                        <option value="gemini-3-pro-preview">Gemini 3.0 Pro (Preview)</option>
                        <option value="gemini-3-flash-preview">Gemini 3.0 Flash (Preview)</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                        <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Exp)</option>
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                        <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                    </select>
                </div>

                <div class="space-y-2 pt-4">
                    <label class="block text-sm text-gray-300">Describe your Worker</label>
                    <textarea id="aiPrompt" class="input-field w-full p-3 rounded-lg text-sm h-32" placeholder="Create a worker that blocks traffic from country code CN..."></textarea>
                    <button onclick="generateCode()" id="btn-generate" class="btn-primary w-full py-2 rounded-lg font-bold text-white shadow-lg text-sm">
                        Generate Code
                    </button>
                </div>
            </div>

            <!-- Output & Deploy -->
            <div class="glass-card p-6 space-y-4 md:col-span-2">
                 <div class="flex justify-between items-center">
                    <h2 class="text-xl font-semibold text-blue-300">Generated Code</h2>
                    <div class="flex gap-2">
                         <input type="text" id="workerName" class="input-field p-1 px-3 rounded text-sm" placeholder="worker-name">
                         <button onclick="deployAiWorker()" id="btn-deploy" class="bg-green-600/80 hover:bg-green-600 text-white px-4 py-1 rounded text-sm font-bold">Deploy</button>
                    </div>
                </div>
                <textarea id="generatedCode" class="input-field w-full p-4 rounded-lg font-mono text-sm h-[500px]" spellcheck="false">// Code will appear here...</textarea>
            </div>
        </main>
    </div>

    <script>
        // Key Management
        window.addEventListener('load', () => {
            const key = localStorage.getItem('gemini_key');
            if (key) {
                document.getElementById('aiKey').value = key;
                updateKeyStatus(true);
            }
        });

        function saveKey() {
            const key = document.getElementById('aiKey').value;
            if (key) {
                localStorage.setItem('gemini_key', key);
                updateKeyStatus(true);
            } else {
                localStorage.removeItem('gemini_key');
                updateKeyStatus(false);
            }
        }

        function updateKeyStatus(connected) {
            const el = document.getElementById('key-status');
            const btn = document.getElementById('btn-save-key');
            if (connected) {
                el.textContent = 'Connected (Stored locally)';
                el.classList.add('text-green-400');
                el.classList.remove('text-gray-500');
                btn.textContent = 'Update';
            } else {
                el.textContent = 'Not connected';
                el.classList.add('text-gray-500');
                el.classList.remove('text-green-400');
                btn.textContent = 'Save';
            }
        }

        async function generateCode() {
            const apiKey = localStorage.getItem('gemini_key');
            if (!apiKey) { alert('Please enter and save your Gemini API Key first.'); return; }

            const prompt = document.getElementById('aiPrompt').value;
            const model = document.getElementById('aiModel').value;
            if (!prompt) { alert('Please describe what you want.'); return; }

            const btn = document.getElementById('btn-generate');
            const originalText = btn.textContent;
            btn.innerHTML = '<div class="loader mx-auto"></div>';
            btn.disabled = true;

            try {
                const res = await fetch('/api/ai/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt, apiKey, model })
                });
                const data = await res.json();

                if (data.success) {
                    document.getElementById('generatedCode').value = data.code;
                } else {
                    alert('Error: ' + data.error);
                }
            } catch (e) {
                alert('System Error: ' + e.message);
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }

        async function deployAiWorker() {
            const workerName = document.getElementById('workerName').value;
            const content = document.getElementById('generatedCode').value;

            if (!workerName) { alert('Please provide a worker name.'); return; }
            if (!content || content.startsWith('// Code')) { alert('No code to deploy.'); return; }

            const btn = document.getElementById('btn-deploy');
            const originalText = btn.textContent;
            btn.textContent = '...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/deploy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workerName, mode: 'code', content })
                });

                if (res.status === 401) { window.location.href = '/login'; return; }
                const data = await res.json();

                if (data.success) {
                    alert('Deployment Successful!');
                } else {
                    alert('Deploy Failed: ' + data.error);
                }
            } catch (e) {
                alert('Error: ' + e.message);
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }
    </script>
</body>
</html>
    `)
})

// --- API Implementation ---

// 0. AI Generate
app.post('/api/ai/generate', async (c) => {
    try {
        const { prompt, apiKey, model } = await c.req.json();
        if (!prompt || !apiKey) return c.json({ success: false, error: 'Missing prompt or API key' });

        const selectedModel = model || 'gemini-1.5-flash';
        const systemPrompt = "You are an expert Cloudflare Worker developer. Write a complete, ready-to-deploy Cloudflare Worker JavaScript code based on the user's request. Return ONLY the code. Do not include markdown formatting (like ```javascript or ```). Do not include explanations. Ensure the code is a valid Cloudflare Worker module using ES modules syntax (export default { ... }).";

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;

        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: systemPrompt + "\\n\\nUser Request: " + prompt }]
                }]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            return c.json({ success: false, error: data.error?.message || 'Gemini API Error' });
        }

        let generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Cleanup if model ignores instructions and adds markdown
        generatedText = generatedText.replace(/^```javascript\\n/, '').replace(/^```\\n/, '').replace(/```$/, '');

        return c.json({ success: true, code: generatedText.trim() });

    } catch (e) {
        return c.json({ success: false, error: e.message });
    }
})

// 1. Deploy (Updated to use Context)
app.post('/api/deploy', async (c) => {
    try {
        const { workerName, mode, content } = await c.req.json();
        const accountId = c.get('accountId');
        const apiToken = c.get('apiToken');

        let finalCode = content;
        if (mode === 'github') {
            const ghRes = await fetch(content);
            if (!ghRes.ok) throw new Error('Failed to fetch from GitHub');
            finalCode = await ghRes.text();
        }

        // Upload to Cloudflare
        // For simplicity using the same logic as before but inline or helper
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`;

        // Detect module
        const isModule = finalCode.includes('export default') || finalCode.includes('import ');
        let body = finalCode;
        let headers = {
            'Authorization': `Bearer ${apiToken}`
        };

        if (isModule) {
            const formData = new FormData();
            formData.append('files', new Blob([finalCode], { type: 'application/javascript+module' }), 'worker.js');
            formData.append('metadata', JSON.stringify({ main_module: 'worker.js' }));
            body = formData;
        } else {
            headers['Content-Type'] = 'application/javascript';
        }

        const response = await fetch(url, {
            method: 'PUT',
            headers: isModule ? { 'Authorization': headers['Authorization'] } : headers,
            body: body
        });

        const result = await response.json();

        if (result.success) {
            return c.json({ success: true });
        } else {
            return c.json({ success: false, error: result.errors?.[0]?.message || JSON.stringify(result) });
        }

    } catch (e) {
        return c.json({ success: false, error: e.message });
    }
});

// 2. Workers List
app.get('/api/workers', async (c) => {
    const accountId = c.get('accountId');
    const apiToken = c.get('apiToken');
    const data = await cfRequest(`/accounts/${accountId}/workers/scripts`, 'GET', apiToken);
    return c.json(data);
})

app.delete('/api/workers/:id', async (c) => {
    const accountId = c.get('accountId');
    const apiToken = c.get('apiToken');
    const id = c.req.param('id');
    const data = await cfRequest(`/accounts/${accountId}/workers/scripts/${id}`, 'DELETE', apiToken);
    return c.json(data);
})

// 3. DNS Zones
app.get('/api/zones', async (c) => {
    const accountId = c.get('accountId');
    const apiToken = c.get('apiToken');
    // Filter zones by account if possible, but standard List Zones often lists all user has access to.
    // If we want specific account zones:
    const data = await cfRequest(`/zones?account.id=${accountId}`, 'GET', apiToken);
    return c.json(data);
})

// 4. DNS Records
app.get('/api/zones/:zoneId/dns', async (c) => {
    const zoneId = c.req.param('zoneId');
    const apiToken = c.get('apiToken');
    const data = await cfRequest(`/zones/${zoneId}/dns_records`, 'GET', apiToken);
    return c.json(data);
})

app.post('/api/zones/:zoneId/dns', async (c) => {
    const zoneId = c.req.param('zoneId');
    const apiToken = c.get('apiToken');
    const body = await c.req.json();
    const data = await cfRequest(`/zones/${zoneId}/dns_records`, 'POST', apiToken, body);
    return c.json(data);
})

app.delete('/api/zones/:zoneId/dns/:recordId', async (c) => {
    const zoneId = c.req.param('zoneId');
    const recordId = c.req.param('recordId');
    const apiToken = c.get('apiToken');
    const data = await cfRequest(`/zones/${zoneId}/dns_records/${recordId}`, 'DELETE', apiToken);
    return c.json(data);
})

app.get('/api/workers/:id/content', async (c) => {
    const accountId = c.get('accountId');
    const apiToken = c.get('apiToken');
    const id = c.req.param('id');
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${id}`, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    const content = await res.text();
    return c.text(content);
})

app.get('/api/workers/:id/domains', async (c) => {
    const accountId = c.get('accountId');
    const apiToken = c.get('apiToken');
    const id = c.req.param('id'); // This is the worker name
    // Fetch all domains and filter by service (worker name)
    // Cloudflare API allows filtering by service
    const data = await cfRequest(`/accounts/${accountId}/workers/domains?service=${id}`, 'GET', apiToken);
    return c.json(data);
})

app.post('/api/workers/:id/domains', async (c) => {
    const accountId = c.get('accountId');
    const apiToken = c.get('apiToken');
    const id = c.req.param('id'); // worker name
    const { hostname } = await c.req.json();

    const body = {
        environment: 'production',
        hostname: hostname,
        service: id,
        zone_id: '' // Optional, can be inferred or passed if needed. Usually just hostname/service is enough for CF to auto-detect zone.
    };

    // If zone_id is required by some strict API versions, we might need to lookup zone for hostname.
    // However, usually 'hostname' + 'service' is sufficient.
    const data = await cfRequest(`/accounts/${accountId}/workers/domains`, 'PUT', apiToken, body);
    return c.json(data);
})

app.delete('/api/workers/domains/:domainId', async (c) => {
    const accountId = c.get('accountId');
    const apiToken = c.get('apiToken');
    const domainId = c.req.param('domainId');
    const data = await cfRequest(`/accounts/${accountId}/workers/domains/${domainId}`, 'DELETE', apiToken);
    return c.json(data);
})

app.put('/api/zones/:zoneId/dns/:recordId', async (c) => {
    const zoneId = c.req.param('zoneId');
    const recordId = c.req.param('recordId');
    const apiToken = c.get('apiToken');
    const body = await c.req.json();
    const data = await cfRequest(`/zones/${zoneId}/dns_records/${recordId}`, 'PUT', apiToken, body);
    return c.json(data);
})

export default app
