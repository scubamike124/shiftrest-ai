/**
 * LLM-rubric grader for the companion benchmark (OpenAI-compatible endpoint).
 * Chosen with BENCH_JUDGE=<vendor>:<model>, else the first available key:
 * OpenAI gpt-6.1-sol, then Anthropic claude-sonnet-5-5, then Google gemini-3.8-flash.
 * A judge from the same family as a candidate can favour it: the report names
 * the judge so results can be cross-checked with a second judge.
 */
const { costOf } = require("./app-provider.cjs");

const VENDORS = {
  openai: { baseUrl: "https://api.openai.com/v1", key: "OPENAI_API_KEY", model: "gpt-6.1-sol" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", key: "ANTHROPIC_API_KEY", model: "claude-sonnet-5-5" },
  google: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GEMINI_API_KEY", model: "gemini-3.8-flash" },
};

function judgeConfig(env = process.env) {
  if (env.BENCH_JUDGE) {
    const [vendor, model] = env.BENCH_JUDGE.split(":");
    const v = VENDORS[vendor];
    if (!v) throw new Error(`BENCH_JUDGE vendor must be one of ${Object.keys(VENDORS).join(", ")}`);
    return { ...v, model: model || v.model, vendor };
  }
  for (const vendor of ["openai", "anthropic", "google"]) if (env[VENDORS[vendor].key]) return { ...VENDORS[vendor], vendor };
  return null;
}

class Grader {
  id() {
    const j = judgeConfig();
    return j ? `judge:${j.vendor}:${j.model}` : "judge:unconfigured";
  }
  async callApi(prompt) {
    const j = judgeConfig();
    if (!j) return { error: "no judge key (set OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY, or run with BENCH_NO_JUDGE=1)" };
    let messages;
    try {
      messages = JSON.parse(prompt);
      if (!Array.isArray(messages)) throw new Error();
    } catch {
      messages = [{ role: "user", content: String(prompt) }];
    }
    // OpenAI reasoning judges spend output tokens on reasoning: keep it low and leave headroom.
    const body = j.vendor === "openai" ? { model: j.model, messages, max_completion_tokens: 2000, reasoning_effort: "low" } : { model: j.model, messages, max_tokens: 1000 };
    if (j.vendor !== "anthropic") body.response_format = { type: "json_object" };
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${j.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env[j.key]}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) return { error: `judge HTTP ${res.status}` };
      const data = await res.json();
      const u = data.usage;
      return {
        output: data.choices?.[0]?.message?.content ?? "",
        tokenUsage: u ? { prompt: u.prompt_tokens, completion: u.completion_tokens, total: u.total_tokens } : undefined,
        cost: u ? costOf(j.model, { prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0 }) : undefined,
      };
    }
  }
}

module.exports = Grader;
module.exports.judgeConfig = judgeConfig;
