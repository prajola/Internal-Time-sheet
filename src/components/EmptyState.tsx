import { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  size?: "sm" | "md" | "lg";
}

export function EmptyState({ icon, title, description, action, size = "md" }: Props) {
  const pad = size === "sm" ? "py-8" : size === "lg" ? "py-16" : "py-12";
  const iconBox = size === "sm" ? "w-10 h-10" : size === "lg" ? "w-14 h-14" : "w-12 h-12";
  const iconSize = size === "sm" ? 18 : size === "lg" ? 24 : 20;

  return (
    <div className={"flex flex-col items-center text-center px-6 " + pad + " ko-fade-in"}>
      <div className={iconBox + " rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 mb-3"}>
        {/* clone icon with size prop if possible — otherwise just render */}
        {wrapIcon(icon, iconSize)}
      </div>
      <h3 className={"font-semibold text-gray-900 " + (size === "lg" ? "text-lg" : "text-base")}>
        {title}
      </h3>
      {description && (
        <p className="text-[13px] text-gray-500 mt-1.5 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// If consumers pass a Lucide icon, the size prop is already on the element.
// This is just a safe pass-through.
function wrapIcon(icon: ReactNode, _size: number): ReactNode {
  return icon;
}
