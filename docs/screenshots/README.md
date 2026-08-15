# Screenshots

Captured against a production build (`npm run build && npm start`) with the
bundled `/data` snapshot and seeded call activity, so the numbers are
representative rather than empty. Store views are shot at 414×896 because that's
what store staff actually hold; head office is shot at 1440×1000.

| File | What it shows |
| --- | --- |
| `01-store-login.png` | The 4-digit code screen a store starts on. |
| `02-store-dashboard-hot.png` | Default landing: Hot leads first, on a phone. |
| `03-sorted-latest-visit.png` | All leads, newest walk-in first — the default order. |
| `04-sorted-highest-value.png` | Same list re-sorted by lead value; the ₹69,000 chair leads. |
| `05-store-dashboard-desktop.png` | The store board on a laptop. |
| `06-admin-login.png` | The separate head office code screen at `/admin`. |
| `07-admin-overview.png` | Flags, estate totals and the store table. |
| `08-admin-full.png` | The whole admin page including the staff leaderboard. |

"Gone quiet (48h+)" reads zero in these shots: the seeded activity is minutes
old, so no store has been silent long enough to trip it. Stores with no activity
at all appear under "Not working at all" instead.
