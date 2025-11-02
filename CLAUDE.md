# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**x402-next-failover** is a TypeScript library that provides automatic failover middleware for x402 payment facilitators in Next.js applications. It wraps `x402-next`'s `paymentMiddleware` to enable high-availability payment processing by automatically switching between multiple facilitators on timeout or failure.

**Key Value Proposition**: Prevents payment loss due to facilitator downtime by trying multiple payment facilitators in priority order with configurable timeouts.

## Build Commands

```bash
# Build for production (dual output: CJS + ESM)
npm run build

# Development mode with watch
npm run dev

# Test (placeholder - tests not yet implemented)
npm run test
```

**Build Output**:
- `dist/index.js` - CommonJS format
- `dist/index.mjs` - ES Module format
- `dist/index.d.ts` - TypeScript declarations for CJS
- `dist/index.d.mts` - TypeScript declarations for ESM
- Source maps for all outputs

## Architecture

### Core Design Pattern: Responsibility Chain with Timeout

The library implements a **responsibility chain pattern** where each facilitator in priority order attempts to process a payment request. If one fails (timeout, 5xx error, or invalid response), the request automatically passes to the next facilitator.

### Three-File Architecture

1. **`src/types.ts`** - Type definitions
   - `FacilitatorConfig`: User-facing facilitator configuration
   - `FacilitatorError`: Error tracking structure
   - `FailoverErrorResponse`: Final error response format

2. **`src/failover-middleware.ts`** - Core logic (348 lines)
   - `createPaymentMiddlewareWithFailover()`: Main factory function
   - `convertToFacilitatorOption()`: Transforms user config into internal format
   - Handles two facilitator types:
     - **URL-based**: Direct facilitator URL
     - **Coinbase CDP**: Uses API key credentials via `createFacilitatorConfig()`

3. **`src/index.ts`** - Public API exports

### Critical Implementation Details

#### Request Cloning Strategy
**Problem**: Next.js Request bodies can only be read once. In failover scenarios, multiple facilitators need to read the same request.

**Solution**: Clone the request for each facilitator attempt:
```typescript
// In main loop at failover-middleware.ts:151-163
let requestToUse: NextRequest;
try {
  requestToUse = request.clone() as NextRequest;
} catch (cloneError) {
  // Fallback to original if cloning fails (Edge Runtime limitations)
  requestToUse = request;
}
```

#### Timeout Management with Cleanup
**Problem**: Uncleared setTimeout timers cause memory leaks in high-concurrency Edge Runtime.

**Solution**: Store timeout IDs and clear them on both success and error paths:
```typescript
// At failover-middleware.ts:165
let timeoutId: NodeJS.Timeout | null = null;

// Create timeout (173-177)
timeoutId = setTimeout(() => reject(...), timeout);

// Clear on success (186-189)
if (timeoutId) {
  clearTimeout(timeoutId);
  timeoutId = null;
}

// Clear on error (295-298)
if (timeoutId) {
  clearTimeout(timeoutId);
  timeoutId = null;
}
```

#### 402 Response Validation
**Problem**: Facilitators may return malformed 402 responses (missing `error` or `accepts` fields), indicating facilitator malfunction rather than legitimate payment requirement.

**Solution**: Validate 402 response structure before accepting it (failover-middleware.ts:191-244):
1. Check if response body is already consumed
2. Clone response for validation (to preserve original)
3. Parse JSON and validate structure
4. If both `error` and `accepts` are missing/empty → trigger failover
5. On validation failure (clone/parse error) → return original response (conservative approach)

#### Security: Environment-Based Error Exposure
**Critical**: Error details are only exposed in development to prevent information leakage in production (failover-middleware.ts:328-336):
```typescript
const isDevelopment = process.env.NODE_ENV === "development";

return new Response(
  JSON.stringify({
    error: "All payment facilitators are currently unavailable",
    ...(isDevelopment && { details: errors }), // Only in dev
    timestamp: new Date().toISOString(),
  }),
  { status: 503, ... }
);
```

### Initialization Flow

```
createPaymentMiddlewareWithFailover()
  │
  ├─ Validate inputs (wallet format, non-empty facilitatorConfigs)
  │
  ├─ Convert user configs → internal FacilitatorOption format
  │   ├─ URL-based: { config: { url } }
  │   └─ Coinbase CDP: { config: createFacilitatorConfig(apiKeyId, apiKeySecret) }
  │
  ├─ Filter out invalid configs (returns null for invalid)
  │
  ├─ Verify at least one valid facilitator remains
  │
  ├─ Sort by priority (ascending: 1, 2, 3...)
  │
  ├─ Create middleware instance for each facilitator
  │   └─ Call paymentMiddleware(wallet, routes, facilitator.config, paywall)
  │
  └─ Return async middleware function
```

### Request Processing Flow

```
Request arrives
  │
  └─ For each facilitator (in priority order):
      │
      ├─ Clone request (preserve original for next facilitator)
      │
      ├─ Race: middleware(request) vs. timeout promise
      │   └─ Winner determines outcome
      │
      ├─ On response received:
      │   ├─ Clear timeout timer
      │   │
      │   ├─ If 402: Validate response structure
      │   │   ├─ Valid → return to client
      │   │   └─ Invalid → continue to next facilitator
      │   │
      │   ├─ If 5xx → continue to next facilitator
      │   │
      │   └─ If 2xx/3xx/4xx (except 402) → return to client
      │
      └─ On error/timeout:
          ├─ Clear timeout timer
          ├─ Record error
          └─ Try next facilitator (or return 503 if last)
```

## TypeScript Configuration

**Target**: ES2020 (Next.js Edge Runtime compatible)
**Module**: ESNext with bundler resolution
**Strict Mode**: Fully enabled with additional checks:
- `noUnusedLocals`, `noUnusedParameters`
- `noImplicitReturns`, `noFallthroughCasesInSwitch`

## Dependencies Architecture

**Peer Dependencies** (must be installed by user):
- `x402-next` (>=0.1.0): Provides base `paymentMiddleware` function
- `@coinbase/x402` (>=0.1.0): Provides `createFacilitatorConfig()` for CDP
- `next` (>=14.0.0): Next.js framework

**Why Peer Dependencies?** Prevents version conflicts and reduces bundle size in user's Next.js app.

## Key Constraints & Design Decisions

1. **Edge Runtime Compatibility**: No Node.js-specific APIs (fs, path, etc.)
2. **Type Safety**: All types from upstream packages are properly imported via `import type`
3. **Dual Package**: Outputs both CJS and ESM to support all Next.js configurations
4. **Zero Runtime Dependencies**: Only peer dependencies required
5. **Conservative Failover**: On validation errors, returns original response rather than failing over (prevents false positives)

## Common Development Scenarios

### Adding a New Facilitator Type

1. Add type to `FacilitatorConfig.type` in `src/types.ts`
2. Update `convertToFacilitatorOption()` in `src/failover-middleware.ts` with validation and conversion logic
3. Update README examples

### Modifying Failover Logic

The main loop is in `failover-middleware.ts:146-319`. Key decision points:
- Line 191-244: 402 response validation
- Line 247-263: 5xx error detection
- Line 264-318: Error handling and next facilitator selection

### Adding Input Validation

Add validation checks in `createPaymentMiddlewareWithFailover()` after line 117. Throw descriptive errors with `[x402-next-failover]` prefix for consistency.

## Testing Considerations (Future)

When implementing tests, focus on:
1. **Request cloning** - Verify each facilitator receives independent request
2. **Timeout cleanup** - Ensure no timer leaks on success/error/timeout
3. **Failover triggers** - Test timeout, 5xx, invalid 402, and normal errors
4. **Edge Runtime compatibility** - Test without Node.js APIs
5. **Security** - Verify error details hidden in production mode

## Publishing Checklist

Before publishing:
1. Update version in `package.json`
2. Run `npm run build` - verify no errors
3. Check `dist/` output (should have .js, .mjs, .d.ts, .d.mts, .map files)
4. Update README.md if API changed
5. Update CHANGELOG (if exists)
6. `npm publish` (requires npm authentication)
