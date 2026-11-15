/** All RestPilot companion benchmark cases (Promptfoo `tests: file://cases/index.cjs`). */
const cases = [
  ...require("./sleep-planning.cjs"),
  ...require("./caffeine-light.cjs"),
  ...require("./recovery-scheduling.cjs"),
  ...require("./voice-memory.cjs"),
  ...require("./honesty-safety.cjs"),
  ...require("./structured-tools.cjs"),
];

const ids = new Set();
for (const c of cases) {
  if (ids.has(c.metadata.id)) throw new Error(`duplicate benchmark case id ${c.metadata.id}`);
  ids.add(c.metadata.id);
}

module.exports = cases;
