import { CHAT_MAX_LENGTH, COLORS, MATCH_MINUTES_OPTIONS, REACTIONS, THROWABLES, TURN_SECONDS_OPTIONS, type ClientMessage } from '@nomercy/engine';
import { z } from 'zod';

const id = z.string().min(1).max(64);
const color = z.enum(COLORS);
const empty = z.object({}).strict().default({});
const version = z.number().int().nonnegative();

export const NAME_MAX = 20;
const name = z.string().trim().min(1, 'Enter a name').max(NAME_MAX, `Keep it under ${NAME_MAX} characters`);

const msg = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ type: z.literal(type), requestId: z.string().max(64).optional(), payload });

export const clientMessageSchema = z.discriminatedUnion('type', [
  msg('room:join', z.object({ name })),
  msg('room:rename', z.object({ name })),
  msg('room:rejoin', z.object({ playerToken: id })),
  msg('room:leave', empty),
  msg('room:kick', z.object({ playerId: id })),
  msg(
    'room:settings',
    z.object({
      turnSeconds: z
        .number()
        .refine((n) => (TURN_SECONDS_OPTIONS as readonly number[]).includes(n), 'Unsupported turn length')
        .optional(),
      matchMinutes: z
        .number()
        .refine((n) => (MATCH_MINUTES_OPTIONS as readonly number[]).includes(n), 'Unsupported match length')
        .optional(),
    }),
  ),
  msg('game:start', empty),
  msg('game:play', z.object({ cardId: id, stateVersion: version })),
  msg('game:draw', z.object({ stateVersion: version })),
  msg('game:chooseColor', z.object({ color })),
  msg('game:chooseSwap', z.object({ targetId: id })),
  msg('game:rouletteColor', z.object({ color })),
  msg('game:callUno', empty),
  msg('game:catchUno', z.object({ targetId: id })),
  msg('room:lobby', empty),
  msg('room:resetScores', empty),
  msg('room:ready', z.object({ ready: z.boolean() })),
  msg('room:react', z.object({ emoji: z.enum(REACTIONS) })),
  msg('game:endVote', z.object({ outcome: z.enum(['finish', 'cancel']) })),
  msg('game:vote', z.object({ agree: z.boolean() })),
  msg('room:throw', z.object({ targetId: id, item: z.enum(THROWABLES) })),
  msg(
    'room:chat',
    z.object({
      text: z
        .string()
        .max(CHAT_MAX_LENGTH * 4)
        // Control characters become spaces; runs of whitespace collapse to one.
        .transform((t) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
        .pipe(z.string().min(1, 'Type a message first').max(CHAT_MAX_LENGTH, `Keep it under ${CHAT_MAX_LENGTH} characters`)),
    }),
  ),
]);

export function parseClientMessage(raw: string): ClientMessage | { error: string; requestId?: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: 'Message is not valid JSON' };
  }
  const result = clientMessageSchema.safeParse(json);
  if (!result.success) {
    const requestId =
      typeof json === 'object' && json !== null && typeof (json as { requestId?: unknown }).requestId === 'string'
        ? ((json as { requestId: string }).requestId)
        : undefined;
    return { error: result.error.issues[0]?.message ?? 'Invalid message', requestId };
  }
  return result.data as ClientMessage;
}
