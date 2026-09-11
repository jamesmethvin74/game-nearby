import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseMaxPrepsDateReplay } from "../src/m7-maxpreps-date-diagnostic.js";

test("MaxPreps date replay diagnostic remains zero-D1 after the shared parser filters replayed cards", async()=>{
  const pages={
    "8/1/2026":`<option value="a">Alpha</option><option value="b">Beta</option><li class="c" data-contest-id="same" data-teams="a,b"><div class="details">Final</div><a href="/ar/volleyball/match/alpha-vs-beta/8-1-2026/?c=same" class="c-c"></a><li><div class="name">Alpha</div><div class="score">3</div></li><li><div class="name">Beta</div><div class="score">0</div></li></li>`,
    "8/2/2026":`<option value="a">Alpha</option><option value="b">Beta</option><li class="c" data-contest-id="same" data-teams="a,b"><div class="details">Final</div><a href="/ar/volleyball/match/alpha-vs-beta/8-1-2026/?c=same" class="c-c"></a><li><div class="name">Alpha</div><div class="score">3</div></li><li><div class="name">Beta</div><div class="score">0</div></li></li>`
  };
  const result=await diagnoseMaxPrepsDateReplay({
    through:"2026-08-02",
    fetchFn:async url=>{
      const u=new URL(url);const key=decodeURIComponent(u.searchParams.get("date"));
      return new Response(pages[key]||"",{status:200,headers:{"content-type":"text/html"}});
    }
  });
  assert.equal(result.invariants.d1_rows_read,0);
  assert.equal(result.invariants.d1_rows_written,0);
  assert.equal(result.parsed_observations,1);
  assert.equal(result.unique_contests,1);
  assert.equal(result.repeated_contests,0);
  assert.equal(result.duplicate_observations,0);
  assert.equal(result.requested_vs_url_date_mismatches,0);
});
