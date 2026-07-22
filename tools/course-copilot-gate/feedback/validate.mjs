// tools/course-copilot-gate/feedback/validate.mjs
import { runGrokTurn } from "../grok.mjs";
import { buildValidatorPrompt, parseVerdict } from "./validator-prompt.mjs";

/**
 * One-shot feedback validation (never resumes a tutor session).
 *
 * @returns {Promise<{ ok: boolean, verdict: object, error: string|null, durationMs?: number }>}
 */
export async function runValidator({
  grokBin,
  extraArgs = [],
  grokArgs,
  cwd,
  job,
  timeoutMs = 180000,
  maxTurns = 2,
  env,
} = {}) {
  const prompt = buildValidatorPrompt({ job });
  const result = await runGrokTurn({
    grokBin,
    extraArgs,
    grokArgs,
    cwd,
    prompt,
    sessionId: null,
    maxTurns,
    timeoutMs,
    env,
  });

  if (!result.ok) {
    return {
      ok: false,
      verdict: {
        valuable: false,
        title: "",
        body: "",
        labels: [],
        reason: result.error || "validator failed",
      },
      error: result.error || "validator failed",
      durationMs: result.durationMs,
    };
  }

  const verdict = parseVerdict(result.text);
  return {
    ok: true,
    verdict,
    error: null,
    durationMs: result.durationMs,
  };
}
