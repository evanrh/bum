import { z } from 'zod';

import { ApiError } from './errors.ts';

/** Parse with a Zod schema; any failure becomes 400 with the first message. */
export function or400<T>(schema: z.ZodType<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, error.issues[0]?.message ?? 'invalid input');
    }
    throw error;
  }
}
