import type { ReactNode } from "react";

const openKeys = new Set([" ", "Enter", "ArrowDown", "ArrowUp"]);

type PlaygroundSelectProps = {
  children: ReactNode;
  className: string;
  label: string;
  lockId: string;
  onLockChange: (lockId: string, active: boolean) => void;
  onValueChange: (value: string) => void;
  value: string | number;
};

export function PlaygroundSelect({
  children,
  className,
  label,
  lockId,
  onLockChange,
  onValueChange,
  value
}: PlaygroundSelectProps) {
  const setOpen = (active: boolean) => onLockChange(lockId, active);

  return (
    <label className={className}>
      <span>{label}</span>
      <select
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onValueChange(event.currentTarget.value);
          setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          } else if (openKeys.has(event.key)) {
            setOpen(true);
          }
        }}
        onPointerDown={() => setOpen(true)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}
