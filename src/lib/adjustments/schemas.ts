import { z } from "zod";

/** Request bodies of the adjustment API (src/app/api/findings/[id]/adjustments, src/app/api/admin/adjustments). */

const MAX_CASES = 10_000;
const MAX_AMOUNT = 1e13;

export const adjustmentInputSchema = z.object({
  addedCases: z.number().int("Cases to add must be a whole number").min(0, "Cases can only be added (0 or more)").max(MAX_CASES, `At most ${MAX_CASES} cases`),
  amountChange: z.number().finite().min(-MAX_AMOUNT).max(MAX_AMOUNT).optional(),
  newCaseAmounts: z.array(z.number().finite().min(0, "An added case's amount can't be negative").max(MAX_AMOUNT)).max(MAX_CASES).optional(),
  caseAmountChanges: z
    .array(z.object({ caseId: z.string().min(1), to: z.number().finite().positive("A decrease can't take a case to 0 or below").max(MAX_AMOUNT) }))
    .max(MAX_CASES)
    .optional(),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required").max(1000, "The reason must be at most 1000 characters"),
});

export const createAdjustmentSchema = adjustmentInputSchema.extend({ submit: z.boolean().default(false) });

export const updateAdjustmentSchema = z.discriminatedUnion("action", [
  adjustmentInputSchema.extend({ action: z.literal("edit"), submit: z.boolean().default(false) }),
  z.object({ action: z.literal("submit") }),
  z.object({ action: z.literal("withdraw"), reason: z.string().trim().max(1000).optional() }),
]);

export const reviewAdjustmentSchema = z
  .object({ decision: z.enum(["APPROVE", "RETURN", "REJECT"]), reason: z.string().trim().max(1000).optional() })
  .refine((v) => v.decision === "APPROVE" || (v.reason ?? "").length >= 5, {
    message: "A reason of at least 5 characters is required to return or reject an adjustment",
    path: ["reason"],
  });

export const adjustmentConfigSchema = z.object({
  revolvingOperationAreas: z.array(z.string().trim().max(200)).max(500),
});
