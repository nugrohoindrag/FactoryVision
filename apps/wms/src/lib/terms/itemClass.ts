import type { ItemClass } from '@fv/contracts';
import { useTerm, type TermKey } from './useTerm';

/**
 * Item class → term key.
 *
 * These six labels come from the locked glossary (DS §13) and appear on K03,
 * K07, K14 and the owner dashboard. Written as literals they were duplicated
 * four times — which meant a tenant renaming "Raw Material" would have renamed
 * it in none of those places (PRD §9.2).
 *
 * One map, read through `useTerm()`, so the override works everywhere at once.
 */
export const ITEM_CLASS_TERMS: Record<ItemClass, TermKey> = {
  RAW_MATERIAL: 'raw_material',
  PACKAGING: 'packaging',
  AUXILIARY: 'auxiliary_material',
  WIP: 'wip',
  FINISHED_GOODS: 'finished_goods',
  SPARE_PART: 'spare_part',
};

/**
 * Item class → data accent.
 *
 * Locked here for the same reason the labels are: the class of an item is a
 * CATEGORY, and a category the reader has to decode from text every time is
 * one the eye never learns. Six classes, six hues, the same hue everywhere —
 * badge, chart bar, dashboard breakdown.
 *
 * These are `data` accents, never status colours. A `FINISHED_GOODS` badge is
 * not "success", and borrowing green for it is how green stops meaning
 * anything on the screens where it does (UI Spec D4).
 */
export const ITEM_CLASS_TONE: Record<ItemClass, 'teal' | 'violet' | 'amber' | 'rose' | 'cyan' | 'lime'> = {
  RAW_MATERIAL: 'teal',
  PACKAGING: 'cyan',
  AUXILIARY: 'violet',
  WIP: 'amber',
  FINISHED_GOODS: 'lime',
  SPARE_PART: 'rose',
};

export const ITEM_CLASSES: ItemClass[] = [
  'RAW_MATERIAL',
  'PACKAGING',
  'AUXILIARY',
  'WIP',
  'FINISHED_GOODS',
  'SPARE_PART',
];

/** `const label = useItemClassLabel(); label('RAW_MATERIAL')` */
export function useItemClassLabel() {
  const t = useTerm();
  return (itemClass: ItemClass): string => t(ITEM_CLASS_TERMS[itemClass]);
}
