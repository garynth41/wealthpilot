-- 0014 (0.20.0): the price-feed edge function reports to app_errors too (unknown tickers, Yahoo outages). The source check from 0009
-- listed only browser / sync / notify / backup, so its inserts were rejected silently.
alter table public.app_errors drop constraint if exists app_errors_source_check;
alter table public.app_errors add constraint app_errors_source_check check (source in ('browser', 'sync', 'notify', 'backup', 'price-feed'));
