import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "fs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const ADMIN_CODE = process.env.ADMIN_CODE || "letmein";
const OUT = new URL("../screenshots", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const stores = JSON.parse(readFileSync(new URL("../data/stores.json", import.meta.url)));

// --- seed realistic call activity -------------------------------------------
// Without this every store reads "not started" and the admin board has nothing
// to show. Deliberately leaves several stores untouched so the "gone quiet"
// and "hot uncalled" flags appear the way they will in real use.
const STAFF = ["Kamal", "Priya", "Rohit", "Anjali", "Imran", "Sneha"];
const MIX = [
  ...Array(5).fill("Interested"),
  ...Array(4).fill("Converted"),
  ...Array(4).fill("Callback Later"),
  ...Array(3).fill("Not Reachable"),
  ...Array(2).fill("Not Interested"),
];

async function jar(path, opts = {}, cookie = "") {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
    redirect: "manual",
  });
  const set = res.headers.getSetCookie?.() || [];
  const got = set.map((c) => c.split(";")[0]).join("; ");
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body, cookie: got || cookie };
}

// Deterministic pseudo-random so re-running produces the same screenshots.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

async function seedStore(store, howMany) {
  const login = await jar("/api/login", {
    method: "POST",
    body: JSON.stringify({ code: store.access_code }),
  });
  if (login.status !== 200) return 0;

  const leads = await jar("/api/leads", {}, login.cookie);
  const rows = leads.body?.leads || [];
  let n = 0;
  for (const lead of rows.slice(0, howMany)) {
    const status = MIX[Math.floor(rnd() * MIX.length)];
    const by = STAFF[Math.floor(rnd() * STAFF.length)];
    const r = await jar(
      "/api/lead-update",
      {
        method: "POST",
        body: JSON.stringify({
          leadId: lead.lead_id,
          status,
          notes: status === "Converted" ? "Bought at sale price" : "",
          updatedBy: by,
        }),
      },
      login.cookie
    );
    if (r.status === 200) n++;
  }
  return n;
}

console.log("seeding call activity…");
// Work the big stores hard, a couple lightly, and leave the rest silent.
const plan = [
  [0, 120], [1, 90], [2, 70], [3, 55], [4, 40],
  [5, 30], [6, 25], [7, 12], [8, 6], [9, 3],
];
let total = 0;
for (const [i, n] of plan) {
  if (!stores[i]) continue;
  const done = await seedStore(stores[i], n);
  total += done;
  console.log(`  ${stores[i].store_name}: ${done} updates`);
}
console.log(`seeded ${total} updates across ${plan.length} stores (${stores.length - plan.length} left silent)\n`);

// --- screenshots -------------------------------------------------------------
// The image ships full Chromium, not the headless-shell build Playwright
// reaches for by default.
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});

async function shot(name, { width, height }, steps) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: width < 500,
    hasTouch: width < 500,
  });
  const page = await ctx.newPage();
  await steps(page);
  await page.waitForTimeout(700);
  // Filenames are numbered, so match anywhere in the name.
  const full = name.includes("admin");
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("  " + name + ".png");
  await ctx.close();
}

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 950 };

async function storeLogin(page, code) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.fill(".code-input", code);
  await page.click(".btn");
  await page.waitForURL("**/dashboard", { timeout: 30000 });
  await page.waitForSelector(".lead", { timeout: 30000 });
}

async function adminLogin(page) {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.fill(".admin-code", ADMIN_CODE);
  await page.click(".btn");
  await page.waitForSelector(".grid", { timeout: 30000 });
}

console.log("capturing…");
const big = stores[0];

await shot("01-store-login", PHONE, async (page) => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.fill(".code-input", big.access_code);
});

await shot("02-store-dashboard-mobile", PHONE, async (page) => {
  await storeLogin(page, big.access_code);
});

await shot("03-store-dashboard-desktop", DESK, async (page) => {
  await storeLogin(page, big.access_code);
});

await shot("04-sort-latest-first", DESK, async (page) => {
  await storeLogin(page, big.access_code);
  await page.selectOption(".controls .select >> nth=1", "recent");
  await page.click(".tab >> nth=5"); // All
  await page.waitForTimeout(400);
});

await shot("05-sort-highest-value", DESK, async (page) => {
  await storeLogin(page, big.access_code);
  await page.click(".tab >> nth=5"); // All
  await page.selectOption(".controls .select >> nth=1", "value_high");
  await page.waitForTimeout(400);
});

await shot("06-sort-control-mobile", PHONE, async (page) => {
  await storeLogin(page, big.access_code);
  await page.selectOption(".controls .select >> nth=1", "value_high");
  await page.waitForTimeout(400);
});

await shot("07-admin-login", PHONE, async (page) => {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
});

await shot("08-admin-dashboard", DESK, async (page) => {
  await adminLogin(page);
});

await shot("09-admin-mobile", PHONE, async (page) => {
  await adminLogin(page);
});

await browser.close();
console.log("\ndone → " + OUT);
