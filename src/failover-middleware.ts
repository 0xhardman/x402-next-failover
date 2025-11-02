/**
 * Payment Middleware with Failover
 *
 * Wraps x402-next's paymentMiddleware to provide automatic failover
 * between multiple facilitators. Works in Edge Runtime!
 */

import { paymentMiddleware } from "x402-next";
import { createFacilitatorConfig } from "@coinbase/x402";
import type { FacilitatorConfig as X402FacilitatorConfig } from "x402/types";
import type { NextRequest } from "next/server";
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
 *   facilitators
 * );
 * ```
 */
export function createPaymentMiddlewareWithFailover(
  wallet: `0x${string}`,
  routes: Parameters<typeof paymentMiddleware>[1],
  facilitatorConfigs: FacilitatorConfig[]
): (request: NextRequest) => Promise<Response> {
  // Convert configs to options and filter out invalid ones
  const facilitators = facilitatorConfigs
    .map(convertToFacilitatorOption)
    .filter((f): f is FacilitatorOption => f !== null);

  // Sort facilitators by priority (lower number = higher priority)
  const sortedFacilitators = [...facilitators].sort(
    (a, b) => a.priority - b.priority
  );

  // Create a middleware instance for each facilitator
  const middlewareInstances = sortedFacilitators.map((facilitator) => ({
    ...facilitator,
    middleware: paymentMiddleware(wallet, routes, facilitator.config),
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

      try {
        console.log(
          `[x402-next-failover] Trying facilitator: ${name} (timeout: ${timeout}ms)`
        );

        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Timeout after ${timeout}ms`));
          }, timeout);
        });

        // Race between middleware call and timeout
        const response = await Promise.race([
          middleware(request),
          timeoutPromise,
        ]);

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

    return new Response(
      JSON.stringify({
        error: "All payment facilitators are currently unavailable",
        details: errors,
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
