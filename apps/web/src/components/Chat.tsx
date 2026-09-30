import { CHAT_MAX_LENGTH } from '@nomercy/engine';
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store';
import { Avatar } from './Avatar';

/** Round 💬 button with an unread badge; opens the chat panel. */
export function ChatButton() {
  const unread = useGame((s) => s.chatUnread);
  const open = useGame((s) => s.chatOpen);
  const setOpen = useGame((s) => s.setChatOpen);
  return (
    <button
      className={`relative flex h-7 w-7 items-center justify-center rounded-full text-base transition ${
        open ? 'bg-white/25 ring-1 ring-white/40' : 'bg-white/10 hover:bg-white/20'
      }`}
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
      title="Chat"
    >
      💬
      {unread > 0 && !open && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[0.6rem] font-black text-white ring-2 ring-slate-900">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Chat drawer: a side panel on wide screens, a bottom sheet on phones. */
export function ChatPanel() {
  const { chat, chatOpen, setChatOpen, sendChat, playerId } = useGame();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    if (chatOpen) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length, chatOpen]);

  useEffect(() => {
    if (!chatOpen) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setChatOpen(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [chatOpen, setChatOpen]);

  if (!chatOpen) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const ack = await sendChat(t);
    setSending(false);
    if (ack.ok) setText('');
    input.current?.focus();
  }

  return (
    <aside
      role="dialog"
      aria-label="Chat"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[70vh] flex-col rounded-t-3xl bg-slate-900 shadow-2xl ring-1 ring-white/10 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-full sm:w-80 sm:rounded-none sm:rounded-l-3xl"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="font-bold">💬 Chat</h2>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
          onClick={() => setChatOpen(false)}
          aria-label="Close chat"
        >
          ✕
        </button>
      </header>

      <div ref={list} className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {chat.length === 0 && <p className="pt-8 text-center text-sm text-slate-500">No messages yet. Say hi 👋</p>}
        {chat.map((m) => {
          const mine = m.playerId === playerId;
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
              <Avatar name={m.name} size="xs" />
              <div className={`max-w-[80%] ${mine ? 'text-right' : ''}`}>
                <div className="text-xs text-slate-400">
                  {mine ? 'You' : m.name} · {time(m.at)}
                </div>
                <p
                  className={`mt-0.5 inline-block rounded-2xl px-3 py-1.5 text-left text-sm break-words whitespace-pre-wrap ${
                    mine ? 'rounded-tr-sm bg-sky-600 text-white' : 'rounded-tl-sm bg-white/10 text-slate-100'
                  }`}
                >
                  {m.text}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/10 p-3">
        <input
          ref={input}
          className="input min-w-0 flex-1 py-2 text-sm"
          placeholder={playerId ? 'Message the table…' : 'Take a seat to chat'}
          maxLength={CHAT_MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!playerId}
          aria-label="Chat message"
        />
        <button className="btn-primary px-4 py-2 text-sm" disabled={!text.trim() || sending || !playerId}>
          Send
        </button>
      </form>
    </aside>
  );
}
