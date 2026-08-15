"""
Exercise the running app the way 20 stores would.

Checks that matter:
  - a valid code logs in, a wrong one doesn't
  - a store only ever receives its own leads
  - a store cannot write to another store's lead even with a forged body
  - repeated wrong codes get throttled
  - concurrent writes from many stores don't lose updates
"""
import json
import urllib.request
import urllib.error
import concurrent.futures as cf
import http.cookiejar

import os
BASE = os.environ.get("BASE_URL", "http://127.0.0.1:3000")
PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  -- {detail}" if detail and not cond else ""))


def session():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(op, path, payload=None):
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"},
        method="POST" if data else "GET",
    )
    try:
        with op.open(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def load_stores():
    for p in ("data/stores.json", "sheet_seed/stores.json", "../sheet_seed/stores.json"):
        if os.path.exists(p):
            return json.load(open(p))
    raise SystemExit("Could not find stores.json - run this from the app folder.")


stores = load_stores()
a, b = stores[0], stores[1]

print("=== auth ===")
sa = session()
st, res = call(sa, "/api/login", {"code": a["access_code"]})
check("valid code logs in", st == 200 and res.get("ok"), str(res))

bad = session()
st, res = call(bad, "/api/login", {"code": "0001"})
check("wrong code rejected", st == 401 and not res.get("ok"), str(res))

st, res = call(bad, "/api/login", {"code": "12"})
check("malformed code rejected", st == 401, str(res))

st, res = call(session(), "/api/leads")
check("no cookie = no leads", st == 401, str(res))

print("\n=== store isolation ===")
st, res_a = call(sa, "/api/leads")
leads_a = res_a.get("leads", [])
check("store A gets its leads", st == 200 and len(leads_a) > 0, str(st))
check(
    "store A sees only store A",
    all(l["store_id"] == a["store_id"] for l in leads_a),
    "leaked rows present",
)
check(
    "store A lead count matches source",
    len(leads_a) == int(a["total_leads"]),
    f"{len(leads_a)} vs {a['total_leads']}",
)

sb = session()
call(sb, "/api/login", {"code": b["access_code"]})
st, res_b = call(sb, "/api/leads")
leads_b = res_b.get("leads", [])
check("store B sees only store B", all(l["store_id"] == b["store_id"] for l in leads_b))
ids_a = {l["lead_id"] for l in leads_a}
ids_b = {l["lead_id"] for l in leads_b}
check("no lead overlap between stores", len(ids_a & ids_b) == 0, f"{len(ids_a & ids_b)} shared")

print("\n=== forged writes ===")
victim = leads_b[0]["lead_id"]
st, res = call(sa, "/api/lead-update", {
    "leadId": victim, "status": "Converted", "notes": "hijack", "updatedBy": "attacker",
})
check("A cannot write to B's lead", st == 400 and not res.get("ok"), str(res))

st, res = call(sa, "/api/lead-update", {
    "leadId": leads_a[0]["lead_id"], "status": "NotARealStatus", "notes": "", "updatedBy": "x",
})
check("invalid status rejected", st == 400, str(res))

st, res = call(sa, "/api/lead-update", {
    "leadId": leads_a[0]["lead_id"], "status": "Interested", "notes": "wants the chair", "updatedBy": "Arfa",
})
check("valid write accepted", st == 200 and res.get("ok"), str(res))

st, res = call(sa, "/api/leads")
row = next((l for l in res["leads"] if l["lead_id"] == leads_a[0]["lead_id"]), None)
check("write reads back", row and row["status"] == "Interested" and row["notes"] == "wants the chair", str(row))

print("\n=== 20 stores writing at once ===")
sessions = []
for s in stores:
    op = session()
    stt, r = call(op, "/api/login", {"code": s["access_code"]})
    if stt == 200:
        sessions.append((s, op))
check("all 20 stores can sign in", len(sessions) == len(stores), f"{len(sessions)}/{len(stores)}")

work = []
for s, op in sessions:
    stt, r = call(op, "/api/leads")
    for l in r.get("leads", [])[:5]:
        work.append((op, s["store_id"], l["lead_id"]))

def do_write(item):
    op, sid, lid = item
    stt, r = call(op, "/api/lead-update", {
        "leadId": lid, "status": "Callback Later",
        "notes": f"concurrent-{sid[:8]}", "updatedBy": "loadtest",
    })
    return stt == 200 and r.get("ok")

with cf.ThreadPoolExecutor(max_workers=20) as ex:
    results = list(ex.map(do_write, work))
check(f"all {len(work)} concurrent writes succeeded", all(results),
      f"{results.count(False)} failed")

lost = 0
for s, op in sessions:
    stt, r = call(op, "/api/leads")
    got = {l["lead_id"]: l for l in r.get("leads", [])}
    for _, sid, lid in [w for w in work if w[1] == s["store_id"]]:
        if got.get(lid, {}).get("status") != "Callback Later":
            lost += 1
check("no updates lost under concurrency", lost == 0, f"{lost} lost")

print("\n=== admin ===")
ADMIN_CODE = os.environ.get("ADMIN_CODE")


def page(op, path, cookie=None):
    """/admin renders HTML, not JSON, so read it as text."""
    headers = {"Cookie": cookie} if cookie else {}
    req = urllib.request.Request(BASE + path, headers=headers, method="GET")
    opener = op or urllib.request.build_opener()
    try:
        with opener.open(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def token_from(op_jar, name):
    for c in op_jar:
        if c.name == name:
            return c.value
    return None


if not ADMIN_CODE:
    print("SKIP  admin checks -- set ADMIN_CODE to run them")
else:
    st, res = call(session(), "/api/admin/login", {"code": "definitely-not-it"})
    check("wrong admin code rejected", st == 401 and not res.get("ok"), str(res))

    admin_jar = http.cookiejar.CookieJar()
    adm = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(admin_jar))
    st, res = call(adm, "/api/admin/login", {"code": ADMIN_CODE})
    check("admin code logs in", st == 200 and res.get("ok"), str(res))

    st, html = page(adm, "/admin")
    check("admin sees the dashboard", st == 200 and "Not working at all" in html, f"status={st}")
    check(
        "dashboard covers every store",
        all(s["store_name"] in html for s in stores),
        "a store is missing from the admin table",
    )

    st, html = page(None, "/admin")
    check("no cookie = admin login screen", "Enter the admin code" in html, f"status={st}")

    # The important one: a real, correctly signed store cookie must not work as
    # an admin cookie. The role is inside the signed payload, not just the
    # cookie name, so this fails the signature check rather than being trusted.
    store_jar = http.cookiejar.CookieJar()
    sop = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(store_jar))
    call(sop, "/api/login", {"code": a["access_code"]})
    store_token = token_from(store_jar, "frido_store")
    check("got a store token to forge with", bool(store_token))

    _, forged = page(None, "/admin", cookie=f"frido_admin={store_token}")
    check(
        "store cookie cannot be replayed as admin",
        "Enter the admin code" in forged and "Not working at all" not in forged,
    )

    admin_token = token_from(admin_jar, "frido_admin")
    st, _ = page(None, "/api/leads", cookie=f"frido_store={admin_token}")
    check("admin cookie cannot be replayed as a store", st == 401, f"status={st}")

# Last, because it deliberately burns this IP's allowance for the window.
print("\n=== throttling ===")
th = session()
statuses = [call(th, "/api/login", {"code": f"{n:04d}"})[0] for n in range(9100, 9130)]
check("brute force gets throttled", 429 in statuses, f"statuses={set(statuses)}")
check(
    "throttle lets a real store through first",
    statuses.count(401) >= 10,
    f"only {statuses.count(401)} attempts allowed before lockout",
)

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    for f in FAIL:
        print("  FAILED:", f)
    raise SystemExit(1)
