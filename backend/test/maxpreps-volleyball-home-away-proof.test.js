import test from "node:test";
import assert from "node:assert/strict";
import { parseMaxPrepsVolleyballScores } from "../src/maxpreps-volleyball-results.js";

function html(options,card){return `<select>${options}</select><ul>${card}</ul>`;}

test("MaxPreps data-teams order matches known Southwest-home Conway-away relation",()=>{
  const options=`<option value="rBhmxWcZW0i8KKbBFuuGMw">Little Rock Southwest</option><option value="sQaardEBI0-k0YeejX-Apw">Conway</option>`;
  const card=`<li class="c" data-teams="rBhmxWcZW0i8KKbBFuuGMw,sQaardEBI0-k0YeejX-Apw" data-contest-id="78fee4b0-52ff-4696-8246-bff5397b06d6"><a class="c-c"><ul class="teams"><li class="winner"><div class="score">3</div><div class="name">Conway</div></li><li><div class="score">0</div><div class="name">Little Rock Southwest</div></li></ul><div class="details">Final</div></a></li>`;
  const [final]=parseMaxPrepsVolleyballScores(html(options,card),{localDate:"2026-09-03"});
  assert.equal(final.home.name,"Little Rock Southwest");
  assert.equal(final.home.score,0);
  assert.equal(final.away.name,"Conway");
  assert.equal(final.away.score,3);
});

test("MaxPreps data-teams order matches known Flippin-home Melbourne-away relation",()=>{
  const options=`<option value="rodllMNpDkWVbWyCVle9GA">Flippin</option><option value="GBQtc1EzqkuU1bYqi8N3rg">Melbourne</option>`;
  const card=`<li class="c" data-teams="rodllMNpDkWVbWyCVle9GA,GBQtc1EzqkuU1bYqi8N3rg" data-contest-id="68fc4573-a969-496d-938b-27d766712dcc"><a class="c-c"><ul class="teams"><li><div class="score">0</div><div class="name">Melbourne</div></li><li class="winner"><div class="score">3</div><div class="name">Flippin</div></li></ul><div class="details">Final</div></a></li>`;
  const [final]=parseMaxPrepsVolleyballScores(html(options,card),{localDate:"2026-09-03"});
  assert.equal(final.home.name,"Flippin");
  assert.equal(final.home.score,3);
  assert.equal(final.away.name,"Melbourne");
  assert.equal(final.away.score,0);
});
