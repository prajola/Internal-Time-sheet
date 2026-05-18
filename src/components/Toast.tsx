import { createContext, useCallback, useContext, useState, ReactNode } from "react";

type Tone = "ok" | "err" | "info";
interface Toast { id: number; tone: Tone; text: string; }
interface Ctx {
  push: (text: string, tone?: Tone) => void;
  ok: (text: string) => void;
  err: (text: string) => void;
}
const Ctx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = "info") => {
    const id = Math.random();
    setList((l) => [...l, { id, tone, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4500);
  }, []);
  const ok = useCallback((t: string) => push(t, "ok"), [push]);
  const err = useCallback((t: string) => push(t, "err"), [push]);

  return (
    <Ctx.Provider value={{ push, ok, err }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
        {list.map((t) => (
          <div
            key={t.id}
            className={
              "px-4 py-3 rounded-md text-sm border bg-white shadow-[0_4px_12px_rgba(16,24,40,0.08)] " +
              (t.tone === "ok"  ? "border-brand-300 text-brand-800"
              : t.tone === "err" ? "border-red-200 text-red-700"
              :                    "border-gray-200 text-gray-700")
            }
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
