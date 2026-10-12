import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// Explicit disclosure: Tab focus never opens help. Native buttons provide Enter/Space activation.
export function ReviewHelp({ topic, children }: { topic: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    // The removed Close control returns focus to its stable trigger without opening it.
    trigger.current?.focus();
  };
  return (
    <span
      className="review-help"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          close();
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        className="help-trigger"
        aria-label={'Help: ' + topic}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        ref={trigger}
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>
      {open && (
        <span id={id} role="note" className="help-content">
          <strong>{topic}</strong> {children}
          <button type="button" className="secondary" onClick={close}>
            Close help
          </button>
        </span>
      )}
    </span>
  );
}
