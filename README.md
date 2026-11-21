# Baby weight percentile calculator

Single-file tool (React, Tailwind, Recharts via CDN) that compares a baby's weights to the CDC weight-for-age chart, birth to 36 months.

- `baby-percentile.html`: the whole app. Open it in a browser; no build step. The CDC data is embedded in the file.
- `wtageinf.csv`: the CDC source data (kg). It is embedded in the HTML as `window.GROWTH_DATA`.

Saved entries live in the browser's localStorage under `bpc-v1`.
