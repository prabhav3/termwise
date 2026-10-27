// plan_blocks: the persisted day-by-day plan. Writes go through src/lib/planner.ts (replan,
// markBlockDone, markBlockMissed) so the engine stays the single source of block layout.
import { queryOptions, useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { ISODate, PlanBlock, UUID } from '@/types/db';

import { fetchAllPages } from './helpers';
import { queryKeys } from './keys';

export function fetchPlanBlocks(): Promise<PlanBlock[]> {
  return fetchAllPages((from, to) =>
    supabase.from('plan_blocks').select('*').order('date').order('sort_order').order('key').range(from, to),
  );
}

export function planBlocksQueryOptions() {
  return queryOptions({ queryKey: queryKeys.planBlocks(), queryFn: fetchPlanBlocks });
}

/** Every stored block (history included), by date then sort order. */
export function usePlanBlocks() {
  return useQuery(planBlocksQueryOptions());
}

export function useBlocksForDate(date: ISODate | null | undefined) {
  return useQuery({
    ...planBlocksQueryOptions(),
    enabled: Boolean(date),
    select: (blocks) => blocks.filter((block) => block.date === date),
  });
}

export function useBlocksForItem(itemId: UUID | null | undefined) {
  return useQuery({
    ...planBlocksQueryOptions(),
    enabled: Boolean(itemId),
    select: (blocks) => blocks.filter((block) => block.item_id === itemId),
  });
}

export function useBlock(key: string | null | undefined) {
  return useQuery({
    ...planBlocksQueryOptions(),
    enabled: Boolean(key),
    select: (blocks) => blocks.find((block) => block.key === key) ?? null,
  });
}
