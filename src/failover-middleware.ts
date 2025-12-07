/**
 * Payment Middleware with Failover
 *
 * Wraps x402-next's paymentMiddleware to provide automatic failover
 * between multiple facilitators. Works in Edge Runtime!
 */

import { paymentMiddleware } from "x402-next";
import { createFacilitatorConfig } from "@coinbase/x402";
import type { FacilitatorConfig as X402FacilitatorConfig } from "x402/types";
import { NextRequest } from "next/server";
import type { FacilitatorConfig, FacilitatorError } from "./types";

// Default timeout for facilitator requests (5 seconds)
const DEFAULT_TIMEOUT_MS = 5000;

interface FacilitatorOption {
  id: string;
  name: string;
  config: X402FacilitatorConfig;
  priority: number;
  timeoutMs?: number;
}

/**
 * Convert facilitator config to x402 facilitator option
 */
function convertToFacilitatorOption(
  config: FacilitatorConfig
): FacilitatorOption | null {
  // Handle Coinbase CDP type
  if (config.type === "coinbase-cdp") {
    if (!config.apiKeyId || !config.apiKeySecret) {
      console.warn(
        `[x402-next-failover] Skipping ${config.name}: Missing CDP API credentials`
      );
      return null;
    }
    return {
      id: config.id,
      name: config.name,
      config: createFacilitatorConfig(config.apiKeyId, config.apiKeySecret),
      priority: config.priority,
      timeoutMs: config.timeoutMs,
    };
  }

  // Handle URL-based facilitators
  if (!config.url) {
    console.warn(`[x402-next-failover] Skipping ${config.name}: Missing URL`);
    return null;
  }

  return {
    id: config.id,
    name: config.name,
    config: {
      url: config.url as `${string}://${string}`,
    },
    priority: config.priority,
    timeoutMs: config.timeoutMs,
  };
}

/**
 * Create payment middleware with automatic failover between facilitators
 *
 * @param wallet - Wallet address to receive payments
 * @param routes - Route configuration for payment middleware
 * @param facilitatorConfigs - Array of facilitator configurations
 * @param paywall - Optional paywall configuration for customizing the payment UI
 * @returns Middleware function with failover support
 *
 * @example
 * ```typescript
 * import { createPaymentMiddlewareWithFailover } from "x402-failover";
 *
 * const facilitators = [
 *   {
 *     id: "x402-rs",
 *     name: "X402 RS",
 *     url: "https://facilitator.x402.rs",
 *     priority: 1,
 *     timeoutMs: 5000,
 *   },
 *   {
 *     id: "payai",
 *     name: "PayAI Network",
 *     url: "https://facilitator.payai.network",
 *     priority: 2,
 *   },
 * ];
 *
 * export const middleware = createPaymentMiddlewareWithFailover(
 *   "0xYourWalletAddress",
 *   {
 *     "/api/data": {
 *       price: "$0.01",
 *       network: "base",
 *       config: { ... }
 *     }
 *   },
 *   facilitators,
 *   {
 *     cdpClientKey: "your-cdp-client-key",
 *     appName: "My App",
 *     appLogo: "/logo.svg"
 *   }
 * );
 * ```
 */
export function createPaymentMiddlewareWithFailover(
  wallet: `0x${string}`,
  routes: Parameters<typeof paymentMiddleware>[1],
  facilitatorConfigs: FacilitatorConfig[],
  paywall?: Parameters<typeof paymentMiddleware>[3]
): (request: NextRequest) => Promise<Response> {
  // Validate input parameters
  if (!facilitatorConfigs || facilitatorConfigs.length === 0) {
    throw new Error(
      "[x402-next-failover] At least one facilitator configuration is required"
    );
  }

  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
    throw new Error(
      "[x402-next-failover] Invalid wallet address format (expected 0x followed by 40 hex characters)"
    );
  }

  // Convert configs to options and filter out invalid ones
  const facilitators = facilitatorConfigs
    .map(convertToFacilitatorOption)
    .filter((f): f is FacilitatorOption => f !== null);

  // Verify at least one valid facilitator after filtering
  if (facilitators.length === 0) {
    throw new Error(
      "[x402-next-failover] No valid facilitator configurations found (all configs were invalid or missing required fields)"
    );
  }

  // Sort facilitators by priority (lower number = higher priority)
  const sortedFacilitators = [...facilitators].sort(
    (a, b) => a.priority - b.priority
  );

  // Create a middleware instance for each facilitator
  const middlewareInstances = sortedFacilitators.map((facilitator) => ({
    ...facilitator,
    middleware: paymentMiddleware(wallet, routes, facilitator.config, paywall),
  }));

  console.log(
    `[x402-next-failover] Initialized with ${middlewareInstances.length} facilitators:`,
    middlewareInstances
      .map((f) => `${f.name} (priority ${f.priority})`)
      .join(", ")
  );

  // Return wrapped middleware with failover logic
  return async (request: NextRequest) => {
    const startTime = Date.now();
    const errors: FacilitatorError[] = [];

    // Try each facilitator in priority order
    for (let i = 0; i < middlewareInstances.length; i++) {
      const { name, middleware, timeoutMs } = middlewareInstances[i];
      const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;

      // Clone request for each facilitator to support failover
      // In Next.js, request body can only be read once
      // Must use NextRequest constructor to preserve nextUrl property
      let requestToUse: NextRequest;
      try {
        // Clone the underlying Request first, then wrap in NextRequest
        const clonedRequest = request.clone();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        requestToUse = new NextRequest(clonedRequest.url, {
          method: clonedRequest.method,
          headers: clonedRequest.headers,
          body: clonedRequest.body,
          duplex: "half",
        } as any);
      } catch (cloneError) {
        console.error(
          `[x402-next-failover] Cannot clone request for ${name}:`,
          cloneError instanceof Error ? cloneError.message : String(cloneError)
        );
        // Fallback to original request if cloning fails
        requestToUse = request;
      }

      let timeoutId: NodeJS.Timeout | null = null;

      try {
        console.log(
          `[x402-next-failover] Trying facilitator: ${name} (timeout: ${timeout}ms)`
        );

        // Create timeout promise with cleanup capability
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Timeout after ${timeout}ms`));
          }, timeout);
        });

        // Race between middleware call and timeout
        const response = await Promise.race([
          middleware(requestToUse),
          timeoutPromise,
        ]);

        // Clear timeout if request succeeded before timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        // Check for invalid 402 responses (facilitator malfunction)
        // A valid 402 response should have either error or accepts fields
        if (response.status === 402) {
          try {
            // Check if response body has already been consumed
            if (response.bodyUsed) {
              console.warn(
                `[x402-next-failover] Cannot validate ${name} 402 response: body already consumed`
              );
              return response;
            }

            // Clone response for validation
            const clonedResponse = response.clone();
            const body = (await clonedResponse.json()) as {
              error?: string;
              accepts?: unknown[];
            };

            // If both error and accepts are missing/empty, this is a facilitator error
            if (!body.error && (!body.accepts || body.accepts.length === 0)) {
              const errorMsg = "Invalid 402 response: missing error and accepts fields";
              errors.push({ facilitator: name, error: errorMsg });

              console.warn(
                `[x402-next-failover] ${name} returned malformed 402 response, trying next facilitator...`
              );

              // If this is not the last facilitator, continue to next
              if (i < middlewareInstances.length - 1) {
                continue;
              }

              // If this is the last facilitator, return the original response
              return response;
            }
          } catch (validationError) {
            // Response cloning or JSON parsing failed
            // This could be due to: body already consumed, invalid JSON, or clone failure
            const errorMsg =
              validationError instanceof Error
                ? validationError.message
                : "Failed to validate 402 response";

            console.error(
              `[x402-next-failover] Error validating ${name} 402 response:`,
              errorMsg
            );

            // Don't failover on validation errors - return the original response
            // This prevents false positives when the response is actually valid
            // but we failed to validate it (e.g., due to Edge Runtime limitations)
            return response;
          }
        }

        // Check if response indicates failure
        // We consider 5xx errors as facilitator failures that should trigger failover
        if (response.status >= 500) {
          const errorMsg = `HTTP ${response.status}`;
          errors.push({ facilitator: name, error: errorMsg });

          console.warn(
            `[x402-next-failover] ${name} returned ${response.status}, trying next facilitator...`
          );

          // If this is not the last facilitator, continue to next
          if (i < middlewareInstances.length - 1) {
            continue;
          }

          // If this is the last facilitator, return the error response
          return response;
        }

        // Success! Log and return
        const duration = Date.now() - startTime;
        console.log(
          `[x402-next-failover] ✓ Success with ${name} (${duration}ms)` +
            (i > 0 ? ` after ${i} failover(s)` : "")
        );

        return response;
      } catch (error) {
        // Clear timeout in case of error
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        const errorMsg =
          error instanceof Error ? error.message : String(error);
        errors.push({ facilitator: name, error: errorMsg });

        console.error(`[x402-next-failover] ✗ ${name} failed:`, errorMsg);

        // If this is the last facilitator, throw the error
        if (i === middlewareInstances.length - 1) {
          throw error;
        }

        // Otherwise, continue to next facilitator
        console.log(
          `[x402-next-failover] Attempting next facilitator (${
            middlewareInstances.length - i - 1
          } remaining)...`
        );
      }
    }

    // This should never be reached, but just in case
    const duration = Date.now() - startTime;
    console.error(
      `[x402-next-failover] All facilitators failed after ${duration}ms:`,
      errors
    );

    // Only expose error details in development environment
    const isDevelopment = process.env.NODE_ENV === "development";

    return new Response(
      JSON.stringify({
        error: "All payment facilitators are currently unavailable",
        // Only include details in development to prevent information leakage
        ...(isDevelopment && { details: errors }),
        timestamp: new Date().toISOString(),
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      }
    );
  };
}
