import { Spinner } from "@/components/ui/SubmitButton";
const inputClass =
  "h-14 rounded-2xl border border-line-strong bg-inset px-4 text-[17px] text-fg outline-none placeholder:text-fg-3 focus:border-lime";

export function PasswordField({
  id,
  label,
  autoComplete,
  autoFocus,
  error,
  type = "password",
  hint,
  defaultValue,
}: {
  id: string;
  label: string;
  autoComplete: string;
  autoFocus?: boolean;
  error?: string;
  type?: "password" | "text";
  hint?: string;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        autoFocus={autoFocus}
        defaultValue={defaultValue}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "form-error" : hint ? `${id}-hint` : undefined}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-[12px] text-fg-2">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p id="form-error" role="alert" className="text-sm text-danger">
      {error}
    </p>
  );
}

export function SubmitButton({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-lime text-[16px] font-semibold text-lime-ink"
    >
      {pending && <Spinner />}
      {pending ? pendingLabel : label}
    </button>
  );
}
