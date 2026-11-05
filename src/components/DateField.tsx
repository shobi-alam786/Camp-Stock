import React from 'react';
import { todayText } from '../utils/form.ts';
import { inputClass } from './LinesEditor.tsx';

interface Props {
  label: string;
  value: string;                 // yyyy-MM-dd
  onChange: (v: string) => void;
  /** allow future dates (default: no, stock dates cannot be in the future) */
  allowFuture?: boolean;
}

/** Date input that opens the calendar popup when it is clicked. Value is always yyyy-MM-dd. */
export function DateField({ label, value, onChange, allowFuture }: Props) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-600">{label}</label>
      <input
        type="date"
        value={value}
        max={allowFuture ? undefined : todayText()}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* already open */ } }}
        className={`${inputClass} cursor-pointer`}
      />
    </div>
  );
}
