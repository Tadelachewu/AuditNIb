import { logger } from "@/lib/logger";
import { appDate, clockOffsetMs, testClockProblem, TEST_NOW_VAR } from "@/lib/clock";

/**
 * The test clock's state for this server (docs/test-clock.md), with a log
 * line the first time it is read: a warning while the test clock is on, or
 * when APP_TEST_NOW is set but ignored. Server only.
 */
let logged = false;

export function testClockStatus(): { active: boolean; offsetMs: number } {
  const offsetMs = clockOffsetMs();
  const active = offsetMs !== 0;
  if (!logged) {
    logged = true;
    const problem = testClockProblem();
    if (problem) logger.warn({ event: "test_clock.ignored", [TEST_NOW_VAR]: process.env[TEST_NOW_VAR] }, problem);
    else if (active) logger.warn({ event: "test_clock.on", businessNow: appDate().toISOString(), offsetMs }, "Test clock ON: business dates are simulated (APP_TEST_NOW)");
  }
  return { active, offsetMs };
}
