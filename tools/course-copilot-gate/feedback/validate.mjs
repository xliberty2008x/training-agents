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
    const error = result.error || "validator failed";
    return {
      ok: false,
      verdict: {
        valuable: false,
        title: "",
        body: "",
        labels: [],
        reason: error,
      },
      error,
      durationMs: result.durationMs,
    };
  }

  return {
    ok: true,
    verdict: parseVerdict(result.text),
    error: null,
    durationMs: result.durationMs,
  };
}
