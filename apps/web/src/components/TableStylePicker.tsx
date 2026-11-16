import { useEffect, useRef, useState } from 'react';

const STYLES = [
  { id: 'classic', name: 'Classic', description: 'Green felt · charcoal rail' },
  { id: 'midnight', name: 'Midnight', description: 'Ocean blue · silver rail' },
  { id: 'royal', name: 'Royal', description: 'Purple felt · gold rail' },
  { id: 'ruby', name: 'Ruby', description: 'Burgundy felt · walnut rail' },
] as const;
type TableStyle = (typeof STYLES)[number]['id'];
const STORAGE_KEY = 'nomercy:table-style';

export function useTableStyle() {
  const [style, setStyle] = useState<TableStyle>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return STYLES.find((s) => s.id === saved)?.id ?? 'classic';
    } catch {
      return 'classic';
    }
  });
  function choose(next: TableStyle) {
    setStyle(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still works for this game when storage is unavailable.
    }
  }
  return [style, choose] as const;
}

export function TableStylePicker({ style, onChange }: { style: TableStyle; onChange: (style: TableStyle) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  return (
    <>
      <button
        className="flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-2.5 text-slate-100 ring-1 ring-white/15 hover:bg-white/20"
        onClick={() => setOpen(true)}
        aria-label="Choose table style"
        title="Table style"
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <ellipse cx="10" cy="10" rx="8" ry="5" />
          <ellipse cx="10" cy="10" rx="5.5" ry="2.8" />
        </svg>
        <span className="hidden sm:inline">Table</span>
      </button>
      {open && (
        <dialog
          ref={dialog}
          aria-labelledby="table-style-title"
          aria-describedby="table-style-description"
          onClose={() => setOpen(false)}
          className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl bg-slate-900 p-5 text-white shadow-2xl ring-1 ring-white/15 backdrop:bg-black/70"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="table-style-title" className="text-lg font-bold">Choose your table</h2>
            <button className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20" aria-label="Close table styles" onClick={() => dialog.current?.close()}>✕</button>
          </div>
          <p id="table-style-description" className="mt-1 text-sm text-slate-400">Your table, your style. Only changes your view.</p>
          <div className="mt-4 grid grid-cols-2 gap-3" role="group" aria-label="Table styles">
            {STYLES.map((option) => (
              <button
                key={option.id}
                onClick={() => onChange(option.id)}
                aria-pressed={style === option.id}
                className={`rounded-2xl p-3 text-left ring-2 transition ${style === option.id ? 'bg-white/10 ring-amber-300' : 'bg-white/5 ring-transparent hover:bg-white/10 hover:ring-white/30'}`}
              >
                <div data-table-style={option.id} className="table-appearance relative mb-3 h-20" aria-hidden="true">
                  <div className="table-rail absolute inset-0 rounded-[50%]" />
                  <div className="table-felt absolute inset-2 rounded-[50%]" />
                  <div className="absolute inset-[20%] rounded-[50%] border border-white/15" />
                </div>
                <span className="flex items-center justify-between font-bold">{option.name}<span aria-hidden="true">{style === option.id ? '✓' : ''}</span></span>
                <span className="mt-1 block text-xs text-slate-400">{option.description}</span>
              </button>
            ))}
          </div>
          <button className="btn-primary mt-4 w-full" onClick={() => dialog.current?.close()}>Done</button>
        </dialog>
      )}
    </>
  );
}
