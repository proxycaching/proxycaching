# UTC Time API Proxy Cache Test

This example demonstrates basic HTTP response caching through the proxy. It fetches the current UTC time twice and verifies that the cached response is served on the second request.

## Overview

- **API Endpoint**: `https://timeapi.io/api/v1/time/current/utc`
- **Test Flow**:
  1. First request: Fetches current UTC time and caches the response
  2. Wait 3 seconds
  3. Second request: Should return the same cached time (proving cache hit)

## Setup

Install dependencies:
```bash
npm install
```

## Running the Test

```bash
npm test
```

The test will make two requests to the UTC API through the proxy with a 3-second delay between them.

## Expected Output

```json
{ utc_time: '2026-05-28T19:35:07.8625302Z' }
{ utc_time: '2026-05-28T19:35:07.8625302Z' }
```

Both responses should be identical, confirming the cache is working.

## Requirements

- Node.js 18+
- Running proxy on `http://localhost:8080` with caching enabled
- CA certificate at `../../config/mitm/proxy-ca/certs/ca.pem`
- Active internet connection (to reach timeapi.io)
