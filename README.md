<div align="center">
  <a href="https://github.com/proxycaching/proxycaching">
    <img alt="proxycaching logo" src="https://github.com/user-attachments/assets/fa865705-58aa-4fcf-99ee-cd9928e4a4ea" height="128">
  </a>

  <h1>ProxyCaching</h1>

  <p><strong>Stop waiting for the same API call. Again.</strong></p>

  <p>A local HTTP/HTTPS caching proxy for developers — first request hits the real API,<br>every next identical request is served from local cache instantly.</p>

  <p>
    <a href="https://github.com/proxycaching/proxycaching/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Source%20Available-blue"></a>
    <a href="https://github.com/proxycaching/proxycaching/issues"><img alt="Issues" src="https://img.shields.io/github/issues/proxycaching/proxycaching"></a>
    <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-brightgreen">
    <img alt="TypeScript" src="https://img.shields.io/badge/built%20with-TypeScript-3178c6">
  </p>

  <p>
    <a href="#get-started">Get started</a> ·
    <a href="#examples">Examples</a> ·
    <a href="#configuration">Configuration</a> ·
    <a href="#admin-ui">Admin UI</a> ·
    <a href="https://github.com/proxycaching/proxycaching/issues">Report a bug</a>
  </p>
</div>

---

## Why proxycaching?

Every developer knows the pain:

- **Slow external APIs** making every test run take forever
- **Paid API quotas** burning through during development (OpenAI, Stripe, etc.)
- **Flaky or rate-limited services** breaking your local workflow
- **Same request, hundredth time** — because you restarted the dev server again

proxycaching sits between your app and the internet. First call goes through normally. Every identical call after that? Served from local cache in milliseconds — no network, no cost, no waiting.

---

## Features

- **HTTP & HTTPS caching** — full MITM support for HTTPS traffic
- **Disk-backed cache** — persists between restarts, readable only on your machine
- **Rule engine** — cache only what you want (by domain, path, method, and more)
- **Admin UI** — browser-based panel to inspect cached requests, hit counts, and timestamps
- **Encryption** — optional on-disk encryption for cached responses
- **Zero config to start** — sensible defaults, configure only what you need

---

## Get started

```bash
npm install
npm run build
npm run start
```

That's it. Your caching proxy is running on `:8080` and the admin UI is on `:8081`.

**Test it:**

```bash
# First call — hits the real API
curl --proxy http://localhost:8080 https://api.example.com/data

# Second call — served from cache instantly ⚡
curl --proxy http://localhost:8080 https://api.example.com/data
```

Open the admin UI to see what was cached: [http://localhost:8081](http://localhost:8081)

---

## Examples

Real-world usage examples are in the [`/examples`](./examples) directory:

| Example | Description |
|---|---|
| [`anthropic-ai-sdk`](./examples/anthropic-ai-sdk/) | Cache OpenAI / Anthropic API calls — stop paying for the same prompt twice |
| [`node.js-fetch`](./examples/node.js-fetch-utc/) | Drop-in with native Node.js `fetch` |

---

## Admin UI

The built-in admin panel lets you:

- Browse all cached requests with timestamps and hit counts
- Inspect request/response details
- Manage cache rules in real time
- Export or install the MITM CA certificate

Available at **http://localhost:8081** when `proxy.adminEnabled` is `true`.

---

## Configuration

Configure via `config/config.json`. All settings are optional — defaults work out of the box.

```json
{
  "proxy": {
    "port": 8080,
    "adminPort": 8081,
    "adminEnabled": true,
    "mitmEnabled": false,
    "podcachePath": "config/podcache",
    "encryption": {},
    "logging": {
      "level": "info"
    }
  }
}
```

| Setting | Default | Description |
|---|---|---|
| `proxy.port` | `8080` | Port for the proxy listener |
| `proxy.adminPort` | `8081` | Port for the admin UI |
| `proxy.adminEnabled` | `true` | Enable or disable the admin server |
| `proxy.mitmEnabled` | `false` | Enable HTTPS interception and caching |
| `proxy.podcachePath` | `config/podcache` | Where cached responses are stored |
| `proxy.encryption` | `{}` | Optional on-disk encryption settings |
| `proxy.logging.level` | `info` | Logging verbosity |

---

## HTTPS caching (MITM mode)

By default, HTTPS traffic is proxied as an opaque tunnel and **not cached**. To cache HTTPS:

1. Set `proxy.mitmEnabled: true` in `config/config.json`
2. Start the proxy — it will generate a local CA certificate under `config/mitm/proxy-ca/`
3. Install the CA certificate into your OS trust store (or use the Admin UI → CA Install)
4. Restart your browser or HTTP client

```bash
# Or install via Admin API
curl -X POST http://localhost:8081/ca-install
```

> [!WARNING]
> MITM mode decrypts HTTPS traffic locally. Only use this on your own machine during development.

---

## Admin API

For scripting and automation:

| Endpoint | Description |
|---|---|
| `GET /config` | Current proxy config and rules |
| `GET /rules` | List of cache rules |
| `GET /cache` | All cached entries |
| `GET /cache/:key` | Details for a specific cached entry |
| `GET /status` | Runtime health and diagnostics |
| `GET /ca-info` | CA fingerprint and trust status |
| `POST /ca-install` | Install the CA into the OS trust store |
| `GET /ca-export` | Download the CA certificate |

---

## Development mode

Run directly from TypeScript source (no build step needed):

```bash
npm run dev
```

---

## Troubleshooting

<details>
<summary><strong>CA certificate is missing</strong></summary>

Start the proxy and let it generate the CA files in `config/mitm/proxy-ca/` before attempting to install or export.
</details>

<details>
<summary><strong>Untrusted certificate errors in browser</strong></summary>

Install the CA certificate into your OS trust store via the Admin UI or `POST /ca-install`, then restart your browser.
</details>

<details>
<summary><strong>HTTPS traffic not being cached</strong></summary>

- Confirm `proxy.mitmEnabled` is `true`
- Confirm the CA is installed and trusted by your OS
- Check your cache rules in `config/config.json`
- Inspect proxy logs for cache decision details
</details>

---

## License

**Free for personal and open-source use.**
Commercial use (any for-profit company, even internal tools) requires a paid license.

→ [Read the full license](./LICENSE)
→ Commercial licensing: [proxycaching@interia.pl](mailto:proxycaching@interia.pl)

---

<div align="center">
  <sub>Built by <a href="https://github.com/proxycaching">proxycaching</a> · <a href="https://github.com/proxycaching/proxycaching/issues">Report a bug</a> · <a href="https://github.com/proxycaching/proxycaching/issues">Request a feature</a></sub>
</div>
