import { normalizeRankOneRows } from "./rankone-public.js";

export async function parseRankOnePublicHtml(html,source,HTMLRewriterClass=globalThis.HTMLRewriter) {
  if (!HTMLRewriterClass) throw new Error("HTMLRewriter is required for Rank One public schedule parsing");
  const state={current:null,rows:[]};
  const cell=n=>({text(chunk){if(state.current) state.current.cells[n]=(state.current.cells[n]||"")+chunk.text+" ";}});
  const rowHandler={
    element(el){
      state.current={
        nativeId:el.getAttribute("data-id")||el.getAttribute("data-game-id")||el.getAttribute("id")||"",
        full:"",
        cells:Array(10).fill("")
      };
      state.rows.push(state.current);
      el.onEndTag(()=>{state.current=null;});
    },
    text(chunk){if(state.current) state.current.full+=chunk.text+" ";}
  };
  let rewriter=new HTMLRewriterClass().on("table tbody tr",rowHandler);
  for (let i=1;i<=10;i++) rewriter=rewriter.on(`table tbody tr td:nth-child(${i})`,cell(i-1));
  const response=rewriter.transform(new Response(html));
  await response.text();
  return normalizeRankOneRows(state.rows,source);
}
