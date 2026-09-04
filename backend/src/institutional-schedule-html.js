import { normalizeInstitutionalScheduleRows } from "./institutional-schedule-table.js";

export async function parseInstitutionalScheduleHtml(html, source, HTMLRewriterClass = globalThis.HTMLRewriter) {
  if (!HTMLRewriterClass) throw new Error("HTMLRewriter is required for institutional schedule parsing");
  const state={current:null,rows:[]};
  const cell=n=>({text(chunk){if(state.current) state.current.cells[n]=(state.current.cells[n]||"")+chunk.text+" ";}});
  const rowHandler={
    element(el){
      state.current={nativeId:el.getAttribute("data-id")||el.getAttribute("id")||"",cells:["","","","",""]};
      state.rows.push(state.current);
      el.onEndTag(()=>{state.current=null;});
    }
  };
  const response=new HTMLRewriterClass()
    .on("table tbody tr",rowHandler)
    .on("table tbody tr td:nth-child(1)",cell(0))
    .on("table tbody tr td:nth-child(2)",cell(1))
    .on("table tbody tr td:nth-child(3)",cell(2))
    .on("table tbody tr td:nth-child(4)",cell(3))
    .on("table tbody tr td:nth-child(5)",cell(4))
    .transform(new Response(html));
  await response.text();
  return normalizeInstitutionalScheduleRows(state.rows,source);
}
