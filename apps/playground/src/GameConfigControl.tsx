import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { normalizeGameConfigValue, type GameConfigVar } from "@motion-levels-games/game-sdk";

type GameConfigControlProps = {
  configVar: GameConfigVar;
  onChange: (value: unknown) => void;
  value: unknown;
};

export function GameConfigControl({ configVar, onChange, value }: GameConfigControlProps) {
  if (configVar.type === "bool") {
    return (
      <label className="setting-control setting-control-bool" data-setting-key={configVar.key}>
        <ConfigVarLabel configVar={configVar} />
        <input
          aria-describedby={configDescriptionId(configVar)}
          aria-label={configVar.label}
          checked={value === true}
          onChange={(event) => onChange(event.currentTarget.checked)}
          type="checkbox"
        />
      </label>
    );
  }

  if (configVar.type === "enum") {
    return (
      <label className="setting-control" data-setting-key={configVar.key}>
        <ConfigVarLabel configVar={configVar} />
        <select
          aria-describedby={configDescriptionId(configVar)}
          aria-label={configVar.label}
          onChange={(event) => onChange(event.currentTarget.value)}
          value={String(value ?? configVar.default ?? configVar.options?.[0]?.value ?? "")}
        >
          {(configVar.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label ?? option.value}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return <NumberConfigControl configVar={configVar} onChange={onChange} value={value} />;
}

function NumberConfigControl({ configVar, onChange, value }: GameConfigControlProps) {
  const numericValue = Number(value ?? configVar.default ?? configVar.min ?? 0);
  const hasRange = typeof configVar.min === "number" && typeof configVar.max === "number";
  const [draftValue, setDraftValue] = useState(() => formatNumericInput(numericValue));
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) {
      setDraftValue(formatNumericInput(numericValue));
    }
  }, [numericValue]);

  const updateDraft = (nextDraft: string) => {
    const normalized = nextDraft.replaceAll(",", ".");
    if (!/^-?\d*(?:\.\d*)?$/.test(normalized)) {
      return;
    }

    setDraftValue(normalized);
    if (normalized !== "" && normalized !== "-" && normalized !== "." && normalized !== "-.") {
      onChange(normalized);
    }
  };

  const finishEditing = () => {
    editingRef.current = false;
    const parsed = Number(draftValue);
    const fallback = typeof configVar.default === "number" ? configVar.default : configVar.min ?? 0;
    const nextValue = normalizeGameConfigValue(configVar, Number.isFinite(parsed) ? parsed : fallback);
    onChange(nextValue);
    setDraftValue(formatNumericInput(Number(nextValue)));
  };

  return (
    <label className="setting-control setting-control-number" data-setting-key={configVar.key}>
      <ConfigVarLabel configVar={configVar} />
      <div className="setting-number-row">
        {hasRange ? (
          <input
            aria-describedby={configDescriptionId(configVar)}
            aria-label={configVar.label}
            max={configVar.max}
            min={configVar.min}
            onChange={(event) => {
              onChange(event.currentTarget.value);
              setDraftValue(formatNumericInput(Number(event.currentTarget.value)));
            }}
            step={configVar.step ?? (configVar.type === "int" ? 1 : "any")}
            type="range"
            value={String(numericValue)}
          />
        ) : null}
        <input
          aria-describedby={configDescriptionId(configVar)}
          aria-label={configVar.label}
          className="setting-number-input"
          inputMode={configVar.type === "int" ? "numeric" : "decimal"}
          onBlur={finishEditing}
          onChange={(event) => updateDraft(event.currentTarget.value)}
          onFocus={() => {
            editingRef.current = true;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          pattern={configVar.type === "int" ? "-?[0-9]*" : "-?[0-9]*[.]?[0-9]*"}
          spellCheck={false}
          type="text"
          value={draftValue}
        />
      </div>
    </label>
  );
}

function ConfigVarLabel({ configVar }: { configVar: GameConfigVar }) {
  return (
    <span className="setting-label">
      <span>{configVar.label}</span>
      <span
        className={`setting-exposure ${configVar.playerFacing ? "is-player-facing" : "is-internal"}`}
        title={configVar.playerFacing ? "Available to players in the venue menu" : "Operator and developer setting"}
      >
        {configVar.playerFacing ? "Player" : "Internal"}
      </span>
      {configVar.description ? (
        <span
          aria-describedby={configDescriptionId(configVar)}
          aria-label={`About ${configVar.label}`}
          className="setting-info"
          onClick={(event) => {
            event.preventDefault();
            event.currentTarget.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.currentTarget.focus();
            }
          }}
          role="button"
          tabIndex={0}
          title={configVar.description}
        >
          <Info aria-hidden="true" size={13} strokeWidth={2.4} />
          <span className="setting-tooltip" id={configDescriptionId(configVar)} role="tooltip">
            {configVar.description}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function configDescriptionId(configVar: GameConfigVar): string | undefined {
  return configVar.description ? `setting-${configVar.key}-description` : undefined;
}

function formatNumericInput(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}
