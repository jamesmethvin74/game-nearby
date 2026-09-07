import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMascotRows, parseResult } from "../src/parser-core.js";

const source={season:"2026",timezone:"America/Chicago",home_venue:"Conway High School",home_latitude:35.0872,home_longitude:-92.4628};

function mascotResultRow(result){
  return [{
    cells:["Aug 29 10:00 AM VS Little Rock Christian Early Bird Invitational","Little Rock Christian Early Bird Invitational",result,""],
    full:`Aug 29 10:00 AM VS Little Rock Christian Early Bird Invitational ${result}`
  }];
}

test("Mascot Media explicit W/L remains authoritative when its numeric pair is reversed", () => {
  const [win]=normalizeMascotRows(mascotResultRow("W 1 - 2"),source);
  assert.equal(win.status,"FINAL");
  assert.equal(win.result,"W");
  assert.equal(win.teamScore,2);
  assert.equal(win.opponentScore,1);

  const [loss]=normalizeMascotRows(mascotResultRow("L 3 - 1"),source);
  assert.equal(loss.status,"FINAL");
  assert.equal(loss.result,"L");
  assert.equal(loss.teamScore,1);
  assert.equal(loss.opponentScore,3);
});

test("already team-oriented Mascot Media results are unchanged", () => {
  const [win]=normalizeMascotRows(mascotResultRow("W 3 - 0"),source);
  assert.equal(win.teamScore,3);
  assert.equal(win.opponentScore,0);
  const [loss]=normalizeMascotRows(mascotResultRow("L 1 - 3"),source);
  assert.equal(loss.teamScore,1);
  assert.equal(loss.opponentScore,3);
});

test("shared parseResult keeps provider score ordering for non-Mascot parsers", () => {
  assert.deepEqual(parseResult("L, 31-24"), {
    status:"FINAL",teamScore:31,opponentScore:24,result:"L"
  });
});
