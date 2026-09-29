import { buildDeck, type Card as CardT } from '@nomercy/engine';
import { Card, CardBack } from './Card';

/** Dev-only page at /cards showing one of every card design. */
export function CardGallery() {
  const seen = new Set<string>();
  const unique: CardT[] = [];
  for (const c of buildDeck()) {
    const key = `${c.color}-${c.kind.type}-${c.kind.type === 'number' ? c.kind.value : ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }
  return (
    <div className="flex flex-wrap gap-3 p-6">
      <CardBack size="lg" />
      {unique.map((c) => (
        <Card key={c.id} card={c} size="lg" />
      ))}
    </div>
  );
}
