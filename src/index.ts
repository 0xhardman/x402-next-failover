/**
 * x402-next-failover
 *
 * Automatic failover middleware for x402 payment facilitators in Next.js
 * with configurable timeout support. Works seamlessly in Next.js Edge Runtime.
 *
 * @packageDocumentation
 */

export { createPaymentMiddlewareWithFailover } from "./failover-middleware";
export type {
  FacilitatorConfig,
  FacilitatorError,
  FailoverErrorResponse,
} from "./types";
