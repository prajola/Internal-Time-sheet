import { useState } from "react";

export interface FilterValue {
  mode: "all" | "day" | "month" | "year" | "range";
  day?: string;       // YYYY-MM-DD
  month?: string;     // YYYY-MM
  year?: string;      // YYYY
  from?: string;      // ISO
  to?: string;        // ISO
}

export function buildQuery(f: FilterValue): string {
  const p = new URLSearchParams();
  if (f.mode === "day" && f.day) p.set("day", f.day);
  if (f.mode === "month" && f.month) p.set("month", f.month);
  if (f.mode === "year" && f.year) p.set("year", f.year);
  if (f.mode === "range") {
    if (f.from) p.set("from", new Date(f.from).toISOString());
    if (f.to) p.set("to", new Date(f.to).toISOString());
  }
  return p.toString();
}

interface Props {
  value: FilterValue;
  onChange: (v: FilterValue) => void;
  extra?: React.ReactNode;
}

export function Filters({ value, onChange, extra }: Props) {
  const [v, setV] = useState<FilterValue>(value);

  function update<K extends keyof FilterValue>(k: K, val: FilterValue[K]) {
    const next = { ...v, [k]: val };
    setV(next);
    onChange(next);
  }

  const modes: FilterValue["mode"][] = ["all", "day", "month", "year", "range"];

  return (
    <div className="ko-card p-4 flex flex-wrap items-end gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-white/45 mb-1">Range</div>
        <div className="inline-flex rounded-md border border-white/10 overflow-hidden">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => update("mode", m)}
              className={
                "px-3 py-1.5 text-xs " +
                (v.mode === m ? "bg-brand-500 text-black" : "text-white/65 hover:text-white hover:bg-white/5")
              }
            >
              {m === "all" ? "All" : m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {v.mode === "day" && (
        <Labeled label="Date">
          <input type="date" value={v.day || ""} onChange={(e) => update("day", e.target.value)} className="ko-input h-9 w-44" />
        </Labeled>
      )}
      {v.mode === "month" && (
        <Labeled label="Month">
          <input type="month" value={v.month || ""} onChange={(e) => update("month", e.target.value)} className="ko-input h-9 w-44" />
        </Labeled>
      )}
      {v.mode === "year" && (
        <Labeled label="Year">
          <input
            type="number"
            min={2000} max={2100}
            value={v.year || ""}
            onChange={(e) => update("year", e.target.value)}
            className="ko-input h-9 w-32"
            placeholder="2026"
          />
        </Labeled>
      )}
      {v.mode === "range" && (
        <>
          <Labeled label="From">
            <input type="date" value={(v.from || "").slice(0, 10)} onChange={(e) => update("from", e.target.value)} className="ko-input h-9 w-44" />
          </Labeled>
          <Labeled label="To">
            <input type="date" value={(v.to || "").slice(0, 10)} onChange={(e) => update("to", e.target.value)} className="ko-input h-9 w-44" />
          </Labeled>
        </>
      )}
      {extra ? <div className="ml-auto flex items-end gap-3">{extra}</div> : null}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-white/45 mb-1">{label}</div>
      {children}
    </div>
  );
}
