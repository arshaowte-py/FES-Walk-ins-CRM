import { sortLeads, priceOf, visitTimeOf, SORTS } from "./lib/sorting.js";
import { readFileSync } from "fs";
const leads = JSON.parse(readFileSync("./data/leads.json"));
let fail = 0;
const ok = (n, c, d="") => { console.log((c?"PASS  ":"FAIL  ")+n+(c?"":"  -- "+d)); if(!c) fail++; };

const withP = leads.filter(l => priceOf(l) !== null);
const noP   = leads.filter(l => priceOf(l) === null);
ok("dataset has both priced and unpriced rows", withP.length>0 && noP.length>0, `${withP.length}/${noP.length}`);

// monotonic checks, ignoring the null tail
function headOf(sorted, valFn) { const v = sorted.map(valFn); const i = v.findIndex(x => x===null); return i===-1?v:v.slice(0,i); }
function isDesc(a){return a.every((x,i)=>i===0||a[i-1]>=x);} 
function isAsc(a){return a.every((x,i)=>i===0||a[i-1]<=x);} 

const rec = sortLeads(leads,"recent");
ok("recent: dates descending", isDesc(headOf(rec, visitTimeOf)));
ok("recent: newest lead is 2026-09-01", rec[0].visit_date==="2026-09-01", rec[0].visit_date);

const old = sortLeads(leads,"oldest");
ok("oldest: dates ascending", isAsc(headOf(old, visitTimeOf)));
ok("oldest: earliest is 2025-12-07", old[0].visit_date==="2025-12-07", old[0].visit_date);

const vh = sortLeads(leads,"value_high");
ok("value_high: prices descending", isDesc(headOf(vh, priceOf)));
ok("value_high: unpriced all at the tail", vh.slice(-noP.length).every(l=>priceOf(l)===null));
ok("value_high: top is the most expensive", priceOf(vh[0])===Math.max(...withP.map(priceOf)), String(priceOf(vh[0])));

const vl = sortLeads(leads,"value_low");
ok("value_low: prices ascending", isAsc(headOf(vl, priceOf)));
ok("value_low: unpriced NOT at the top", priceOf(vl[0])!==null, "unpriced leaked to top");
ok("value_low: unpriced all at the tail", vl.slice(-noP.length).every(l=>priceOf(l)===null));
ok("value_low: cheapest first", priceOf(vl[0])===Math.min(...withP.map(priceOf)), String(priceOf(vl[0])));

ok("no rows lost or duplicated", SORTS.every(s=>{const r=sortLeads(leads,s.key);return r.length===leads.length && new Set(r.map(l=>l.lead_id)).size===new Set(leads.map(l=>l.lead_id)).size;}));
ok("input not mutated", (()=>{const before=leads.map(l=>l.lead_id).join();sortLeads(leads,"value_high");return leads.map(l=>l.lead_id).join()===before;})());
ok("unknown key falls back to default", sortLeads(leads,"../etc/passwd").map(l=>l.lead_id).join()===rec.map(l=>l.lead_id).join());
ok("deterministic across runs", sortLeads(leads,"recent").map(l=>l.lead_id).join()===rec.map(l=>l.lead_id).join());
ok("same-day ties ordered by price desc", (()=>{const d=rec.filter(l=>l.visit_date===rec[5].visit_date);return isDesc(headOf(d,priceOf));})());
ok("handles empty and junk input", sortLeads([],"recent").length===0 && sortLeads(null,"recent").length===0);

console.log(fail? `\n${fail} FAILED` : "\nall sort assertions pass");
process.exit(fail?1:0);
