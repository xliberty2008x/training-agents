#!/usr/bin/env node
// tools/course-copilot-gate/mock-validator-grok.mjs
// Fake headless Grok CLI for feedback-validator unit/integration tests.

function parseArgv(argv) {
  let prompt = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-p") {
      prompt = argv[i + 1] ?? "";
      i += 1;
    }
  }
  return { prompt };
}

function extractFeedbackText(prompt) {
  if (!prompt) return "";
  const m = prompt.match(/^text:\s*(.*)$/m);
  return m ? m[1].trim() : String(prompt);
}

function buildVerdict(prompt) {
  const text = extractFeedbackText(prompt);
  const discard = /DISCARD/i.test(text);
  const valuableHint = /VALUABLE:/i.test(text);
  const defectish =
    /quiz is broken|contradict|factual error/i.test(text) && !discard;

  if ((valuableHint || defectish) && !discard) {
    return {
      valuable: true,
      title: "Course content issue",
      body: text || "Reported course defect.",
      labels: ["course-feedback"],
      reason: "mock: valuable defect signal",
    };
  }

  return {
    valuable: false,
    title: "",
    body: "",
    labels: [],
    reason: discard ? "mock: DISCARD" : "mock: not valuable",
  };
}

const sleepMs = Number(process.env.MOCK_SLEEP_MS || 0);
const sessionId =
  process.env.MOCK_SESSION_ID || "00000000-0000-4000-8000-000000000099";

async function main() {
  if (Number.isFinite(sleepMs) && sleepMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }

  const args = process.argv.slice(2);
  const { prompt } = parseArgv(args);
  const verdict = buildVerdict(prompt);

  const result = {
    text: "```json\n" + JSON.stringify(verdict) + "\n```",
    sessionId,
    stopReason: "EndTurn",
    args,
  };

  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
