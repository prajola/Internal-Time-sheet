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
              "px-4 py-3 rounded-md text-sm border shadow-soft backdrop-blur bg-black/70 " +
              (t.tone === "ok"  ? "border-brand-400/50 text-brand-100"
              : t.tone === "err" ? "border-red-400/50 text-red-200"
              :                    "border-white/15 text-white/80")
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
