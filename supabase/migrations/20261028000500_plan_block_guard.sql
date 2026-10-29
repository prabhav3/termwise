-- A replan on one device can upsert a block it still holds as 'planned' after another device
-- marked it done/missed/skipped. Nothing legitimately turns a finished block back into
-- 'planned' (the engine only creates planned blocks under new keys), so keep the stored row.
create or replace function public.keep_finished_plan_blocks()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'planned' and new.status = 'planned' then
    return old;
  end if;
  return new;
end;
$$;

create trigger plan_blocks_keep_finished
  before update on public.plan_blocks
  for each row execute function public.keep_finished_plan_blocks();
