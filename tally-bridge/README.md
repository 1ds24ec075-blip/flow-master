# Talligence Tally Bridge

A tiny Node.js agent that runs on the Tally machine and pushes vouchers from
Talligence directly into Tally over the built-in HTTP XML endpoint.

## Prerequisites

- Node.js 18 or newer
- Tally Prime / Tally.ERP 9 running with the ODBC / HTTP XML server enabled
  (Gateway of Tally → F1 → Settings → Connectivity → Client / Server
  configuration → set as Server, port 9000)

## Setup

1. Copy this `tally-bridge/` folder onto the Tally machine.
2. In Talligence, open **Tally Bridge** in the sidebar and click
   **Register new bridge**. Copy the generated key — it is shown only once.
3. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `BRIDGE_KEY`.
4. Install and run:

   ```bash
   cd tally-bridge
   npm install
   npm start
   ```

The agent will poll every 5 seconds and forward pending vouchers to
`http://localhost:9000`. Job status (sent / failed) and the raw Tally response
are reported back to Talligence, where you can retry failed jobs.

## Run at startup

- **Windows**: install `pm2` globally (`npm i -g pm2 pm2-windows-startup`) and
  run `pm2 start index.js --name tally-bridge && pm2 save && pm2-startup install`.
- **macOS/Linux**: `pm2 start index.js --name tally-bridge && pm2 startup && pm2 save`.
