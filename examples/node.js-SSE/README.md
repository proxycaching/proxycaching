# SSE (Server-Sent Events) Proxy Cache Test

This example demonstrates how the proxy caches and replays Server-Sent Events (SSE) streams with timing simulation.

## Overview

- **Embedded SSE Server**: Sends 5 events every 500ms
- **SSE Client**: Connects via the caching proxy with a custom EventSource polyfill
- **Test Flow**:
  1. First request: SSE stream is captured and cached with precise timestamps
  2. Second request: Cached stream is replayed with original timing (simulated delays between events)

## Setup

Install dependencies:
```bash
npm install
```

## Running the Test

```bash
npm test
```

The test will:
1. Start an embedded SSE server on port 9099
2. Connect to it via the proxy (port 8080)
3. Cache the SSE stream on first request
4. Replay the cached stream on second request with timing simulation
5. Display timing information for each event

## Expected Output

```
=== SSE Proxy Cache Test ===

--- REQUEST 1 ---
✓ SSE connection opened
[0ms] Event: {"id":1,"timestamp":"...","message":"Event #1"}
[500ms] Event: {"id":2,"timestamp":"...","message":"Event #2"}
...

--- REQUEST 2 ---
✓ SSE connection opened
[0ms] Event: {"id":1,"timestamp":"...","message":"Event #1"}
[500ms] Event: {"id":2,"timestamp":"...","message":"Event #2"}
...

✓ Test complete
```

## Requirements

- Node.js 18+
- Running proxy on `http://localhost:8080` with MITM enabled
- CA certificate at `../../config/mitm/proxy-ca/certs/ca.pem`
