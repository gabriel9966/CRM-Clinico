import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, apiError } from "../api-auth";
import { AppError } from "../errors";

// Envolve um handler da API v1 convertendo erros de agenda (SchedulingError) e
// de validação (zod) em respostas HTTP com um código estável em `error`.
export function schedulingRoute(
  req: NextRequest,
  handler: (organizationId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  return withApiAuth(req, async (organizationId) => {
    try {
      return await handler(organizationId);
    } catch (err) {
      if (err instanceof AppError) {
        return NextResponse.json({ error: err.code, detail: err.message }, { status: err.status });
      }
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "payload_invalido", fields: z.flattenError(err).fieldErrors }, { status: 400 });
      }
      throw err; // withApiAuth registra e devolve 500
    }
  });
}

export async function readJson(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => null);
}

export { apiError };

const minutes = z.number().int().min(0).max(1440);

export const bookSchema = z.object({
  startAt: z.string().min(1),
  procedureId: z.string().optional(),
  durationMin: z.number().int().optional(),
  professionalId: z.string().optional(),
  roomId: z.string().optional(),
  contactId: z.string().optional(),
  contact: z
    .object({ name: z.string().min(1).max(200), phone: z.string().max(30).optional(), email: z.string().email().optional() })
    .optional(),
  title: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  bookingChannel: z.string().max(50).optional(),
  dryRun: z.boolean().optional(),
  allowReassign: z.boolean().optional(),
});

export const rescheduleSchema = z.object({
  startAt: z.string().min(1),
  professionalId: z.string().optional(),
  allowReassign: z.boolean().optional(),
});

export const reasonSchema = z.object({ reason: z.string().max(500).optional() });

export const professionalSchema = z.object({
  name: z.string().min(1).max(200),
  specialty: z.string().max(100).optional(),
  color: z.string().max(20).optional(),
  userId: z.string().optional(),
  workDays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  workStartMin: minutes.optional(),
  workEndMin: minutes.optional(),
});

export const procedureSchema = z.object({
  name: z.string().min(1).max(200),
  durationMin: z.number().int().min(5).max(720).optional(),
  priceCents: z.number().int().min(0).optional(),
  returnIntervalDays: z.number().int().min(1).max(3650).optional(),
  kind: z.enum(["PROCEDURE", "PRODUCT", "PACKAGE"]).optional(),
  sessions: z.number().int().min(1).max(1000).optional(),
});

export const procedureUpdateSchema = procedureSchema.partial().extend({ active: z.boolean().optional() });

export const tagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export const tagUpdateSchema = tagSchema.partial();

export const lossReasonSchema = z.object({ name: z.string().min(1).max(80) });
export const lossReasonUpdateSchema = z.object({ name: z.string().min(1).max(80).optional(), active: z.boolean().optional() });

export const itemSchema = z.object({
  procedureId: z.string().optional(),
  name: z.string().min(1).max(200).optional(),
  quantity: z.number().int().optional(),
  unitCents: z.number().int().optional(),
  discountCents: z.number().int().optional(),
});
export const itemUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  quantity: z.number().int().optional(),
  unitCents: z.number().int().optional(),
  discountCents: z.number().int().optional(),
});

export const lossSchema = z.object({ lossReasonId: z.string().nullable() });
export const restoreSchema = z.object({ entity: z.enum(["contact", "opportunity", "appointment"]), id: z.string().min(1) });

export const roomSchema = z.object({ name: z.string().min(1).max(100) });

export const blockSchema = z
  .object({
    professionalId: z.string().optional(), // omitido = clínica inteira
    description: z.string().max(200).optional(),
    isRecurring: z.boolean().default(false),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    startMin: minutes,
    endMin: minutes,
  })
  .refine((b) => b.endMin > b.startMin, { message: "endMin deve ser maior que startMin", path: ["endMin"] })
  .refine((b) => (b.isRecurring ? b.weekday !== undefined : b.date !== undefined), {
    message: "recorrente exige weekday; pontual exige date",
    path: ["date"],
  });
