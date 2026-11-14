-- 0.29.1 backstop (Nov 14): someone who already has a household cannot be given a second, unnamed one by a stray click.
-- On Nov 14 a sign-in showed "Welcome — Create household" for the few seconds the household list took to load, and one click there made
-- an empty "My household" and opened it in place of the real one. 0.29.1 fixed the screen; this refuses the same request on the server,
-- so a browser tab or phone still running an older version cannot do it either. A deliberate extra household still works: it has a name
-- of its own (0.29.1 asks for one). A person's first household may keep the default name. Only requests from a signed-in person are
-- checked — the service role (account deletion, restores) is not. Safe to re-run.
create or replace function public.households_one_unnamed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null
     and lower(btrim(coalesce(new.name, ''))) in ('', 'my household')
     and exists (select 1 from public.household_members m where m.user_id = auth.uid()) then
    raise exception 'You already have a household — open it from the list. To make another one, give it a name of its own.'
      using errcode = 'P0001', hint = 'household_needs_name';
  end if;
  return new;
end $$;
revoke all on function public.households_one_unnamed() from public, anon, authenticated;   -- trigger-only
drop trigger if exists trg_households_one_unnamed on public.households;
create trigger trg_households_one_unnamed before insert on public.households for each row execute function public.households_one_unnamed();
