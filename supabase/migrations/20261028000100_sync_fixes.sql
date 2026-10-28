-- Calendar sync: remember item entries the student deleted in their calendar app.
--
-- When a pushed item's event / task disappears externally, the sync (calendar-sync for Google /
-- Outlook, the on-device Apple sync) keeps its calendar_event_links row as a tombstone with
-- deleted_externally = true instead of dropping it. While the item is done ("Mark done") or the
-- deletion still awaits the student's decision, the entry is not pushed again. "Keep it" (which
-- clears pushed_hash) or reopening the item removes the tombstone and recreates the entry.
alter table public.calendar_event_links
  add column deleted_externally boolean not null default false;
