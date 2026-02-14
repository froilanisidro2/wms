/**
 * Circuit Breaker Pattern
 * Prevents cascading failures by stopping requests to failing backends
 */

interface CircuitState {
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureTime: number;
  successCount: number;
}

const circuits = new Map<string, CircuitState>();

const FAILURE_THRESHOLD = 3; // Open circuit after 3 failures
const RESET_TIMEOUT = 30000; // Try to recover after 30 seconds
const SUCCESS_THRESHOLD = 2; // Close after 2 successes in half-open state

/**
 * Check if request should be allowed
 */
export function isCircuitOpen(key: string): boolean {
  const circuit = circuits.get(key);
  if (!circuit) return false;

  if (circuit.status === 'open') {
    // Check if reset timeout has passed
    if (Date.now() - circuit.lastFailureTime > RESET_TIMEOUT) {
      circuit.status = 'half-open';
      circuit.successCount = 0;
      console.log(`⚡ Circuit breaker [${key}] transitioning to HALF-OPEN`);
      return false; // Allow request
    }
    return true; // Circuit is open, reject request
  }

  return false; // Circuit is closed or half-open, allow request
}

/**
 * Record successful request
 */
export function recordSuccess(key: string): void {
  const circuit = circuits.get(key) || {
    status: 'closed',
    failures: 0,
    lastFailureTime: 0,
    successCount: 0,
  };

  if (circuit.status === 'half-open') {
    circuit.successCount++;
    if (circuit.successCount >= SUCCESS_THRESHOLD) {
      circuit.status = 'closed';
      circuit.failures = 0;
      console.log(`✅ Circuit breaker [${key}] CLOSED (backend recovered)`);
    }
  } else if (circuit.status === 'closed') {
    circuit.failures = 0;
  }

  circuits.set(key, circuit);
}

/**
 * Record failed request
 */
export function recordFailure(key: string): void {
  const circuit = circuits.get(key) || {
    status: 'closed',
    failures: 0,
    lastFailureTime: 0,
    successCount: 0,
  };

  circuit.failures++;
  circuit.lastFailureTime = Date.now();

  if (circuit.failures >= FAILURE_THRESHOLD) {
    circuit.status = 'open';
    console.log(`🔴 Circuit breaker [${key}] OPEN (${circuit.failures} failures)`);
  }

  circuits.set(key, circuit);
}

/**
 * Get circuit state for debugging
 */
export function getCircuitState(key: string): CircuitState | undefined {
  return circuits.get(key);
}

/**
 * Reset all circuits (for testing or emergency recovery)
 */
export function resetAllCircuits(): void {
  circuits.clear();
  console.log('🔄 All circuit breakers reset');
}
