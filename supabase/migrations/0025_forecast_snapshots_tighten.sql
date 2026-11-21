-- 0025 — saved forecasts: only the rights the app uses (0.36.0; Gary, Nov 21).
-- Supabase's default privileges gave signed-in users every right on the new table, as on every other. A saved forecast is meant to be
-- unchangeable, so the ones the app never uses are taken away: emptying the table (truncate — which row-level security does not cover),
-- attaching triggers, and foreign keys pointing at it. What is left is what 0024 intended: read, add, delete — each still subject to the
-- policies. Safe to run more than once.
revoke truncate, references, trigger, update on public.forecast_snapshots from authenticated;
revoke all on public.forecast_snapshots from anon;
