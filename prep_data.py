"""
Clean the Zoho walk-in export into the three tabs the CRM reads:
  Leads   - one row per lead, store-normalised, priority-tiered
  Stores  - one row per store with its 4-digit access code
  Updates - empty; the app appends to this
"""
import pandas as pd
import random
import re
import json

random.seed(7)

SRC = "leads_raw.csv"
OUT = "sheet_seed"

# --- store name normalisation -------------------------------------------------
# Same physical store, different spellings in Zoho. Map everything to one label.
STORE_ALIASES = {
    "amanoramallhadapsarpune": "Amanora Mall, Hadapsar, Pune",
    "amartechparkbalewadipune": "Amar Tech Park, Balewadi, Pune",
    "banjarahillshyderabad": "Banjara Hills, Hyderabad",
    "bhartiyamallbangalore": "Bhartiya Mall, Bangalore",
    "elpromallpcmcpune": "Elpro Mall, PCMC, Pune",
    "felixplazagurugram": "Felix Plaza, Gurugram",
    "gachibowlihyderabad": "Gachibowli, Hyderabad",
    "golfcourseroad": "Golf Course Road, Gurugram",
    "kompallyhyderabad": "Kompally, Hyderabad",
    "kopamallmundhwardpune": "Kopa Mall, Mundhwa Rd, Pune",
    "lakeshoreyjunction": "Lakeshore Y Junction",
    "lulumallbangalore": "LuLu Mall, Bangalore",
    "mallofasiabangalore": "Mall of Asia, Bangalore",
    "nexuswestendaundh": "Nexus Westend, Aundh, Pune",
    "nexuswestendaundhpune": "Nexus Westend, Aundh, Pune",
    "omaxeworldstreetfaridabad": "Omaxe World Street, Faridabad",
    "phoenixmarketcityvimannagarpune": "Phoenix Marketcity, Viman Nagar, Pune",
    "ris": "RIS",
    "skycityborivalimumbai": "Skycity, Borivali, Mumbai",
    "vegasmalldwarka": "Vegas Mall, Dwarka",
}


def norm_key(s):
    if pd.isna(s):
        return None
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


# --- priority tiers -----------------------------------------------------------
# Drives which leads a store should call first during the sale.
WON_STAGES = {"Purchased in Store", "Purchased Online", "Sold"}

# Lost the sale specifically on price -> the sale directly answers their objection.
HOT_REASONS = {
    "Waiting for discount / offer / sale",
    "Out of budget",
}
# Never got a decision out of them; the sale is a fresh reason to call.
WARM_STAGES = {
    "Buy Later",
    "Follow-up Scheduled",
    "Whatsapp connected",
    "Yet to Call",
    "RNR 1",
    "RNR2",
    "RNR 3",
    "Product OOS",
    "Not available for experience",
}


def priority(stage, reason):
    if stage in WON_STAGES:
        return "Converted"
    if reason in HOT_REASONS:
        return "Hot"
    if stage in WARM_STAGES:
        return "Warm"
    return "Cold"


def clean_phone(p):
    """Normalise to +91XXXXXXXXXX where we can; otherwise leave the digits."""
    if pd.isna(p):
        return ""
    d = re.sub(r"[^0-9]", "", str(p))
    if len(d) == 10:
        return "+91" + d
    if len(d) == 12 and d.startswith("91"):
        return "+" + d
    if len(d) == 11 and d.startswith("0"):
        return "+91" + d[1:]
    return "+" + d if d else ""


def main():
    df = pd.read_csv(SRC, dtype=str)
    df["_key"] = df["Store"].map(norm_key)
    df["store_name"] = df["_key"].map(STORE_ALIASES)
    df["store_name"] = df["store_name"].fillna("Unassigned")

    df["priority"] = [
        priority(s, r) for s, r in zip(df["Stage"], df["Close lost reasons"])
    ]

    walkin = pd.to_datetime(df["Walk-in Date/Time"], errors="coerce")
    created = pd.to_datetime(df["Created Time"], errors="coerce")
    visit = walkin.fillna(created)

    leads = pd.DataFrame(
        {
            "lead_id": df["Record Id"],
            "store_id": df["store_name"].map(slug),
            "store_name": df["store_name"],
            "customer_name": df["Customer Name"].fillna("").str.strip(),
            "phone": df["Phone number"].map(clean_phone),
            "email": df["Email"].fillna(""),
            "product": df["Product Name"].fillna(""),
            "product_type": df["Product Type"].fillna(""),
            "unit_price": df["Unit Price"].fillna(""),
            "zoho_stage": df["Stage"].fillna(""),
            "lost_reason": df["Close lost reasons"].fillna(""),
            "priority": df["priority"],
            "visit_date": visit.dt.strftime("%Y-%m-%d").fillna(""),
            "remarks": df["Visit Remarks"].fillna("").str.replace(
                r"\s+", " ", regex=True
            ).str.strip(),
            "captured_by": df["Walk-in Owner"].fillna(""),
        }
    )

    # Newest first, hottest first inside a store.
    tier = {"Hot": 0, "Warm": 1, "Cold": 2, "Converted": 3}
    leads["_t"] = leads["priority"].map(tier)
    leads = leads.sort_values(
        ["store_name", "_t", "visit_date"], ascending=[True, True, False]
    ).drop(columns="_t")

    # --- store table + access codes ------------------------------------------
    codes = set()

    def new_code():
        while True:
            c = f"{random.randint(1000, 9999)}"
            # Skip codes people guess first or that look like a typo.
            if c in codes or c in {"1234", "0000", "1111", "9999", "1212", "4321"}:
                continue
            if len(set(c)) == 1:
                continue
            codes.add(c)
            return c

    counts = leads.groupby(["store_id", "store_name"]).size().reset_index(name="total_leads")
    tiers = (
        leads.pivot_table(index="store_id", columns="priority", aggfunc="size", fill_value=0)
        .reset_index()
    )
    stores = counts.merge(tiers, on="store_id", how="left").fillna(0)
    for c in ["Hot", "Warm", "Cold", "Converted"]:
        if c not in stores:
            stores[c] = 0
    stores = stores.rename(
        columns={"Hot": "hot", "Warm": "warm", "Cold": "cold", "Converted": "converted"}
    )
    stores = stores.sort_values("total_leads", ascending=False).reset_index(drop=True)
    stores["access_code"] = [new_code() for _ in range(len(stores))]
    stores["active"] = "TRUE"
    stores = stores[
        [
            "store_id",
            "store_name",
            "access_code",
            "active",
            "total_leads",
            "hot",
            "warm",
            "cold",
            "converted",
        ]
    ]

    import os

    os.makedirs(OUT, exist_ok=True)
    leads.to_csv(f"{OUT}/Leads.csv", index=False)
    stores.to_csv(f"{OUT}/Stores.csv", index=False)
    pd.DataFrame(
        columns=[
            "update_id",
            "lead_id",
            "store_id",
            "status",
            "notes",
            "updated_by",
            "updated_at",
        ]
    ).to_csv(f"{OUT}/Updates.csv", index=False)

    # Seed JSON so the app runs before the Sheet exists.
    leads.to_json(f"{OUT}/leads.json", orient="records")
    stores.to_json(f"{OUT}/stores.json", orient="records")

    print(f"Leads: {len(leads)}   Stores: {len(stores)}")
    print()
    print(stores.to_string(index=False))
    print()
    print("Priority split:")
    print(leads["priority"].value_counts().to_string())


if __name__ == "__main__":
    main()
