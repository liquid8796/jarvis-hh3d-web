import { z } from "zod";

/** Actual bag capacity reported by the game, never inferred from VIP/free or defaults. */
const pillBagCapacitySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const pillBagCapsSchema = z
  .object({
    ha: pillBagCapacitySchema,
    trung: pillBagCapacitySchema,
    thuong: pillBagCapacitySchema,
    cuc: pillBagCapacitySchema,
  })
  .strict();

export type PillBagCaps = z.infer<typeof pillBagCapsSchema>;
