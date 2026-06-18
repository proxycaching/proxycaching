const Anthropic = require('@anthropic-ai/sdk');
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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  fetch: async (url, init) => {
    return globalThis.fetch(url, {
      ...init,
      ...({ dispatcher: dispatcher }) // Use the ProxyAgent for all requests made by the Anthropic SDK
    });
  }
});

const sendPrompt = async () => {
    const stream = anthropic.messages.stream({
        model: "claude-opus-4-1-20250805",
        max_tokens: 2048,
        temperature: 0.1,
        messages: [
            {
                "role": "user",
                "content": "Say hello there!",
            }
        ],
    });

    stream.on('text', (text) => {
        process.stdout.write(text);
    });

    stream.on('error', (error) => {
        console.error('Claude streaming error', error);
    });

    await stream.finalMessage();
    process.stdout.write("\n");
}

(async () => {
    // Send a prompt to the Anthropic API and stream the response, with all requests going through the MITM proxy
    // First request to fetch the response (if proxy has never cached it, it will return the response and request will be cached now)
    await sendPrompt();
    //await new Promise(resolve => setTimeout(resolve, 3000)); // Delay to skip some time
    // Second request to fetch the response. SDK should return the same response without making a new request to the API and token usage
    //await sendPrompt();
})();