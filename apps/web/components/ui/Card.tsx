import clsx from "clsx";
import type { HTMLAttributes } from "react";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("glass-panel rounded-xl", className)} {...rest} />;
}

export function GlassInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "w-full glass-input rounded-md px-4 py-3 font-body text-sm text-on-surface placeholder-on-surface-variant/50",
        props.className
      )}
    />
  );
}

export function GlassTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        "w-full glass-input rounded-md px-4 py-3 font-body text-sm text-on-surface placeholder-on-surface-variant/50",
        props.className
      )}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block font-mono-data text-[11px] tracking-widest uppercase text-on-surface-variant mb-2">
      {children}
    </label>
  );
}
