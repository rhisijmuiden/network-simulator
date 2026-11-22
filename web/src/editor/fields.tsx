import { useEffect, useState, type ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/**
 * Text input that commits on Enter or blur (one undo step per edit, not per keystroke).
 * `parse` returns the value to commit, or undefined when the text is invalid.
 */
export function CommitInput<T>({
  value,
  parse,
  onCommit,
  placeholder,
  className,
  disabled,
  mono,
  ariaLabel,
}: {
  value: string;
  parse: (text: string) => T | undefined;
  onCommit: (v: T) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  mono?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value);
    setBad(false);
  }, [value]);
  const commit = () => {
    if (text === value) return setBad(false);
    const v = parse(text);
    if (v === undefined) return setBad(true);
    setBad(false);
    onCommit(v);
  };
  return (
    <input
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={bad}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          setBad(false);
        }
      }}
      className={cx(
        "w-full rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted/60 focus:outline-none disabled:opacity-60",
        bad ? "border-bad focus:border-bad" : "border-line focus:border-koraal",
        mono && "font-mono text-xs",
        className,
      )}
    />
  );
}

export function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
      </div>
    </div>
  );
}

export function SmallSelect({ value, onChange, children, disabled, ariaLabel }: { value: string; onChange: (v: string) => void; children: ReactNode; disabled?: boolean; ariaLabel?: string }) {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-koraal focus:outline-none disabled:opacity-60"
    >
      {children}
    </select>
  );
}

export function Section({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted">{title}</h3>
        {actions}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function MiniTable({ head, rows, empty }: { head: ReactNode[]; rows: ReactNode[][]; empty?: ReactNode }) {
  if (!rows.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface text-[10px] uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-2 py-1.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line font-mono">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="whitespace-nowrap px-2 py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IconButton({ title, onClick, children, danger, disabled }: { title: string; onClick: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cx("rounded p-1 text-muted transition disabled:opacity-40", danger ? "hover:bg-bad/10 hover:text-bad" : "hover:bg-line/60 hover:text-ink")}
    >
      {children}
    </button>
  );
}
