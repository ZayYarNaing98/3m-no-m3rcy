import { COLORS, type Card, type CardKind, type CardType, type NumberValue } from './types';

export const DECK_SIZE = 168;
export const MERCY_LIMIT = 25;
export const HAND_SIZE = 7;

const COLORED_ACTIONS: Array<[CardKind, number]> = [
  [{ type: 'skip' }, 3],
  [{ type: 'reverse' }, 3],
  [{ type: 'draw2' }, 3],
  [{ type: 'draw4' }, 2],
  [{ type: 'discardAll' }, 3],
  [{ type: 'skipEveryone' }, 2],
];

const WILDS: Array<[CardKind, number]> = [
  [{ type: 'wildReverseDraw4' }, 8],
  [{ type: 'wildDraw6' }, 4],
  [{ type: 'wildDraw10' }, 4],
  [{ type: 'wildColorRoulette' }, 8],
];

/** Builds the 168-card No Mercy deck in a fixed order. */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let n = 0;
  const add = (color: Card['color'], kind: CardKind) => cards.push({ id: `c${n++}`, color, kind });

  for (const color of COLORS) {
    for (let v = 0; v <= 9; v++) {
      add(color, { type: 'number', value: v as NumberValue });
      add(color, { type: 'number', value: v as NumberValue });
    }
    for (const [kind, count] of COLORED_ACTIONS) {
      for (let i = 0; i < count; i++) add(color, kind);
    }
  }
  for (const [kind, count] of WILDS) {
    for (let i = 0; i < count; i++) add(null, kind);
  }
  return cards;
}

export function isWild(card: Card): boolean {
  return card.color === null;
}

/** Draw value of a card, or 0 if it is not a draw card. */
export function drawValue(card: Card): 0 | 2 | 4 | 6 | 10 {
  switch (card.kind.type) {
    case 'draw2':
      return 2;
    case 'draw4':
    case 'wildReverseDraw4':
      return 4;
    case 'wildDraw6':
      return 6;
    case 'wildDraw10':
      return 10;
    default:
      return 0;
  }
}

export function sameSymbol(a: Card, b: Card): boolean {
  if (a.kind.type !== b.kind.type) return false;
  if (a.kind.type === 'number' && b.kind.type === 'number') return a.kind.value === b.kind.value;
  return true;
}

/** Human-readable label, used in logs and test messages. */
export function cardLabel(card: Card): string {
  const k = card.kind;
  const color = card.color ?? 'wild';
  switch (k.type) {
    case 'number':
      return `${color} ${k.value}`;
    default:
      return `${color} ${k.type}`;
  }
}

const KIND_ORDER: CardType[] = [
  'wildColorRoulette',
  'wildReverseDraw4',
  'wildDraw6',
  'wildDraw10',
  'number',
  'skip',
  'reverse',
  'draw2',
  'draw4',
  'discardAll',
  'skipEveryone',
];

/** A hand in display order: wild cards first, then each colour grouped, numbers before actions. */
export function sortHand(hand: Card[]): Card[] {
  const colorRank = (c: Card) => (c.color === null ? -1 : COLORS.indexOf(c.color));
  const kindRank = (c: Card) => KIND_ORDER.indexOf(c.kind.type);
  const value = (c: Card) => (c.kind.type === 'number' ? c.kind.value : 0);
  return [...hand].sort((a, b) => colorRank(a) - colorRank(b) || kindRank(a) - kindRank(b) || value(a) - value(b));
}
