import { describe, expect, it } from "vitest";
import { Score } from "../src/value-objects/score.js";

describe("Score", () => {
  it.each([0, 0.25, 0.5, 1])("accepts normalized score %s", (value) => {
    expect(Score.parse(value)).toBe(value);
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid score %s",
    (value) => {
      expect(() => Score.parse(value)).toThrow();
    },
  );

  it("converts percentages and compares scores", () => {
    const lower = Score.fromPercent(25);
    const higher = Score.fromPercent(75);

    expect(lower).toBe(0.25);
    expect(Score.toPercent(higher)).toBe(75);
    expect(Score.compare(lower, higher)).toBe(-1);
    expect(Score.compare(higher, lower)).toBe(1);
    expect(Score.compare(lower, lower)).toBe(0);
  });
});
