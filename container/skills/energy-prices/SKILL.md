---
name: energy-prices
description: Fetch today's (and tomorrow's) Dutch electricity prices from EnergyZero and recommend the best times to run the dishwasher, washing machine, or dryer. Use when the user asks about energy prices, cheap electricity hours, or when to run appliances.
---

# Energy Prices

Public API, no authentication needed.

## Fetching prices

```bash
# Today (replace DATE with YYYY-MM-DD in local time, e.g. 2026-03-28)
curl -s "https://api.energyzero.nl/v1/energyprices?fromDate=YYYY-MM-DDT00:00:00.000Z&tillDate=YYYY-MM-DD+1T00:00:00.000Z&interval=4&usageType=1&inclBtw=true"
```

Construct the dates in UTC. Because the Netherlands is UTC+1 (CET) or UTC+2 (CEST), "today local" starts at 23:00 the previous UTC day. Use the simpler midnight-to-midnight UTC range — the API always returns hourly slots for the full day and you can filter by local time afterward.

Practical example for 2026-03-28:
```bash
curl -s "https://api.energyzero.nl/v1/energyprices?fromDate=2026-03-28T00%3A00%3A00.000Z&tillDate=2026-03-29T00%3A00%3A00.000Z&interval=4&usageType=1&inclBtw=true"
```

Parameters:
- `interval=4` — hourly slots
- `usageType=1` — electricity (2 = gas)
- `inclBtw=true` — prices include VAT

Response shape:
```json
{
  "Prices": [
    { "readingDate": "2026-03-28T10:00:00Z", "price": 0.01 }
  ],
  "average": 0.09,
  "fromDate": "...",
  "tillDate": "..."
}
```

`price` is in EUR/kWh including VAT. `readingDate` is UTC.

## Day-ahead prices

Day-ahead prices become available around 13:00–14:00 local time. Fetch tomorrow's prices using the next day's date range. If the API returns an empty `Prices` array, they're not published yet — tell the user to check back in the afternoon.

## Analysis rules

**Wake hours only:** Only consider slots between 07:00–22:00 local time (CET = UTC+1, CEST = UTC+2 in summer). Never suggest running appliances in the middle of the night.

**Convert UTC to local time** before presenting results. The Netherlands observes CET (UTC+1) in winter and CEST (UTC+2) from the last Sunday of March through the last Sunday of October.

**Appliance windows** — find the cheapest consecutive block:
- Dishwasher: 1–2 hour window
- Washing machine: 1–2 hour window
- Dryer: 1 hour window

For each, find the window with the lowest average price within wake hours.

**Price context:**
- Below €0.05/kWh — very cheap, excellent time to run anything
- €0.05–€0.12/kWh — normal range
- Above €0.20/kWh — expensive, avoid heavy loads

## Output format

Lead with a brief summary: today's average price and whether it's a cheap or expensive day overall.

Then list concrete recommendations:

> **Best times today (local time):**
> - Dishwasher: 10:00–11:00 (€0.01/kWh)
> - Washing machine: 11:00–13:00 (avg €0.01/kWh)
> - Dryer: 12:00–13:00 (€0.01/kWh)

If prices are flat all day (less than €0.05 spread), note that timing doesn't matter much today.

If the user asks what to avoid: flag the peak hours with the highest prices.

Keep the response concise — the user wants actionable advice, not a data dump.
