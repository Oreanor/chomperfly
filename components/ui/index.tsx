'use client';

// Small UI kit: themed via CSS variables in app/globals.css.
import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import s from './ui.module.css';

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'sm';
};
export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx(s.btn, s[variant], size === 'sm' && s.sm, className)} {...rest} />;
}

export function IconButton({ label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" aria-label={label} title={label} className={cx(s.iconBtn, className)} {...rest} />;
}

export function Panel({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={cx(s.panel, className)} style={style}>
      {children}
    </div>
  );
}

type ModalProps = {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void; // omit to make the modal mandatory
  onSubmit?: () => void; // Enter submits
};
export function Modal({ open, title, children, footer, onClose, onSubmit }: ModalProps) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    // focus the first field
    const el = ref.current?.querySelector<HTMLElement>('input, button');
    el?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={s.modal}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <h2 className={s.modalTitle}>{title}</h2>
        <div className={s.modalBody}>{children}</div>
        {footer && <div className={s.modalFooter}>{footer}</div>}
      </form>
    </div>
  );
}

/** A labelled control. `inline` = label and control on one line, the control at its own width. */
export function Field({ label, children, inline }: { label: ReactNode; children: ReactNode; inline?: boolean }) {
  return (
    <label className={cx(s.field, inline && s.fieldInline)}>
      <span className={s.label}>{label}</span>
      {children}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={s.input} {...props} />;
}

export function Select({ options, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: ReactNode }[] }) {
  return (
    <select className={s.input} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className={s.segmented} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={cx(s.segment, o.value === value && s.segmentActive)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>;
}

export function Dot({ color }: { color: string }) {
  return <span className={s.dot} style={{ background: color }} />;
}

export function Toast({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className={s.toast} style={style} role="status">
      {children}
    </div>
  );
}
