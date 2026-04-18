const http = require('http');

const server = http.createServer((req, res) => {
    // 1. Bypass CORS security so your phone's browser doesn't block it
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight checks from the browser
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // 2. Pretend to be WLED!
    if (req.url.includes('/json/state')) {
        console.log(`[SUCCESS!] Command received from phone! Method: ${req.method}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Send back fake WLED data to trick your web app
        res.end(JSON.stringify({ on: true, bri: 255 }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(8080, () => {
    console.log('💡 FAKE ESP32 LAMP IS RUNNING!');
    console.log('Listening for commands on port 8080...');
});