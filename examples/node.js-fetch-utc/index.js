const { ProxyAgent } = require('undici');
const fs = require('fs');
const path = require('path');

// Read the CA certificate for the proxy
const caCert = fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'mitm', 'proxy-ca', 'certs', 'ca.pem'));
// Create a ProxyAgent that points to the local MITM proxy and includes the CA certificate for TLS interception
const dispatcher = new ProxyAgent({
    uri: 'http://localhost:8080',
    requestTls: {
        ca: caCert
    }
});

const sendRequest = async () => {
    const res = await fetch('https://timeapi.io/api/v1/time/current/utc', { dispatcher });
    const data = await res.json();
    console.log(data);
}

(async () => {
    // First request to fetch the current UTC time (if proxy has never cached it, it will return current UTC time and request will be cached now)
    await sendRequest();
    await new Promise(resolve => setTimeout(resolve, 3000)); // Delay to skip some time
    // Second request to fetch the current UTC time (if proxy caching works, it should return the same time as before, not the current one)
    await sendRequest();
})();