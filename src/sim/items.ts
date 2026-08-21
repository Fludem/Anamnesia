import { z } from 'zod';
import { IdSchema } from './content/schema.ts';

/** A stack of one item. Everything stacks in Phase 1; non-stackables arrive with equipment. */
export const ItemStackSchema = z.object({
  item: IdSchema,
  qty: z.number().int().min(1),
});
export type ItemStack = z.infer<typeof ItemStackSchema>;

/** An ordered list of stacks. Order is preserved so the bank renders stably. */
export const ContainerSchema = z.array(ItemStackSchema);
export type Container = z.infer<typeof ContainerSchema>;

export function countItem(container: Container, item: string): number {
  let n = 0;
  for (const s of container) if (s.item === item) n += s.qty;
  return n;
}

/** Merge into the existing stack or append a new one. Returns a new container. */
export function addItem(container: Container, item: string, qty: number): Container {
  if (!Number.isInteger(qty) || qty < 1) throw new RangeError(`addItem: qty ${String(qty)}`);
  const i = container.findIndex((s) => s.item === item);
  if (i === -1) return [...container, { item, qty }];
  const existing = container[i]!;
  return container.with(i, { item, qty: existing.qty + qty });
}

/** Remove `qty` of `item`; returns `null` if there is not enough. Empty stacks are dropped. */
export function removeItem(container: Container, item: string, qty: number): Container | null {
  if (!Number.isInteger(qty) || qty < 1) throw new RangeError(`removeItem: qty ${String(qty)}`);
  const i = container.findIndex((s) => s.item === item);
  if (i === -1) return null;
  const existing = container[i]!;
  if (existing.qty < qty) return null;
  if (existing.qty === qty) return container.filter((_, j) => j !== i);
  return container.with(i, { item, qty: existing.qty - qty });
}

export function addStacks(container: Container, stacks: readonly ItemStack[]): Container {
  let c = container;
  for (const s of stacks) c = addItem(c, s.item, s.qty);
  return c;
}
