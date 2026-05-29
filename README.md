# Proxy Caching Server

This project is a Node.js + TypeScript proxy cache server that is still under active development.

Its main purpose is to help development and test workflows by caching HTTP and HTTPS requests so that repeated calls to external APIs or services can be served from a local cache instead of executing the request every time.

That is especially useful during development when tests or local runs repeatedly exercise the same external endpoints.

## Status

- Under development: functionality and configuration may change.
- Designed for development and testing workflows, not as a production-grade proxy.
- The proxy is intended to reduce external API usage and accelerate repeated requests during development.

## Features

- HTTP proxy with cache support for repeated requests
- HTTPS MITM caching when `proxy.mitmEnabled` is `true`
- Disk-backed cache persistence in `config/podcache`
- Cache rule engine for conditional request caching
- Admin API/UI for runtime inspection and CA management
- Proxy-created CA files under `config/mitm/proxy-ca`
- Windows CA installation helper for MITM mode

## Purpose

This project is meant to cache request traffic during development, such as:

- saving external API requests by replaying cached responses
- reducing test run dependency on live services
- preserving a stable local development experience when the remote API is slow or rate-limited
- allowing repeated requests to execute only once and reuse the cached result for later runs

## Usage

1. Install dependencies:

```bash
npm install
```

2. Build the project:

```bash
npm run build
```

3. Start the proxy server:

```bash
npm run start
```

4. Use the proxy on the configured `proxy.port` (default `8080`).

Example HTTP request:

```bash
curl --proxy http://localhost:8080 http://example.com
```

Example HTTPS request via CONNECT:

```bash
curl --proxy http://localhost:8080 https://example.com
```

5. Open the admin UI on the configured `adminPort` (default `8081`):

```text
http://localhost:8081/
```

### Development mode

Run the server directly from source:

```bash
npm run dev
```

## Configuration

The proxy is configured through `config/config.json`.

### Core settings

- `proxy.port` — port for the proxy listener
- `proxy.adminPort` — port for the admin API/UI
- `proxy.podcachePath` — path for cache storage
- `proxy.adminEnabled` — enable or disable the admin server
- `proxy.mitmEnabled` — enable or disable MITM HTTPS interception and caching
- `proxy.encryption` — optional disk encryption settings
- `proxy.logging.level` — logging verbosity

## MITM HTTPS caching

When `proxy.mitmEnabled` is enabled, the proxy intercepts HTTPS traffic using a local MITM CA.

The project now relies on the proxy runtime to create the CA files in `config/mitm/proxy-ca`, and the scripts do not generate new CA materials on their own.

### How it works

- the MITM proxy starts with `sslCaDir` set to `config/mitm/proxy-ca`
- the proxy library creates the CA and host certificates as needed
- the local CA certificate is then used to intercept and cache HTTPS requests
- cache rules are applied to HTTPS traffic the same way as HTTP traffic

### CA installation

To trust HTTPS interception, the CA certificate created by the proxy must be installed.
Certificates are stored in `config/mitm/proxy-ca/certs`

## Admin API

The admin server exposes the following endpoints:

- `GET /config` — current proxy config and rules
- `GET /rules` — list of cache rules
- `GET /cache` — list of cached entries
- `GET /cache/:key` — cached entry details
- `GET /status` — runtime health and diagnostics
- `GET /ca-info` — CA fingerprint, trust status, and platform info
- `POST /ca-install` — attempt to install the existing CA into the trusted store
- `GET /ca-export` — download the current CA certificate

## Notes

- With MITM disabled, HTTPS `CONNECT` traffic is proxied as an opaque tunnel and is not cached.
- With MITM enabled, HTTPS traffic is decrypted, cached if rules allow it, and re-encrypted for the client.
- The CA certificate is created by the proxy runtime under `config/mitm/proxy-ca`.
- Manual or automatic installation only installs the proxy-created CA certificate; scripts do not generate alternate CA keys/certs.

## Troubleshooting

### CA is missing

If the CA is missing, start the proxy and let it create the CA files in `config/mitm/proxy-ca` before attempting installation or export.

### Untrusted certificate errors

Install the CA certificate into your operating system trust store, then restart the browser or client.

### HTTPS traffic not cached

- Verify `proxy.mitmEnabled` is `true`
- Confirm the CA is installed and trusted
- Check cache rules in `config/config.json`
- Inspect proxy logs for cache decision details

## Development note

This project is not yet production-ready. Use it as a development-time cache proxy for testing and local API call reduction.

## Run locally

```bash
npm install
npm run build
npm run start
```
