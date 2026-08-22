import { useEffect, type ReactNode } from 'react';

/** A centred card over a dimmed page. Click outside or press Escape to close. */
export function Modal({
  children,
  onClose,
  tone,
  wide,
  dim,
}: {
  children: ReactNode;
  onClose?: (() => void) | undefined;
  tone?: 'accent' | 'rare' | undefined;
  wide?: boolean | undefined;
  /** Heavier backdrop for the recap that wants full attention. */
  dim?: boolean | undefined;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={dim ? 'overlay dim' : 'overlay'} onClick={onClose} role="presentation">
      <div
        className={`modal${tone ? ` ${tone}` : ''}${wide ? ' wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
