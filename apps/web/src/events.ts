import type { Card, GameEvent } from '@nomercy/engine';

const TYPE_NAMES: Record<Card['kind']['type'], string> = {
  number: '',
  skip: 'Skip',
  reverse: 'Reverse',
  draw2: 'Draw Two',
  draw4: 'Draw Four',
  discardAll: 'Discard All',
  skipEveryone: 'Skip Everyone',
  wildReverseDraw4: 'Wild Reverse Draw 4',
  wildDraw6: 'Wild Draw 6',
  wildDraw10: 'Wild Draw 10',
  wildColorRoulette: 'Wild Colour Roulette',
};

export function cardName(card: Card): string {
  if (card.kind.type === 'number') return `${card.color} ${card.kind.value}`;
  return card.color ? `${card.color} ${TYPE_NAMES[card.kind.type]}` : TYPE_NAMES[card.kind.type];
}

export function describeEvent(e: GameEvent, name: (id: string) => string): string | null {
  switch (e.type) {
    case 'played':
      return `${name(e.playerId)} played ${cardName(e.card)}`;
    case 'drew':
      return e.count > 0 ? `${name(e.playerId)} drew ${e.count}` : null;
    case 'stackGrew':
      return `Stack is now +${e.total}`;
    case 'colorChosen':
      return `${name(e.playerId)} chose ${e.color}`;
    case 'reversed':
      return 'Direction reversed';
    case 'skipped':
      return e.playerIds.length > 1 ? 'Everyone else skipped' : `${name(e.playerIds[0] ?? '')} skipped`;
    case 'discardedAll':
      return `${name(e.playerId)} discarded ${e.count} ${e.color}`;
    case 'handsSwapped':
      return `${name(e.a)} swapped hands with ${name(e.b)}`;
    case 'handsRotated':
      return 'Everyone passed their hand';
    case 'rouletteFlip': {
      const shown = e.cards.slice(0, 6).map(cardName).join(', ');
      const more = e.cards.length > 6 ? ` +${e.cards.length - 6} more` : '';
      return `${name(e.playerId)} flipped ${e.count} looking for ${e.color}: ${shown}${more}`;
    }
    case 'eliminated':
      return `${name(e.playerId)} hit ${e.cardCount} cards and is out — no mercy`;
    case 'unoCalled':
      return `${name(e.playerId)} called UNO!`;
    case 'unoCaught':
      return `${name(e.byId)} caught ${name(e.playerId)} — +2`;
    case 'reshuffled':
      return 'Discard pile reshuffled';
    case 'timedOut':
      return `${name(e.playerId)} ran out of time`;
    case 'forfeited':
      return `${name(e.playerId)} left the game`;
    case 'won':
      return `${name(e.playerId)} won the round!`;
  }
}
