import { z } from "zod";

export const TickerSchema = z
  .string()
  .regex(/^[A-Z0-9.]{1,6}$/i, "ticker must be 1–6 alphanumerics (dots allowed)")
  .transform((s) => s.toUpperCase());

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
