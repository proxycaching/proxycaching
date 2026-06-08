# Anthropic AI SDK example

### 1. How it works?
This example demonstrates a proxy connection to a client from the anthropic package. Calling the same prompt on the same model will result in only the first execution reaching the actual Claude servers; each subsequent call will result in a cached result.

### 2. What are the benefits?
When repeatedly testing AI-based software, instead of paying for token consumption with each test, using ProxyCaching ensures that tokens are only consumed the first time, resulting in significant savings. Each subsequent execution will return the exact same response as the previous one, making testing seamless and saving time and money.

### 3. Correct Configuration
To ensure that ProxyCaching correctly caches traffic for Claude, `config.json` should contains such rule:
```JSON
"rules": [
    {
        "name": "anthropic-api-url-grouping",
        "match": {
            "method": ["POST"],
            "domains": ["api.anthropic.com"],
            "paths": ["/v1/messages"]
        },
        "cache": true,
        "groupBy": "url-only"
    }
]
```

> [!NOTE] 
> Default proxy server config already contains this rule.