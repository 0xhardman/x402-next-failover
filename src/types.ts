/**
 * Type definitions for x402-failover
 */

/**
 * Facilitator configuration
 */
export interface FacilitatorConfig {
  /** Unique identifier for the facilitator */
  id: string;

  /** Display name for the facilitator */
  name: string;

  /** Priority order (lower number = higher priority) */
  priority: number;

  /** Timeout in milliseconds for this facilitator (optional, defaults to 5000ms) */
  timeoutMs?: number;

  /** URL for URL-based facilitators */
  url?: string;

  /** Type of facilitator */
  type?: "url" | "coinbase-cdp";

  /** Coinbase CDP API Key ID (required if type is "coinbase-cdp") */
  apiKeyId?: string;

  /** Coinbase CDP API Key Secret (required if type is "coinbase-cdp") */
  apiKeySecret?: string;
}

/**
 * Error details when facilitators fail
 */
export interface FacilitatorError {
  /** Name of the facilitator that failed */
  facilitator: string;

  /** Error message */
  error: string;
}

/**
 * Response when all facilitators fail
 */
export interface FailoverErrorResponse {
  /** Error message */
  error: string;

  /** Details of each facilitator failure */
  details: FacilitatorError[];

  /** Timestamp of the failure */
  timestamp: string;
}
