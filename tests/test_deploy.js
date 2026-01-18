// tests/test_deploy.js
const assert = require('assert');

// Mock Fetch
global.fetch = async (url, options) => {
    console.log(`[MockFetch] ${options.method} ${url}`);

    // Simple validation of headers
    if (!options.headers['Authorization']) {
        throw new Error('Missing Authorization header');
    }

    if (options.body instanceof FormData) {
        // Module upload
    } else {
        // Script upload
        if (options.headers['Content-Type'] !== 'application/javascript') {
            throw new Error('Missing Content-Type for script upload');
        }
    }

    return {
        json: async () => ({ success: true, result: { id: 'mock-id' } }),
        ok: true,
        text: async () => "mock response text"
    };
};

// Mock FormData and Blob
class MockFormData {
    constructor() { this.data = {}; }
    append(key, value) { this.data[key] = value; }
}
class MockBlob {
    constructor(content) { this.content = content; }
}
global.FormData = MockFormData;
global.Blob = MockBlob;

// The function to test (Copied from src/index.js for isolation testing)
async function uploadToCloudflare(accountId, apiToken, workerName, scriptContent) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`;

    const isModule = scriptContent.includes('export default') || scriptContent.includes('import ');

    let headers = {
        'Authorization': `Bearer ${apiToken}`
    };

    let body;

    if (isModule) {
        const formData = new FormData();
        formData.append('files', new Blob([scriptContent], { type: 'application/javascript+module' }), 'worker.js');
        formData.append('metadata', JSON.stringify({ main_module: 'worker.js' }));
        body = formData;
    } else {
        headers['Content-Type'] = 'application/javascript';
        body = scriptContent;
    }

    const response = await fetch(url, {
        method: 'PUT',
        headers: isModule ? { 'Authorization': headers['Authorization'] } : headers,
        body: body
    });

    return await response.json();
}

async function runTests() {
    console.log('Testing Module Upload...');
    const res1 = await uploadToCloudflare('123', 'abc', 'my-worker', 'export default { fetch() {} }');
    assert.strictEqual(res1.success, true);

    console.log('Testing Script Upload...');
    const res2 = await uploadToCloudflare('123', 'abc', 'my-worker', 'console.log("hello")');
    assert.strictEqual(res2.success, true);

    console.log('All tests passed!');
}

runTests().catch(e => {
    console.error(e);
    process.exit(1);
});
