# x402-next-failover

**Automatic failover middleware for x402 payment facilitators in Next.js with configurable timeout support.**

Never lose a payment due to facilitator downtime! `x402-next-failover` automatically tries multiple payment facilitators in priority order, with configurable timeouts for fast failover. Works seamlessly in Next.js Edge Runtime.

## Features

- ✅ **Automatic Failover** - Seamlessly switches between facilitators on failure
- ✅ **Configurable Timeouts** - Set per-facilitator timeout limits (default: 5s)
- ✅ **Priority-based Routing** - Control which facilitators to try first
- ✅ **Edge Runtime Compatible** - Works in Next.js middleware
- ✅ **Multiple Facilitator Types** - Supports URL-based and Coinbase CDP facilitators
- ✅ **Detailed Logging** - Track failover events in your logs
- ✅ **TypeScript Support** - Fully typed for better DX

## Installation

```bash
npm install x402-next-failover x402-next @coinbase/x402
```

or with yarn:

```bash
yarn add x402-next-failover x402-next @coinbase/x402
```

or with pnpm:

```bash
pnpm add x402-next-failover x402-next @coinbase/x402
```

## Quick Start

### 1. Create Facilitator Configuration

Create a `facilitators.config.ts` file:

```typescript
import type { FacilitatorConfig } from "x402-next-failover";

export const facilitators: FacilitatorConfig[] = [
  // Primary: X402 RS
  {
    id: "x402-rs",
    name: "X402 RS",
    url: "https://facilitator.x402.rs",
    priority: 1,
    timeoutMs: 5000,
  },

  // Secondary: PayAI Network
  {
    id: "payai-network",
    name: "PayAI Network",
    url: "https://facilitator.payai.network",
    priority: 2,
    timeoutMs: 5000,
  },

  // Tertiary: Coinbase CDP (requires API keys in .env)
  {
    id: "coinbase-cdp",
    name: "Coinbase CDP",
    type: "coinbase-cdp",
    apiKeyId: process.env.CDP_API_KEY_ID,
    apiKeySecret: process.env.CDP_API_KEY_SECRET,
    priority: 3,
    timeoutMs: 10000,
  },
];
```

### 2. Set Up Middleware

Create or update your `middleware.ts`:

```typescript
import { createPaymentMiddlewareWithFailover } from "x402-next-failover";
import { facilitators } from "./facilitators.config";

const WALLET_ADDRESS = process.env.NEXT_PUBLIC_WALLET_ADDRESS as `0x${string}`;
const NETWORK = process.env.NEXT_PUBLIC_NETWORK || "base";

export const middleware = createPaymentMiddlewareWithFailover(
  WALLET_ADDRESS,
  {
    // Your protected API routes
    "/api/weather": {
      price: "$0.01",
      network: NETWORK as "base" | "base-sepolia",
      config: {
        description: "Get current weather data",
        mimeType: "application/json",
        maxTimeoutSeconds: 60,
      },
    },
    "/api/premium-data": {
      price: "$0.10",
      network: NETWORK as "base" | "base-sepolia",
      config: {
        description: "Access premium data",
        mimeType: "application/json",
        maxTimeoutSeconds: 60,
      },
    },
  },
  facilitators // Automatic failover enabled!
);

export const config = {
  matcher: ["/api/weather", "/api/premium-data"],
};
```

### 3. Configure Environment Variables

Add to your `.env` file:

```bash
# Your wallet address to receive payments
NEXT_PUBLIC_WALLET_ADDRESS=0xYourWalletAddress

# Network (base or base-sepolia)
NEXT_PUBLIC_NETWORK=base

# Optional: Coinbase CDP credentials (only if using Coinbase CDP facilitator)
CDP_API_KEY_ID=your-cdp-api-key-id
CDP_API_KEY_SECRET=your-cdp-api-key-secret
```

That's it! Your middleware will now automatically failover between facilitators.

## How It Works

When a payment request comes in:

1. **Try Primary Facilitator** - Attempts the highest priority facilitator first
2. **Timeout Protection** - If response takes longer than configured timeout, fails over
3. **Error Detection** - If facilitator returns 5xx error, fails over
4. **Next Facilitator** - Automatically tries the next facilitator in priority order
5. **Success or Final Failure** - Returns successful response or 503 if all fail

### Example Flow

```
User Request → Middleware
                 ↓
             Try Facilitator 1 (x402.rs) [timeout: 5s]
                 ↓ Timeout!
             Try Facilitator 2 (PayAI) [timeout: 5s]
                 ↓ Success!
             Return Response ✓
```

## Configuration

### Facilitator Configuration Options

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier for the facilitator |
| `name` | `string` | Yes | Display name for logs |
| `priority` | `number` | Yes | Priority order (lower = higher priority) |
| `timeoutMs` | `number` | No | Timeout in milliseconds (default: 5000) |
| `url` | `string` | Yes* | Facilitator URL (required for URL-based facilitators) |
| `type` | `"url" \| "coinbase-cdp"` | No | Facilitator type (default: "url") |
| `apiKeyId` | `string` | Yes** | CDP API Key ID (required for Coinbase CDP) |
| `apiKeySecret` | `string` | Yes** | CDP API Key Secret (required for Coinbase CDP) |

\* Required for URL-based facilitators
\*\* Required for Coinbase CDP facilitators

### URL-Based Facilitator Example

```typescript
{
  id: "my-facilitator",
  name: "My Facilitator",
  url: "https://facilitator.example.com",
  priority: 1,
  timeoutMs: 3000, // 3 second timeout
}
```

### Coinbase CDP Facilitator Example

```typescript
{
  id: "coinbase-cdp",
  name: "Coinbase CDP",
  type: "coinbase-cdp",
  apiKeyId: process.env.CDP_API_KEY_ID,
  apiKeySecret: process.env.CDP_API_KEY_SECRET,
  priority: 2,
  timeoutMs: 10000, // 10 second timeout
}
```

## Logging

The package provides detailed logging for monitoring:

### Startup Log

```
[x402-next-failover] Initialized with 3 facilitators: X402 RS (priority 1), PayAI Network (priority 2), Coinbase CDP (priority 3)
```

### Success Log

```
[x402-next-failover] Trying facilitator: X402 RS (timeout: 5000ms)
[x402-next-failover] ✓ Success with X402 RS (234ms)
```

### Failover Log

```
[x402-next-failover] Trying facilitator: X402 RS (timeout: 5000ms)
[x402-next-failover] ✗ X402 RS failed: Timeout after 5000ms
[x402-next-failover] Attempting next facilitator (2 remaining)...
[x402-next-failover] Trying facilitator: PayAI Network (timeout: 5000ms)
[x402-next-failover] ✓ Success with PayAI Network (456ms) after 1 failover(s)
```

### All Failed Log

```
[x402-next-failover] All facilitators failed after 15234ms
```

## Best Practices

### 1. Priority Configuration

Order facilitators by reliability and speed:

```typescript
{
  priority: 1, // Fastest, most reliable
  timeoutMs: 3000,
}
```

```typescript
{
  priority: 2, // Backup option
  timeoutMs: 5000,
}
```

```typescript
{
  priority: 3, // Last resort
  timeoutMs: 10000,
}
```

### 2. Timeout Configuration

**Development**: Longer timeouts to reduce false positives
```typescript
timeoutMs: 10000 // 10 seconds
```

**Production**: Shorter timeouts for fast failover
```typescript
timeoutMs: 3000 // 3 seconds
```

### 3. Minimum Facilitators

Always configure at least 2 facilitators for redundancy:

```typescript
export const facilitators = [
  { id: "primary", /* ... */ priority: 1 },
  { id: "backup", /* ... */ priority: 2 },
];
```

### 4. Monitoring

Watch logs in production to identify unreliable facilitators:

```bash
# Check for frequent failovers
grep "failover" logs.txt

# Identify slow facilitators
grep "Timeout after" logs.txt
```

## Advanced Usage

### Dynamic Configuration

Load facilitators from a database or API:

```typescript
async function getFacilitators(): Promise<FacilitatorConfig[]> {
  const response = await fetch("/api/facilitators");
  return response.json();
}

export const middleware = createPaymentMiddlewareWithFailover(
  WALLET_ADDRESS,
  routes,
  await getFacilitators()
);
```

### Conditional Facilitators

Enable/disable facilitators based on environment:

```typescript
export const facilitators: FacilitatorConfig[] = [
  {
    id: "dev-facilitator",
    name: "Development Facilitator",
    url: "http://localhost:3001/facilitator",
    priority: 1,
  },
  // Only include in production
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          id: "prod-facilitator",
          name: "Production Facilitator",
          url: "https://facilitator.example.com",
          priority: 1,
        },
      ]
    : []),
];
```

## Troubleshooting

### "All facilitators failed"

**Cause**: All configured facilitators timed out or returned errors

**Solution**:
1. Check facilitator URLs are correct
2. Verify network connectivity
3. Increase timeout values for testing
4. Check facilitator service status

### Frequent Timeouts

**Cause**: Timeouts too aggressive or facilitators genuinely slow

**Solution**:
1. Increase `timeoutMs` values
2. Check facilitator performance
3. Consider switching primary facilitator

### Missing Coinbase CDP Credentials

**Cause**: `CDP_API_KEY_ID` or `CDP_API_KEY_SECRET` not set

**Solution**: The facilitator will be automatically skipped. Check logs:
```
[x402-next-failover] Skipping Coinbase CDP: Missing CDP API credentials
```

## TypeScript

Full TypeScript support included:

```typescript
import type {
  FacilitatorConfig,
  FacilitatorError,
  FailoverErrorResponse,
} from "x402-next-failover";
```

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/yourusername/x402-next-failover).

## License

MIT © [Your Name]

## Related

- [x402](https://github.com/x402/x402) - HTTP 402 Payment Required Protocol
- [x402-next](https://www.npmjs.com/package/x402-next) - x402 middleware for Next.js
- [@coinbase/x402](https://www.npmjs.com/package/@coinbase/x402) - Coinbase x402 facilitator

## Support

- [GitHub Issues](https://github.com/yourusername/x402-next-failover/issues)
- [npm Package](https://www.npmjs.com/package/x402-next-failover)

---

Made with ❤️ for the x402 ecosystem
