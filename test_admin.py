"""
Admin view checks, with the role boundary as the point of the exercise.

The store dashboard and the admin dashboard are both cookie-gated, and the
interesting failure is not "can a stranger get in" but "can a store person get
in". A store cookie is a valid, correctly-signed token — it just carries the
wrong role. These tests hold that line.

Run against a dev server (the session cookie is Secure in production, which
Python's cookiejar won't send over plain HTTP):

    SESSION_SECRET=devsecret ADMIN_CODE=letmein npm run dev
    BASE_URL=http://127.0.0.1:3000 ADMIN_CODE=letmein python3 test_admin.py

The throttle block at the end deliberately burns this IP's admin allowance for
the 10-minute window, and the counter lives in the server's memory. Restart the
dev server between runs or the login checks will fail on a throttle they
themselves caused.
"""
import json
import os
import urllib.request
import urllib.error
import http.cookiejar

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:3000")
ADMIN_CODE = os.environ.get("ADMIN_CODE", "letmein")
PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  -- {detail}" if detail and not cond else ""))


def session():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar


def call(op, path, payload=None, raw=False):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, headers={"Content-Type": "application/json"},
        method="POST" if data else "GET",
    )
    try:
        with op.open(req, timeout=60) as r:
            body = r.read().decode()
            return r.status, body if raw else json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, body if raw else json.loads(body)
        except Exception:
            return e.code, body if raw else {}


stores = json.load(open("data/stores.json"))

# Markers that tell the two rendered states apart. BOARD_MARK has to be unique
# to the board — the login page's own subtitle says "Area manager view", so
# that phrase cannot distinguish them.
LOGIN_MARK = "Open admin view"
BOARD_MARK = "Total leads"

print("=== admin auth ===")
anon, _ = session()
st, html = call(anon, "/admin", raw=True)
check("anonymous /admin shows the login, not data",
      st == 200 and LOGIN_MARK in html and BOARD_MARK not in html)

st, res = call(anon, "/api/admin-login", {"code": "definitely-wrong"})
check("wrong admin code rejected", st == 401 and not res.get("ok"), str(res))

st, html = call(anon, "/admin", raw=True)
check("still locked out after a failed attempt", LOGIN_MARK in html and BOARD_MARK not in html)

adm, _ = session()
st, res = call(adm, "/api/admin-login", {"code": ADMIN_CODE})
check("correct admin code accepted", st == 200 and res.get("ok"), str(res))

st, html = call(adm, "/admin", raw=True)
check("admin sees the board", st == 200 and BOARD_MARK in html and LOGIN_MARK not in html)
check("board renders cross-store numbers", "Total leads" in html and "Every store" in html)
check("board names more than one store",
      sum(1 for s in stores if s["store_name"] in html) > 5,
      "expected many store names in the table")

print("\n=== role separation ===")
# A store cookie is validly signed. It must still be useless at /admin.
stf, _ = session()
st, res = call(stf, "/api/login", {"code": stores[0]["access_code"]})
check("store logs in normally", st == 200 and res.get("ok"), str(res))

st, html = call(stf, "/admin", raw=True)
check("STORE COOKIE CANNOT OPEN /admin",
      LOGIN_MARK in html and BOARD_MARK not in html,
      "a store session reached the admin board")

st, res = call(stf, "/api/leads")
check("store cookie still works for its own leads", st == 200 and res.get("ok"), str(res))

# ...and the reverse: admin is not a store and gets no lead rows.
st, res = call(adm, "/api/leads")
check("ADMIN COOKIE GETS NO STORE LEADS", st == 401, str(res)[:120])

st, res = call(adm, "/api/lead-update", {
    "leadId": "anything", "status": "Converted", "notes": "", "updatedBy": "admin",
})
check("admin cookie cannot write to a lead", st == 401, str(res)[:120])

print("\n=== cookie tampering ===")
# Swap the store token into the admin cookie slot. Signature is real, role isn't.
sneak, jar = session()
call(sneak, "/api/login", {"code": stores[1]["access_code"]})
store_token = next((c.value for c in jar if c.name == "frido_store"), None)
check("captured a real store token", bool(store_token))

if store_token:
    req = urllib.request.Request(BASE + "/admin", headers={"Cookie": f"frido_admin={store_token}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            html = r.read().decode()
    except urllib.error.HTTPError as e:
        html = e.read().decode()
    check("REPLAYING A STORE TOKEN AS THE ADMIN COOKIE FAILS",
          LOGIN_MARK in html and BOARD_MARK not in html,
          "role prefix did not stop the replay")

    req = urllib.request.Request(BASE + "/admin", headers={"Cookie": "frido_admin=forged.deadbeef"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            html = r.read().decode()
    except urllib.error.HTTPError as e:
        html = e.read().decode()
    check("garbage admin cookie rejected", LOGIN_MARK in html and BOARD_MARK not in html)

print("\n=== logout ===")
st, res = call(adm, "/api/admin-logout", {})
check("admin logout ok", st == 200, str(res))
st, html = call(adm, "/admin", raw=True)
check("board closed after logout", LOGIN_MARK in html and BOARD_MARK not in html)

# Last — it burns this IP's admin allowance for the window.
print("\n=== admin throttling ===")
th, _ = session()
statuses = [call(th, "/api/admin-login", {"code": f"nope-{n}"})[0] for n in range(20)]
check("admin brute force gets throttled", 429 in statuses, f"statuses={set(statuses)}")

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    for f in FAIL:
        print("  FAILED:", f)
    raise SystemExit(1)
