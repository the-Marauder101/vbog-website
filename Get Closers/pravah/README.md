# Pravah V0 application shell

Open `index.html` directly or serve this folder with any static server.

V0 contains no backend connection and no production data. Pasted reports are
parsed in the browser and saved only to that browser's local storage. This is
deliberate: it validates the reporting interaction before Supabase tables and
Row Level Security are introduced in V1.

## Test

From this directory:

```bash
node test/report-parser.test.cjs
```

## Current interaction

1. Select **Paste WhatsApp report**.
2. Paste `Label: value` or `Label - value` lines.
3. Preview the normalized data.
4. Save a local draft.
5. Copy a concise WhatsApp update from Reports.

No credentials are required or permitted in this V0 folder.
