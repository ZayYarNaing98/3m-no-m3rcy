import { AVATAR_COLORS, AVATAR_ICONS, type PlayerAvatar } from '@nomercy/engine';
import { useEffect, useRef, useState } from 'react';
import { saveAvatar } from '../avatar';
import { useGame } from '../store';
import { Avatar, AVATAR_GRADIENTS, defaultAvatar } from './Avatar';

/** Edit your own avatar in the lobby or from your hand while playing. */
export function AvatarPicker({ name, playerId, online, active }: { name: string; playerId: string; online?: boolean; active?: boolean }) {
  const current = useGame((s) => s.room?.players.find((p) => p.id === playerId)?.avatar);
  const [draft, setDraft] = useState<PlayerAvatar>(() => current ?? defaultAvatar(name));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  async function save() {
    if (busy) return;
    setBusy(true);
    const ack = await useGame.getState().send('room:avatar', { avatar: draft });
    setBusy(false);
    if (ack.ok) {
      saveAvatar(draft);
      dialog.current?.close();
    }
  }

  return (
    <>
      <button
        type="button"
        className="shrink-0 rounded-full transition hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-400"
        aria-label="Change your avatar"
        aria-haspopup="dialog"
        title="Change your avatar"
        onClick={() => { setDraft(current ?? defaultAvatar(name)); setOpen(true); }}
      >
        <Avatar name={name} playerId={playerId} online={online} active={active} />
      </button>
      {open && (
        <dialog
          ref={dialog}
          aria-labelledby="avatar-picker-title"
          onClose={() => setOpen(false)}
          className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-3xl bg-raised p-5 text-fg shadow-2xl ring-1 ring-line backdrop:bg-black/70"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="avatar-picker-title" className="text-lg font-bold">Your avatar</h2>
            <button type="button" className="h-8 w-8 rounded-full bg-surface-2" aria-label="Close avatar picker" onClick={() => dialog.current?.close()}>✕</button>
          </div>
          <div className="my-5 flex flex-col items-center gap-2">
            <Avatar name={name} avatar={draft} size="md" />
            <span className="text-sm text-muted">{name}</span>
          </div>
          <fieldset disabled={busy}>
            <legend className="mb-2 text-sm font-bold">Icon</legend>
            <div className="grid grid-cols-6 gap-2">
              {AVATAR_ICONS.map((icon) => (
                <button key={icon} type="button" aria-label={icon === 'initials' ? 'Use initials' : `Use ${icon}`} aria-pressed={draft.icon === icon}
                  className={`flex h-10 items-center justify-center rounded-xl text-xl ring-2 ${draft.icon === icon ? 'bg-surface-3 ring-sky-400' : 'bg-surface-2 ring-transparent hover:bg-surface-3'}`}
                  onClick={() => setDraft({ ...draft, icon })}>
                  {icon === 'initials' ? <span className="text-xs font-bold">ABC</span> : icon}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-4" disabled={busy}>
            <legend className="mb-2 text-sm font-bold">Color</legend>
            <div className="grid grid-cols-8 gap-2">
              {AVATAR_COLORS.map((color) => (
                <button key={color} type="button" aria-label={`Use ${color} background`} aria-pressed={draft.color === color}
                  className={`flex aspect-square items-center justify-center rounded-full bg-gradient-to-br font-bold text-white ring-2 ring-offset-2 ring-offset-raised ${AVATAR_GRADIENTS[color]} ${draft.color === color ? 'ring-sky-400' : 'ring-transparent'}`}
                  onClick={() => setDraft({ ...draft, color })}>
                  {draft.color === color && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="mt-4 text-xs text-muted">Everyone in the room sees your avatar. Saved for future games.</p>
          <button type="button" className="btn-primary mt-4 w-full" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save avatar'}</button>
        </dialog>
      )}
    </>
  );
}
