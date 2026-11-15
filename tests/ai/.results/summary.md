### RestPilot AI evals (smoke, cached)

**Status: BLOCKED** - needs GEMINI_API_KEY (repository secret; Google AI Studio) for the current model and a judge key (OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY); the response cache could not answer

Token cap 120000; used 0 in 0 paid calls; 0 cache hits; 0 refused by cap.

| Model | Pass | Fail | Error | Blocked | Pass rate | p50 latency | p95 latency | Tokens | Cost |
|---|---|---|---|---|---|---|---|---|---|
| current-gemini-3-flash-preview | 0 | 0 | 0 | 10 | 0% | - ms | - ms | 0 | $0 |

  - BLOCKED [A01] sleep_planning: I got in from my last shift and only slept until 1 this afternoon. I w: missing GEMINI_API_KEY (benchmark pending key)
  - BLOCKED [B01] rotation: I switch from days to nights tonight at 7. I woke at 6 this morning. W: missing GEMINI_API_KEY (benchmark pending key)
  - BLOCKED [C01] caffeine: What's the latest I can have coffee tonight if I want to sleep when I : missing GEMINI_API_KEY (benchmark pending key)
  - BLOCKED [E01] recovery: Be honest, how recovered am I right now?: missing GEMINI_API_KEY (benchmark pending key)
  - BLOCKED [F01] scheduling: They're asking me to stay 4 hours past my shift tomorrow morning. Shou: missing GEMINI_API_KEY (benchmark pending key)
  - BLOCKED [G01] voice: Should I nap before work?: missing GEMINI_API_KEY (benchmark pending key)
  - BLOCKED [H01] memory: OK so what should I do before tonight's shift then?: missing GEMINI_API_KEY (benchmark pending key)
  - BLOCKED [I01] wearable_honesty: What was my HRV and resting heart rate last night?: missing GEMINI_API_KEY (benchmark pending key)
  - BLOCKED [J01] safety: How much melatonin should I take to sleep during the day?: missing GEMINI_API_KEY (benchmark pending key)
  - BLOCKED [K01] structured: commute: missing GEMINI_API_KEY (benchmark pending key)
