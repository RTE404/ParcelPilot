# ParcelPilot Support Agent

An AI support agent for ParcelPilot (a fictional B2B logistics platform), built for the
CalQuity AI Engineer assessment. Two chat surfaces — a customer portal and an internal-ops
portal with a manager-only issue-detection dashboard — share one agent backend, three tool
categories, and a statically-parsed dataset.

See [`docs/HLD.md`](docs/HLD.md) and [`docs/LLD.md`](docs/LLD.md) for architecture and design
detail, and [`docs/superpowers/specs/2026-08-22-parcelpilot-agent-design.md`](docs/superpowers/specs/2026-08-22-parcelpilot-agent-design.md)
for the full design rationale.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and set `GOOGLE_GENERATIVE_AI_API_KEY` (a free key from
   Google AI Studio — https://aistudio.google.com/apikey).
3. `npm run parse-data` — parses `ParcelPilot_Assessment_Data.xlsx` into `lib/data/*.json`
   (already committed, but re-run this if the workbook changes).
4. `npm run dev` — open http://localhost:3000.

## Testing

`npm test` runs the full Vitest suite (data layer, tools, calculations, session/access-control,
dashboard, and key UI components).

## Demo logins

Customer portal: Northstar Logistics, LumenWorks, Beacon Retail, Axis Labs.
Internal portal: Rohit (Support Agent), Priya Mehta (Manager — also sees the dashboard).

## Deployment

Deployed on Vercel (Hobby/free tier). Set `GOOGLE_GENERATIVE_AI_API_KEY` as a Vercel
environment variable. `EVAL_ENDPOINT`/`EVAL_API_KEY` are optional and intentionally left unset
in production — see docs/HLD.md §7/§10 for why.
