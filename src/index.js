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
  const accessKey = getCookie(c, 'access_key')

  if (!accountId || !apiToken || !accessKey) {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Unauthorized' }, 401)
    return c.redirect('/login')
  }

  // Verify Access Key
  const keyData = await getKey(c.env, accessKey)
  if (!keyData || keyData.status !== 'active') {
     if (c.req.path.startsWith('/api/')) return c.json({ error: 'Session Expired' }, 401)
     return c.redirect('/logout')
  }

  const expiry = keyData.started_at + (keyData.duration * 3600 * 1000);
  if (Date.now() > expiry) {
      if (c.req.path.startsWith('/api/')) return c.json({ error: 'Session Expired' }, 401)
      return c.redirect('/logout')
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
    if (apiToken === 'test-token') return true; // Bypass for testing
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
        if (k.name === 'admin:password') continue;
        try {
            const val = await env.MINI_KV.get(k.name, { type: 'json' })
            if (val) keys.push(val)
        } catch(e) {
            // Ignore non-json keys
        }
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

const renderHeader = (accountId, activeTab, extraClasses = '') => html`
    <header class="flex justify-between items-center glass-card p-4 relative z-50 ${extraClasses}">
        <div class="flex items-center gap-4">
             <h1 class="text-2xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
                CF Mini
            </h1>
            <nav class="hidden md:flex space-x-1">
                <a href="/" class="px-3 py-1 rounded-md ${activeTab === 'deploy' ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-gray-300'} text-sm">Deploy</a>
                <a href="/workers" class="px-3 py-1 rounded-md ${activeTab === 'workers' ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-gray-300'} text-sm">Workers</a>
                <a href="/dns" class="px-3 py-1 rounded-md ${activeTab === 'dns' ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-gray-300'} text-sm">DNS</a>
                <a href="/ai" class="px-3 py-1 rounded-md ${activeTab === 'ai' ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-gray-300'} text-sm">AI Gen</a>
            </nav>
        </div>

        <!-- Profile Section -->
        <div class="relative">
            <button onclick="toggleProfile()" class="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 hover:from-blue-400 hover:to-purple-500 shadow-lg transition-transform hover:scale-105 border border-white/20">
                <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
            </button>

            <!-- Dropdown -->
            <div id="profile-dropdown" class="absolute right-0 mt-3 w-72 glass-card border border-white/10 rounded-xl shadow-2xl transform scale-95 opacity-0 pointer-events-none transition-all duration-200 origin-top-right bg-[#1a202c]/95 backdrop-blur-xl">
                <div class="p-6 space-y-4">
                    <div class="text-center">
                        <div class="w-16 h-16 mx-auto rounded-full bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 p-[2px]">
                            <div class="w-full h-full rounded-full bg-black/50 flex items-center justify-center">
                                <span class="text-2xl">👤</span>
                            </div>
                        </div>
                        <h3 id="user-name" class="mt-3 text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-200 to-purple-200">Loading...</h3>
                        <p id="user-email" class="text-xs text-gray-400">...</p>
                    </div>

                    <div class="space-y-2">
                        <label class="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Cloudflare ID</label>
                        <div class="bg-black/30 p-2 rounded border border-white/5 font-mono text-xs text-green-400 break-all select-all">
                            ${accountId}
                        </div>
                    </div>

                    <a href="/logout" class="block w-full text-center py-2 rounded-lg bg-gradient-to-r from-red-500/20 to-pink-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition text-sm font-bold">
                        Sign Out
                    </a>
                </div>
            </div>
        </div>
    </header>
    <script>
        let profileOpen = false;
        async function toggleProfile() {
            const el = document.getElementById('profile-dropdown');
            profileOpen = !profileOpen;

            if (profileOpen) {
                el.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
                el.classList.add('opacity-100', 'scale-100');

                if (document.getElementById('user-name').textContent === 'Loading...') {
                    try {
                        const res = await fetch('/api/user/details');
                        const data = await res.json();
                        if (data.success) {
                            document.getElementById('user-name').textContent = data.name;
                            document.getElementById('user-email').textContent = data.email;
                        } else {
                             document.getElementById('user-name').textContent = 'Cloudflare User';
                        }
                    } catch(e) {}
                }
            } else {
                el.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
                el.classList.remove('opacity-100', 'scale-100');
            }
        }

        window.addEventListener('click', (e) => {
            const dropdown = document.getElementById('profile-dropdown');
            const btn = document.querySelector('button[onclick="toggleProfile()"]');
            if (profileOpen && dropdown && !dropdown.contains(e.target) && !btn.contains(e.target)) {
                toggleProfile();
            }
        });
    </script>
`;

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
            padding-bottom: 80px;
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
                <label class="block text-sm text-gray-400 mb-1">Access Key</label>
                <input type="text" id="accessKey" class="input-field w-full p-3 rounded-lg" placeholder="Enter Access Key from Admin" required>
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

        <div class="mt-6 border-t border-white/10 pt-4">
            <p class="text-center text-xs text-gray-500 mb-3">Need Help?</p>
            <div class="flex justify-center gap-4">
                <a href="https://wa.me/6287733745059" target="_blank" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 transition-all group">
                    <svg class="w-5 h-5 text-green-400 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                    <span class="text-xs font-semibold text-green-300">WhatsApp</span>
                </a>
                <a href="https://t.me/otomotif_digital" target="_blank" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-all group">
                    <svg class="w-5 h-5 text-blue-400 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 11.944 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                    <span class="text-xs font-semibold text-blue-300">Telegram</span>
                </a>
            </div>
        </div>
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

    if (!accountId || !apiToken || !accessKey) {
        return c.json({ success: false, error: 'Missing credentials or Access Key' })
    }

    // Validate Access Key (Mandatory)
    const keyData = await getKey(c.env, accessKey)
    if (!keyData) {
        return c.json({ success: false, error: 'Invalid Access Key' })
    }

    const now = Date.now();
    if (keyData.status === 'unused') {
        keyData.status = 'active';
        keyData.started_at = now;
        keyData.user_agent = c.req.header('User-Agent');
        keyData.ip = c.req.header('CF-Connecting-IP') || '127.0.0.1';
        await updateKey(c.env, accessKey, keyData);
    }

    const expiry = keyData.started_at + (keyData.duration * 3600 * 1000);
    if (now > expiry) {
        return c.json({ success: false, error: 'Access Key Expired' })
    }

    setCookie(c, 'access_key', accessKey, { httpOnly: true, secure: true, path: '/', maxAge: 86400 * 7 })

    const isValid = await verifyToken(apiToken)
    if (!isValid) {
        return c.json({ success: false, error: 'Invalid API Token' })
    }

    setCookie(c, 'cf_account_id', accountId, { httpOnly: true, secure: true, path: '/', maxAge: 86400 * 7 })
    setCookie(c, 'cf_api_token', apiToken, { httpOnly: true, secure: true, path: '/', maxAge: 86400 * 7 })

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
        ${renderHeader(c.get('accountId'), 'deploy')}

        <!-- Progress Bar -->
        <div id="progress-container" class="fixed top-0 left-0 w-full h-1 bg-gray-800 hidden z-50">
            <div id="progress-bar" class="h-full bg-blue-500 transition-all duration-1000 ease-linear" style="width: 100%;"></div>
        </div>

        <!-- Bottom Navigation (Mobile) -->
        <nav class="md:hidden fixed bottom-0 left-0 w-full glass-card border-t border-white/10 rounded-none rounded-t-xl z-40 bg-[#1a202c]/90 backdrop-blur-lg pb-safe">
            <div class="flex justify-around items-center p-2">
                <a href="/" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                    <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    <span class="text-[10px]">Deploy</span>
                </a>
                <a href="/workers" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                    <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                    <span class="text-[10px]">Workers</span>
                </a>
                <a href="/dns" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                    <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                    <span class="text-[10px]">DNS</span>
                </a>
                <a href="/ai" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                    <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
                    <span class="text-[10px]">AI</span>
                </a>
            </div>
        </nav>

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

                        if (data.remaining === null) return;

                        if (data.remaining <= 0) {
                             window.location.href = '/logout';
                             return;
                        }

                        localRemaining = data.remaining;
                        totalDuration = data.total;
                        progressContainer.classList.remove('hidden');
                        updateBar();

                     } catch(e) {}
                 }

                 function updateBar() {
                     if (totalDuration > 0) {
                         const pct = Math.max(0, (localRemaining / totalDuration) * 100);
                         progressBar.style.width = pct + '%';
                         if (pct < 10) progressBar.classList.replace('bg-blue-500', 'bg-red-500');
                         else if (pct < 30) progressBar.classList.replace('bg-blue-500', 'bg-yellow-500');
                     }
                 }

                 await syncSession();
                 setInterval(syncSession, 5000);
                 setInterval(() => {
                     if (localRemaining > 0) {
                         localRemaining -= 1000;
                         updateBar();
                     } else if (totalDuration > 0) {
                         syncSession();
                     }
                 }, 1000);
             })();
        </script>

        <!-- Main Content -->
        <main id="main-content">
             <!-- Deploy Section -->
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
                        <textarea id="aiEditPrompt" class="input-field w-full p-2 rounded text-sm h-20" placeholder="Describe how to change the code (e.g., 'Add basic auth and OPENAI_KEY env var')"></textarea>
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

                    <!-- Environment Variables Section -->
                    <div class="mt-4">
                        <div class="flex justify-between items-center mb-2">
                            <label class="text-sm text-gray-400">Environment Variables</label>
                            <button onclick="addEnvVar()" class="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded hover:bg-green-500/30">+ Add Variable</button>
                        </div>
                        <div class="overflow-hidden rounded-lg border border-white/10">
                            <table class="w-full text-sm">
                                <thead class="bg-white/5">
                                    <tr>
                                        <th class="p-2 text-left text-xs font-medium text-gray-300">Key</th>
                                        <th class="p-2 text-left text-xs font-medium text-gray-300">Value</th>
                                        <th class="p-2 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody id="env-vars-body">
                                </tbody>
                            </table>
                        </div>
                        <p class="text-xs text-gray-500 mt-1 italic">Secrets are not supported yet, only plain text.</p>
                    </div>

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

        // --- Env Vars Logic ---
        function addEnvVar(key = '', value = '') {
            const tbody = document.getElementById('env-vars-body');
            const row = document.createElement('tr');
            row.className = 'border-t border-white/5';
            row.innerHTML = \`
                <td class="p-1"><input value="\${key}" placeholder="KEY" class="w-full bg-transparent p-1 text-white focus:outline-none"></td>
                <td class="p-1"><input value="\${value}" placeholder="VALUE" class="w-full bg-transparent p-1 text-white focus:outline-none"></td>
                <td class="p-1 text-center">
                    <button onclick="this.closest('tr').remove()" class="text-red-400 hover:text-red-300 font-bold">&times;</button>
                </td>
            \`;
            tbody.appendChild(row);
        }

        function getEnvVars() {
            const vars = {};
            const rows = document.querySelectorAll('#env-vars-body tr');
            rows.forEach(row => {
                const inputs = row.querySelectorAll('input');
                const key = inputs[0].value.trim();
                const value = inputs[1].value; // allow empty values
                if (key) vars[key] = value;
            });
            return vars;
        }
        // ----------------------

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

            // Updated Prompt to request JSON
            const fullPrompt = \`
Current Code:
\${currentCode}

Instructions:
\${prompt}

Please provide the updated code and any new environment variables needed.
Return ONLY a valid JSON object with this format (no markdown):
{
  "code": "full updated javascript code",
  "vars": { "KEY": "VALUE" }
}
If no vars are needed, return "vars": {}.
\`;

            try {
                const res = await fetch('/api/ai/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: fullPrompt, apiKey, model })
                });
                const data = await res.json();

                if (data.success) {
                    try {
                        let jsonStr = data.code.trim();
                        // Clean markdown if AI ignored "no markdown"
                        if (jsonStr.startsWith('\`\`\`json')) jsonStr = jsonStr.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '');
                        else if (jsonStr.startsWith('\`\`\`')) jsonStr = jsonStr.replace(/\`\`\`/g, '');

                        const aiData = JSON.parse(jsonStr);

                        document.getElementById('workerCode').value = aiData.code;

                        // Populate Env Vars
                        if (aiData.vars) {
                            for (const [k, v] of Object.entries(aiData.vars)) {
                                addEnvVar(k, v);
                            }
                        }

                        log('AI updated code & vars successfully.', 'success');
                        document.getElementById('aiEditPrompt').value = '';
                        toggleAiAssist();
                    } catch(e) {
                         // Fallback for older format if JSON parse fails
                         log('AI returned unstructured text. Please manually verify.', 'warning');
                         document.getElementById('workerCode').value = data.code;
                    }
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

            const apiKey = localStorage.getItem('gemini_key');
            let attempt = 0;
            const maxAttempts = apiKey && mode === 'code' ? 3 : 1;

            while (attempt < maxAttempts) {
                attempt++;
                try {
                    let payload = { workerName, mode };

                    if (mode === 'code') {
                        payload.content = document.getElementById('workerCode').value;
                        payload.envVars = getEnvVars(); // Send Vars
                    } else {
                        payload.content = document.getElementById('githubUrl').value;
                    }

                    log('Deploying (Attempt ' + attempt + '/' + maxAttempts + ')...');
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
                        break;
                    } else {
                        log('Deploy Failed: ' + (data.error || 'Unknown error'), 'error');

                        if (apiKey && mode === 'code' && attempt < maxAttempts) {
                            log('🤖 AI Auto-Fixing code...', 'warning');
                            const fixedData = await autoFixCode(payload.content, data.error, apiKey);
                            if (fixedData && fixedData.code) {
                                document.getElementById('workerCode').value = fixedData.code;
                                if (fixedData.vars) {
                                    for (const [k, v] of Object.entries(fixedData.vars)) {
                                        addEnvVar(k, v);
                                    }
                                }
                                log('Code patched by AI. Retrying...', 'info');
                                await new Promise(r => setTimeout(r, 1000));
                                continue;
                            } else {
                                log('AI could not fix the code.', 'error');
                                break;
                            }
                        } else {
                            break;
                        }
                    }

                } catch (e) {
                    log('System Error: ' + e.message, 'error');
                    break;
                }
            }

            btn.innerHTML = originalText;
            btn.disabled = false;
        }

        async function autoFixCode(code, errorMsg, apiKey) {
            try {
                const model = document.getElementById('aiEditModel') ? document.getElementById('aiEditModel').value : 'gemini-1.5-flash';
                const prompt = \`
The following Cloudflare Worker code failed to deploy with this error: "\${errorMsg}".

Please fix the code.
Return ONLY a valid JSON object with this format (no markdown):
{
  "code": "full fixed javascript code",
  "vars": { "KEY": "VALUE" }
}
If no new vars are needed, return "vars": {}.

Code:
\${code}
\`;

                const res = await fetch('/api/ai/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt, apiKey, model })
                });
                const data = await res.json();
                if (data.success) {
                    try {
                        let jsonStr = data.code.trim();
                        if (jsonStr.startsWith('\`\`\`json')) jsonStr = jsonStr.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '');
                        else if (jsonStr.startsWith('\`\`\`')) jsonStr = jsonStr.replace(/\`\`\`/g, '');
                        return JSON.parse(jsonStr);
                    } catch(e) {
                        return null;
                    }
                }
                else return null;
            } catch (e) {
                return null;
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
        ${renderHeader(c.get('accountId'), 'workers')}

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

    <!-- Bottom Navigation (Mobile) -->
    <nav class="md:hidden fixed bottom-0 left-0 w-full glass-card border-t border-white/10 rounded-none rounded-t-xl z-40 bg-[#1a202c]/90 backdrop-blur-lg pb-safe">
        <div class="flex justify-around items-center p-2">
            <a href="/" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                <span class="text-[10px]">Deploy</span>
            </a>
            <a href="/workers" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                <span class="text-[10px]">Workers</span>
            </a>
            <a href="/dns" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                <span class="text-[10px]">DNS</span>
            </a>
            <a href="/ai" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
                <span class="text-[10px]">AI</span>
            </a>
        </div>
    </nav>

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
        ${renderHeader(c.get('accountId'), 'dns')}

        <div class="glass-card p-6">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold text-purple-300">DNS Zones</h2>
                <button onclick="loadZones()" class="text-xs bg-white/10 px-2 py-1 rounded hover:bg-white/20">Refresh</button>
            </div>
            <div id="zone-list" class="space-y-2">
                <div class="loader mx-auto"></div>
            </div>
        </div>
    </div>

    <!-- Bottom Navigation (Mobile) -->
    <nav class="md:hidden fixed bottom-0 left-0 w-full glass-card border-t border-white/10 rounded-none rounded-t-xl z-40 bg-[#1a202c]/90 backdrop-blur-lg pb-safe">
        <div class="flex justify-around items-center p-2">
            <a href="/" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                <span class="text-[10px]">Deploy</span>
            </a>
            <a href="/workers" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                <span class="text-[10px]">Workers</span>
            </a>
            <a href="/dns" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                <span class="text-[10px]">DNS</span>
            </a>
            <a href="/ai" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
                <span class="text-[10px]">AI</span>
            </a>
        </div>
    </nav>

    <!-- DNS Records Modal -->
    <div id="dns-modal" class="fixed inset-0 bg-black/90 hidden flex justify-center items-start p-4 z-50 overflow-y-auto">
        <div class="glass-card p-6 w-full max-w-4xl space-y-4 bg-[#1a202c] mt-10">
            <div class="flex justify-between items-center">
                 <h3 id="dns-modal-title" class="text-lg font-bold text-white">Manage DNS</h3>
                 <button onclick="closeDnsModal()" class="text-gray-400 hover:text-white">&times;</button>
            </div>

            <!-- Add Record Form -->
            <div class="bg-white/5 p-4 rounded-lg space-y-3">
                <h4 class="text-sm font-bold text-gray-300">Add Record</h4>
                <div class="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <select id="rec-type" class="input-field p-2 rounded text-sm">
                        <option value="A">A</option>
                        <option value="AAAA">AAAA</option>
                        <option value="CNAME">CNAME</option>
                        <option value="TXT">TXT</option>
                        <option value="MX">MX</option>
                        <option value="NS">NS</option>
                    </select>
                    <input id="rec-name" placeholder="Name (@ for root)" class="input-field p-2 rounded text-sm">
                    <input id="rec-content" placeholder="IPv4 or Content" class="input-field p-2 rounded text-sm md:col-span-2">
                    <div class="flex items-center gap-2">
                        <label class="flex items-center space-x-2 text-sm text-gray-400 cursor-pointer">
                            <input type="checkbox" id="rec-proxied" class="form-checkbox h-4 w-4 text-purple-600 rounded border-gray-600 bg-gray-700">
                            <span>Proxy</span>
                        </label>
                        <button onclick="addRecord()" id="btn-add-rec" class="bg-green-600 hover:bg-green-500 text-white px-3 py-2 rounded text-sm flex-1">Add</button>
                    </div>
                </div>
            </div>

            <!-- Records Table -->
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left text-gray-400">
                    <thead class="text-xs text-gray-200 uppercase bg-white/5">
                        <tr>
                            <th class="px-4 py-2">Type</th>
                            <th class="px-4 py-2">Name</th>
                            <th class="px-4 py-2">Content</th>
                            <th class="px-4 py-2">Proxy</th>
                            <th class="px-4 py-2">TTL</th>
                            <th class="px-4 py-2">Action</th>
                        </tr>
                    </thead>
                    <tbody id="dns-records-body"></tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        let currentZoneId = null;

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
                        <div class="flex justify-between items-center bg-black/20 p-3 rounded-lg border border-white/5 hover:bg-white/5 cursor-pointer" onclick="openDns('\${z.id}', '\${z.name}')">
                            <div>
                                <h3 class="font-bold text-white">\${z.name}</h3>
                                <p class="text-xs text-gray-400">\${z.status}</p>
                            </div>
                            <div class="text-purple-300 text-sm">Manage &rarr;</div>
                        </div>
                    \`).join('');
                } else {
                    list.innerHTML = '<p class="text-red-400">Failed to load zones.</p>';
                }
            } catch (e) {
                 list.innerHTML = '<p class="text-red-400">Error loading zones.</p>';
            }
        }

        async function openDns(zoneId, zoneName) {
            currentZoneId = zoneId;
            document.getElementById('dns-modal').classList.remove('hidden');
            document.getElementById('dns-modal-title').textContent = 'DNS: ' + zoneName;
            loadRecords();
        }

        function closeDnsModal() {
            document.getElementById('dns-modal').classList.add('hidden');
        }

        async function loadRecords() {
            const tbody = document.getElementById('dns-records-body');
            tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4"><div class="loader mx-auto"></div></td></tr>';

            try {
                const res = await fetch('/api/zones/' + currentZoneId + '/dns');
                const data = await res.json();

                if (data.success) {
                    if (data.result.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4">No records found.</td></tr>';
                        return;
                    }
                    tbody.innerHTML = data.result.map(r => \`
                        <tr class="border-b border-white/5 hover:bg-white/5">
                            <td class="px-4 py-2 font-bold \${getTypeColor(r.type)}">\${r.type}</td>
                            <td class="px-4 py-2">\${r.name}</td>
                            <td class="px-4 py-2 max-w-xs truncate" title="\${r.content}">\${r.content}</td>
                            <td class="px-4 py-2">
                                \${r.proxied
                                    ? '<span class="text-orange-400 text-xs">☁️ Proxied</span>'
                                    : '<span class="text-gray-500 text-xs">DNS Only</span>'}
                            </td>
                            <td class="px-4 py-2 text-xs">\${r.ttl === 1 ? 'Auto' : r.ttl}</td>
                            <td class="px-4 py-2">
                                <button onclick="deleteRecord('\${r.id}')" class="text-red-400 hover:text-red-300 text-xs">Delete</button>
                            </td>
                        </tr>
                    \`).join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-red-400 p-4">Failed to load records.</td></tr>';
                }
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-red-400 p-4">Error loading records.</td></tr>';
            }
        }

        function getTypeColor(type) {
            switch(type) {
                case 'A': return 'text-blue-400';
                case 'CNAME': return 'text-orange-400';
                case 'TXT': return 'text-green-400';
                case 'MX': return 'text-pink-400';
                default: return 'text-gray-300';
            }
        }

        async function addRecord() {
            const type = document.getElementById('rec-type').value;
            const name = document.getElementById('rec-name').value;
            const content = document.getElementById('rec-content').value;
            const proxied = document.getElementById('rec-proxied').checked;
            const ttl = 1; // Auto

            if (!name || !content) return alert('Fill all fields');

            const btn = document.getElementById('btn-add-rec');
            btn.textContent = '...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/zones/' + currentZoneId + '/dns', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ type, name, content, proxied, ttl })
                });
                const data = await res.json();

                if (data.success) {
                    document.getElementById('rec-name').value = '';
                    document.getElementById('rec-content').value = '';
                    loadRecords();
                } else {
                    alert('Error: ' + (data.errors?.[0]?.message || 'Unknown'));
                }
            } catch(e) {
                alert('System Error: ' + e.message);
            } finally {
                btn.textContent = 'Add';
                btn.disabled = false;
            }
        }

        async function deleteRecord(recordId) {
            if (!confirm('Delete this record?')) return;
            try {
                 const res = await fetch('/api/zones/' + currentZoneId + '/dns/' + recordId, {
                    method: 'DELETE'
                });
                const data = await res.json();
                if (data.success) loadRecords();
                else alert('Failed: ' + (data.errors?.[0]?.message || 'Unknown'));
            } catch(e) {
                alert('Error: ' + e.message);
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
<body class="flex flex-col h-screen overflow-hidden">
    <!-- Header -->
    ${renderHeader(c.get('accountId'), 'ai', 'mx-4 mt-4 md:mx-8 md:mt-8')}

    <!-- Main Content Area -->
    <main class="flex-1 overflow-hidden relative p-4 md:p-8 flex flex-col">

        <!-- Connection Screen -->
        <div id="connect-screen" class="absolute inset-0 flex justify-center items-center p-4 z-20 backdrop-blur-sm transition-opacity duration-300">
            <div class="glass-card p-8 w-full max-w-md space-y-6 bg-[#1a202c]/90">
                <div class="text-center">
                    <h2 class="text-xl font-bold text-white">Connect to Gemini</h2>
                    <p class="text-gray-400 text-xs mt-1">Enter your API Key to start the AI Terminal</p>
                </div>
                <div>
                    <input type="password" id="apiKey" class="input-field w-full p-3 rounded-lg text-center font-mono text-sm" placeholder="AIzaSy...">
                </div>
                <button onclick="connectAi()" id="btn-connect" class="btn-primary w-full py-3 rounded-lg font-bold text-white shadow-lg flex justify-center items-center gap-2">
                    Connect
                </button>
            </div>
        </div>

        <!-- Chat Interface -->
        <div id="chat-interface" class="flex flex-col h-full glass-card overflow-hidden opacity-0 transition-opacity duration-500 pointer-events-none">
            <!-- Messages Area -->
            <div id="chat-messages" class="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-sm">
                <div class="text-gray-500 text-center text-xs mt-4">
                    -- Connected to Cloudflare Worker Assistant --<br>
                    Type "Create a worker that..." or "Help me with..."
                </div>
            </div>

            <!-- Input Area -->
            <div class="p-4 bg-white/5 border-t border-white/10">
                <div class="flex gap-2">
                    <textarea id="chat-input" rows="1" class="input-field flex-1 p-3 rounded-lg resize-none" placeholder="Command the AI..." onkeydown="handleEnter(event)"></textarea>
                    <button onclick="sendChat()" id="btn-send" class="bg-blue-600 hover:bg-blue-500 text-white px-4 rounded-lg">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9-2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                    </button>
                </div>
            </div>
        </div>

    </main>

    <!-- Bottom Navigation (Mobile) -->
    <nav class="md:hidden fixed bottom-0 left-0 w-full glass-card border-t border-white/10 rounded-none rounded-t-xl z-40 bg-[#1a202c]/90 backdrop-blur-lg pb-safe">
        <div class="flex justify-around items-center p-2">
            <a href="/" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                <span class="text-[10px]">Deploy</span>
            </a>
            <a href="/workers" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                <span class="text-[10px]">Workers</span>
            </a>
            <a href="/dns" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                <span class="text-[10px]">DNS</span>
            </a>
            <a href="/ai" class="flex flex-col items-center p-2 text-gray-400 hover:text-white transition">
                <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
                <span class="text-[10px]">AI</span>
            </a>
        </div>
    </nav>

    <script>
        let apiKey = '';

        window.addEventListener('load', () => {
            const k = localStorage.getItem('gemini_key');
            if (k) {
                document.getElementById('apiKey').value = k;
                // Auto connect if key exists
                // connectAi(); // Optional: User might want to change it.
            }
        });

        async function connectAi() {
            const k = document.getElementById('apiKey').value.trim();
            if (!k) return alert('Enter API Key');

            const btn = document.getElementById('btn-connect');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<div class="loader"></div>';
            btn.disabled = true;

            try {
                // Verify by sending a short hello
                const res = await fetch('/api/ai/generate', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ prompt: 'Reply with "OK"', apiKey: k })
                });
                const data = await res.json();

                if (data.success) {
                    localStorage.setItem('gemini_key', k);
                    apiKey = k;
                    showChat();
                } else {
                    alert('Connection Failed: ' + data.error);
                }
            } catch(e) {
                alert('Error: ' + e.message);
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }

        function showChat() {
            const screen = document.getElementById('connect-screen');
            const chat = document.getElementById('chat-interface');

            screen.classList.add('opacity-0', 'pointer-events-none');
            setTimeout(() => {
                screen.style.display = 'none';
                chat.classList.remove('opacity-0', 'pointer-events-none');
                chat.classList.add('opacity-100');
            }, 300);
        }

        function handleEnter(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChat();
            }
        }

        async function sendChat() {
            const input = document.getElementById('chat-input');
            const msg = input.value.trim();
            if (!msg) return;

            // Append User Message
            appendMessage('user', msg);
            input.value = '';

            // Loading State
            const loadingId = appendMessage('ai', '...');

            const prompt = \`
You are a Cloudflare Worker Assistant.
The user wants to create or modify workers.
If the user asks for code, provide it in a code block like:
\\\`\\\`\\\`javascript
... code ...
\\\`\\\`\\\`
Answer concisely.

User: \${msg}
\`;

            try {
                const res = await fetch('/api/ai/generate', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ prompt, apiKey })
                });
                const data = await res.json();

                removeMessage(loadingId);

                if (data.success) {
                    appendMessage('ai', data.code);
                } else {
                    appendMessage('error', 'Error: ' + data.error);
                }
            } catch(e) {
                removeMessage(loadingId);
                appendMessage('error', 'System Error');
            }
        }

        function appendMessage(role, text) {
            const container = document.getElementById('chat-messages');
            const div = document.createElement('div');
            const id = 'msg-' + Date.now();
            div.id = id;

            if (role === 'user') {
                div.className = 'flex justify-end';
                div.innerHTML = \`
                    <div class="bg-blue-600/20 text-blue-200 p-3 rounded-lg max-w-[80%] whitespace-pre-wrap">\${escapeHtml(text)}</div>
                \`;
            } else if (role === 'ai') {
                div.className = 'flex justify-start';
                let content = parseMarkdown(text);
                div.innerHTML = \`
                    <div class="bg-white/5 text-gray-200 p-3 rounded-lg max-w-[90%] space-y-2">\${content}</div>
                \`;
            } else {
                 div.className = 'flex justify-center';
                 div.innerHTML = \`<div class="text-red-400 text-xs">\${text}</div>\`;
            }

            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
            return id;
        }

        function removeMessage(id) {
            const el = document.getElementById(id);
            if(el) el.remove();
        }

        function escapeHtml(text) {
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
            return text.replace(/[&<>"']/g, function(m) { return map[m]; });
        }

        function parseMarkdown(text) {
            // Simple markdown parser for code blocks
            // Replace \`\`\`lang ... \`\`\` with a text area and button

            // 1. Split by code blocks
            const parts = text.split(/(\`\`\`[\\s\\S]*?\`\`\`)/g);

            return parts.map(part => {
                if (part.startsWith('\`\`\`')) {
                    const content = part.replace(/^\`\`\`[a-z]*\\n?/, '').replace(/\`\`\`$/, '');
                    // Create deployable block
                    const id = 'code-' + Math.random().toString(36).substr(2, 9);
                    // Use a textarea for display to preserve formatting easily, but read-only
                    // Or pre tag
                    return \`
                        <div class="mt-2 bg-black/50 rounded-lg border border-white/10 overflow-hidden">
                            <div class="flex justify-between items-center bg-white/5 px-3 py-1">
                                <span class="text-xs text-gray-400">Code</span>
                                <button onclick="deployThis('\${id}')" class="text-xs bg-purple-600 hover:bg-purple-500 text-white px-2 py-1 rounded">Use This Code</button>
                            </div>
                            <pre id="\${id}" class="p-3 overflow-x-auto text-xs text-green-300 font-mono scrollbar-thin">\${escapeHtml(content)}</pre>
                        </div>
                    \`;
                } else {
                    return \`<p>\${escapeHtml(part)}</p>\`;
                }
            }).join('');
        }

        function deployThis(id) {
            const code = document.getElementById(id).textContent;
            if(!code) return;

            localStorage.setItem('edit_worker_code', code);
            localStorage.setItem('edit_worker_name', 'ai-generated-' + Math.floor(Math.random()*1000));

            if(confirm('Go to Deploy page with this code?')) {
                window.location.href = '/';
            }
        }
    </script>
</body>
</html>
    `)
})


// --- API Implementation ---

// 1. Deploy (Updated to use Context)
app.post('/api/deploy', async (c) => {
    try {
        const { workerName, mode, content, envVars } = await c.req.json();
        const accountId = c.get('accountId');
        const apiToken = c.get('apiToken');

        let finalCode = content;
        if (mode === 'github') {
            let targetUrl = content;

            // Smart GitHub Handling
            if (content.includes('github.com') && !content.includes('raw.githubusercontent.com')) {
                // Try to parse: https://github.com/User/Repo
                const parts = content.split('github.com/')[1].split('/');
                if (parts.length >= 2) {
                    const user = parts[0];
                    const repo = parts[1];
                    const branch = parts[2] === 'tree' ? parts[3] : 'main'; // Handle /tree/branch if present, else default main

                    // Priority List
                    const candidates = [
                         `https://raw.githubusercontent.com/${user}/${repo}/${branch}/worker.js`,
                         `https://raw.githubusercontent.com/${user}/${repo}/${branch}/src/index.js`,
                         `https://raw.githubusercontent.com/${user}/${repo}/${branch}/index.js`,
                         `https://raw.githubusercontent.com/${user}/${repo}/master/worker.js`, // Fallback to master
                         `https://raw.githubusercontent.com/${user}/${repo}/master/src/index.js`,
                         `https://raw.githubusercontent.com/${user}/${repo}/master/index.js`
                    ];

                    let found = false;
                    for (const url of candidates) {
                        try {
                            const probe = await fetch(url);
                            if (probe.ok) {
                                targetUrl = url;
                                found = true;
                                break;
                            }
                        } catch(e) {}
                    }
                    if (!found) throw new Error('Could not find worker.js, src/index.js, or index.js in that repo.');
                }
            }

            const ghRes = await fetch(targetUrl);
            if (!ghRes.ok) throw new Error('Failed to fetch from GitHub: ' + ghRes.statusText);
            finalCode = await ghRes.text();
        }

        // Upload to Cloudflare
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

            // Construct Metadata
            const metadata = {
                main_module: 'worker.js',
                bindings: []
            };

            // Add Env Vars if present
            if (envVars && Object.keys(envVars).length > 0) {
                for (const [key, value] of Object.entries(envVars)) {
                    metadata.bindings.push({
                        type: 'plain_text',
                        name: key,
                        text: value
                    });
                }
            }

            formData.append('metadata', JSON.stringify(metadata));
            body = formData;
        } else {
            // Note: Cloudflare API for non-module script upload is simpler but doesn't easily support metadata/bindings in the same call
            // unless using the multipart/form-data endpoint too, which we should default to if we want env vars support.
            // For now, let's assume if env vars are used, we force module-like upload structure or warn?
            // Actually, the 'script' upload endpoint supports metadata in multipart too.
            // So we can use the same logic, just change type to 'application/javascript'.

            const formData = new FormData();
            formData.append('files', new Blob([finalCode], { type: 'application/javascript' }), 'worker.js');

            const metadata = {
                body_part: 'worker.js',
                bindings: []
            };

             if (envVars && Object.keys(envVars).length > 0) {
                for (const [key, value] of Object.entries(envVars)) {
                    metadata.bindings.push({
                        type: 'plain_text',
                        name: key,
                        text: value
                    });
                }
            }
            formData.append('metadata', JSON.stringify(metadata));
            body = formData;
            // No content-type header for multipart, fetch sets it with boundary
        }

        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': headers['Authorization'] }, // Let fetch set Content-Type for FormData
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
    const id = c.req.param('id');
    const data = await cfRequest(`/accounts/${accountId}/workers/domains?service=${id}`, 'GET', apiToken);
    return c.json(data);
})

app.post('/api/workers/:id/domains', async (c) => {
    const accountId = c.get('accountId');
    const apiToken = c.get('apiToken');
    const id = c.req.param('id');
    const { hostname } = await c.req.json();

    const body = {
        environment: 'production',
        hostname: hostname,
        service: id,
        zone_id: ''
    };
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

// --- AI Generation Endpoint ---
app.post('/api/ai/generate', async (c) => {
    try {
        const { prompt, apiKey, model } = await c.req.json();

        if (!apiKey) return c.json({ success: false, error: 'API Key required' });

        const selectedModel = model || 'gemini-1.5-flash';

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{
                parts: [{ text: prompt }]
            }]
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) {
             return c.json({ success: false, error: data.error?.message || 'AI Error' });
        }

        let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Return raw text, filtering handled by client or here if needed.
        // The client expects JSON for code+vars, so we leave it raw here for client to parse if it's the JSON mode,
        // OR we can try to parse it here if we want to be strict.
        // For flexibility, let's send it back as 'code' field and let client handle the structure since
        // the client knows if it asked for JSON or not (though shared endpoint implies common structure).

        return c.json({ success: true, code: rawText });

    } catch(e) {
        return c.json({ success: false, error: e.message });
    }
})

export default app
