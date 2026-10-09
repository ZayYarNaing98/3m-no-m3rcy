import type { RoomView } from '@nomercy/engine';

/** Whether this player has the most wins in the room (ties share the lead); nobody leads before the first win. */
export function isLeader(room: RoomView | null, playerId: string): boolean {
  if (!room) return false;
  const top = Math.max(0, ...room.players.map((p) => p.wins));
  return top > 0 && winsOf(room, playerId) === top;
}

export function winsOf(room: RoomView | null, playerId: string): number {
  return room?.players.find((p) => p.id === playerId)?.wins ?? 0;
}
