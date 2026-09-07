import { z } from 'zod';

const METRIC_KEYS = ["cpu", "mem"] as const;

const FunctionThresholdsSchema = z.record(
  z.enum(METRIC_KEYS),
  z.string()
);

const res = FunctionThresholdsSchema.safeParse({ cpu: "ok", mem_byte: "bad" });
console.log(JSON.stringify(res, null, 2));
