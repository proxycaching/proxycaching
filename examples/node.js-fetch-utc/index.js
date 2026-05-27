process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { ProxyAgent } = require('undici');
const dispatcher = new ProxyAgent('http://localhost:8080',);

(async () => {
    const res = await fetch('https://timeapi.io/api/v1/time/current/utc', { dispatcher });
    const data = await res.json();
    console.log(data);
    
})();