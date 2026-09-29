/** Month ↔ Year toggle shared by both planner pages. */
import { CalendarDays, LayoutGrid } from "lucide-react";

export type PlannerView = "month" | "year";

export function ViewSwitch({ view, onChange }: { view: PlannerView; onChange: (v: PlannerView) => void }) {
  const options: Array<{ value: PlannerView; label: string; icon: React.ReactNode }> = [
    { value: "month", label: "Month", icon: <CalendarDays size={12} /> },
    { value: "year", label: "Year", icon: <LayoutGrid size={12} /> },
  ];
  return (
    <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            "h-8 px-2.5 rounded-md text-[12px] font-medium transition inline-flex items-center gap-1.5 " +
            (view === o.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800")
          }
        >
          {o.icon} {o.label}
        </button>
      ))}
    </div>
  );
}
