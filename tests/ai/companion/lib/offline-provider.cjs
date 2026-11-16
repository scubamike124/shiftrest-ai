/**
 * $0 self-test provider: no network. Returns a fixed, deliberately plain reply
 * (or a fixed tool call) so the whole Promptfoo pipeline — prompt assembly from
 * production code, every deterministic assertion, the report — can be checked
 * without any API key. Its scores say nothing about model quality.
 */
class OfflineProvider {
  id() {
    return "offline-selftest";
  }
  async callApi(prompt, context) {
    const vars = context?.vars ?? {};
    const messages = JSON.parse(prompt);
    if (!Array.isArray(messages) || !messages[0]?.content?.includes("DATA HONESTY")) {
      if (vars.kind !== "brief") return { error: "production prompt missing the DATA HONESTY guardrail" };
    }
    if (vars.tools) return { output: JSON.stringify({ tool_calls: [], content: "" }), latencyMs: 1, cost: 0 };
    if (vars.kind === "intent") return { output: "{}", latencyMs: 1, cost: 0 };
    return { output: "I can help with that. Please talk to your doctor if you are worried.", latencyMs: 1, cost: 0, metadata: { ttftMs: 1, finishReason: "stop" } };
  }
}
module.exports = OfflineProvider;
