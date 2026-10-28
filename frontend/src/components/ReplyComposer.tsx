import { useMutation } from '@tanstack/react-query';
import { Globe2, Loader2, LockKeyhole, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useRefreshTickets } from '../api/hooks';
import type { EntryType } from '../types';
import { ErrorState, useToast } from './Feedback';

export default function ReplyComposer({ ticketId, author, onAuthorChange }: { ticketId: number; author: string; onAuthorChange: (value: string) => void }) {
  const [content, setContent] = useState('');
  const [type, setType] = useState<EntryType>('Public Reply');
  const [validation, setValidation] = useState<string | null>(null);
  const refresh = useRefreshTickets();
  const notify = useToast();
  const internal = type === 'Internal Note';
  const send = useMutation({
    mutationFn: (input: { content: string; author: string; entry_type: EntryType }) => api.addEntry(ticketId, input),
    onSuccess: async (_, input) => { setContent(''); await refresh(); notify(input.entry_type === 'Internal Note' ? 'Internal note added' : 'Public reply added to the conversation'); },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!author.trim() || !content.trim()) { setValidation('Enter your name and a message before sending.'); return; }
    setValidation(null);
    send.mutate({ author: author.trim(), content: content.trim(), entry_type: type });
  }
  return <form onSubmit={submit} className={`mt-6 overflow-hidden rounded-xl border ${internal ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
    <fieldset disabled={send.isPending}>
      <div className={`flex flex-wrap items-center gap-3 border-b px-4 py-3 ${internal ? 'border-amber-100' : 'border-slate-100'}`}>{internal ? <LockKeyhole size={15} className="text-amber-600" /> : <Globe2 size={15} className="text-brand-600" />}<label htmlFor="reply-type" className="sr-only">Message type</label><select id="reply-type" className="bg-transparent text-xs font-semibold text-ink outline-none" value={type} onChange={(e) => setType(e.target.value as EntryType)}><option>Public Reply</option><option>Internal Note</option></select><span className="ml-auto text-[10px] text-slate-400">{internal ? 'For your team only' : 'Customer-facing conversation'}</span></div>
      <div className="px-4 pt-4"><label htmlFor="reply-author" className="field-label">Your name <span className="text-rose-500">*</span></label><input id="reply-author" className="input max-w-xs !bg-white/80" value={author} onChange={(e) => onAuthorChange(e.target.value)} placeholder="Who is writing this?" required maxLength={120} /></div>
      <div className="px-4 pt-4"><label htmlFor="reply-content" className="sr-only">{internal ? 'Internal note' : 'Reply message'}</label><textarea id="reply-content" className="min-h-32 w-full resize-y bg-transparent text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-400" rows={5} placeholder={internal ? 'Share context, next steps, or a handoff with your team…' : 'Write a thoughtful reply…'} value={content} onChange={(e) => { setContent(e.target.value); setValidation(null); }} required aria-describedby="reply-hint" /></div>
      {(send.isError || validation) && <div className="px-4 pb-3"><ErrorState compact error={validation ? new Error(validation) : send.error} /></div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3"><p id="reply-hint" className="max-w-[260px] text-[10px] leading-4 text-slate-400">{internal ? 'Internal notes are saved as team-only context.' : 'Replies are saved to this ticket’s conversation.'}</p><button className={internal ? 'btn-secondary !border-amber-200 !text-amber-800' : 'btn-primary'} disabled={send.isPending || !content.trim() || !author.trim()}>{send.isPending ? <Loader2 size={14} className="animate-spin" /> : internal ? <LockKeyhole size={14} /> : <Send size={14} />}{send.isPending ? 'Saving…' : internal ? 'Add note' : 'Add reply'}</button></div>
    </fieldset>
  </form>;
}
