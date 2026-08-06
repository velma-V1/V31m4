import { assertDomain } from "../domain-errors.js";
import type { Brand } from "./ids.js";

export type Score = Brand<number, "NormalizedScore">;

export const Score = Object.freeze({
  parse(value: number): Score {
    assertDomain(
      typeof value === "number" && Number.isFinite(value),
      "INVALID_SCORE",
      "Score must be a finite number.",
      { value: Number.isNaN(value) ? "NaN" : value },
    );
    assertDomain(value >= 0 && value <= 1, "INVALID_SCORE", "Score must be between 0 and 1.", {
      value,
    });
    return value as Score;
  },

  fromPercent(percent: number): Score {
    assertDomain(
      typeof percent === "number" && Number.isFinite(percent),
      "INVALID_SCORE",
      "Percentage must be a finite number.",
      { percent: Number.isNaN(percent) ? "NaN" : percent },
    );
    assertDomain(
      percent >= 0 && percent <= 100,
      "INVALID_SCORE",
      "Percentage must be between 0 and 100.",
      { percent },
    );
    return Score.parse(percent / 100);
  },

  toPercent(value: Score): number {
    return value * 100;
  },

  compare(left: Score, right: Score): -1 | 0 | 1 {
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  },
});
