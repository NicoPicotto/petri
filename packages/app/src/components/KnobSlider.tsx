import { useEffect, useState } from 'react';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  /** Se llama una sola vez al soltar el control, para no llenar el log de cambios intermedios. */
  onCommit: (value: number) => void;
}

export function KnobSlider({ label, value, min, max, step, format, onCommit }: Props) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  // Si el valor cambia desde afuera (reset, importar), el control lo refleja.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  return (
    <label className="knob">
      <span className="knob-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => {
          setEditing(true);
          setDraft(Number(e.target.value));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => editing && commit()}
      />
      <span className="knob-value">{format(draft)}</span>
    </label>
  );
}
