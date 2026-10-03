import type { RoomView } from '@nomercy/engine';

/** The player with the most wins in the room, or null when nobody has won yet or the lead is tied. */
export function leaderId(room: RoomView | null): string | null {
  if (!room) return null;
  const top = Math.max(0, ...room.players.map((p) => p.wins));
  if (top === 0) return null;
  const leaders = room.players.filter((p) => p.wins === top);
  return leaders.length === 1 ? (leaders[0]?.id ?? null) : null;
}

export function winsOf(room: RoomView | null, playerId: string): number {
  return room?.players.find((p) => p.id === playerId)?.wins ?? 0;
}
