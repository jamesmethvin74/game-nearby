import test from "node:test";
import assert from "node:assert/strict";
import { parseResult } from "../src/parser-core.js";

test("explicit W/L remains authoritative when a provider reverses the numeric pair", () => {
  assert.deepEqual(parseResult("W 1 - 2"), {
    status:"FINAL", teamScore:2, opponentScore:1, result:"W"
  });
  assert.deepEqual(parseResult("L 3 - 1"), {
    status:"FINAL", teamScore:1, opponentScore:3, result:"L"
  });
});

test("already team-oriented explicit results are unchanged", () => {
  assert.deepEqual(parseResult("W 3 - 0"), {
    status:"FINAL", teamScore:3, opponentScore:0, result:"W"
  });
  assert.deepEqual(parseResult("L 1 - 3"), {
    status:"FINAL", teamScore:1, opponentScore:3, result:"L"
  });
});
