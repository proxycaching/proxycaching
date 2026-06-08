const http = require('http');
const { ProxyAgent } = require('undici');
const fs = require('fs');
const path = require('path');

// Read the CA certificate for the proxy
const caCert = fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'mitm', 'proxy-ca', 'certs', 'ca.pem'));

// Create a ProxyAgent that points to the local MITM proxy
const dispatcher = new ProxyAgent({
    uri: 'http://localhost:8080',
    requestTls: {
        ca: caCert
    }
});

// Simple EventSource polyfill using fetch
class EventSourcePolyfill {
    constructor(url, options = {}) {
        this.url = url;
        this.dispatcher = options.dispatcher;
        this.onmessage = null;
        this.onerror = null;
        this.onopen = null;
        this.connect();
    }

    async connect() {
        try {
            const res = await fetch(this.url, { dispatcher: this.dispatcher });
            
            if (res.status !== 200) {
                throw new Error(`HTTP ${res.status}`);
            }

            if (this.onopen) {
                this.onopen();
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.substring(6);
                        if (this.onmessage) {
                            this.onmessage({ data });
                        }
                    }
                }
            }
        } catch (error) {
            if (this.onerror) {
                this.onerror(error);
            }
        }
    }
}

// Start embedded SSE server
const server = http.createServer((req, res) => {
    if (req.url === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        let eventCount = 0;
        const sendEvent = () => {
            eventCount++;
            const timestamp = new Date().toISOString();
            const data = JSON.stringify({
                id: eventCount,
                timestamp,
                message: `Event #${eventCount}`
            });
            res.write(`data: ${data}\n\n`);

            if (eventCount < 5) {
                setTimeout(sendEvent, 500);
            } else {
                res.end();
            }
        };

        sendEvent();
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

const testSSEStream = async (requestNum) => {
    console.log(`\n--- REQUEST ${requestNum} ---`);
    
    const es = new EventSourcePolyfill('http://localhost:9099/events', { dispatcher });
    
    let eventCount = 0;
    const startTime = Date.now();

    return new Promise((resolve) => {
        es.onopen = () => {
            console.log('✓ SSE connection opened');
        };

        es.onmessage = (event) => {
            eventCount++;
            const elapsed = Date.now() - startTime;
            console.log(`[${elapsed}ms] Event: ${event.data}`);
        };

        es.onerror = (error) => {
            console.error('✗ Error:', error.message);
            resolve();
        };

        // Simulate stream end timeout
        setTimeout(() => {
            if (eventCount > 0) resolve();
        }, 5000);
    });
};

(async () => {
    server.listen(9099, async () => {
        console.log('=== SSE Proxy Cache Test ===');
        
        // First request (cached)
        await testSSEStream(1);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Second request (from cache with simulated timing)
        await testSSEStream(2);
        
        console.log('\n✓ Test complete');
        server.close();
        process.exit(0);
    });
})();
