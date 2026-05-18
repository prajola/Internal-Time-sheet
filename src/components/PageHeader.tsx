import { ReactNode } from "react";

interface Props {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}

/**
 * Consistent page header for top-level admin and employee pages.
 * Title on the left, optional action buttons on the right.
 */
export function PageHeader({ eyebrow, title, description, actions, icon }: Props) {
  return (
    <header className="ko-fade-in-up flex items-end justify-between gap-4 flex-wrap mb-6">
      <div className="min-w-0 flex items-start gap-3">
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-700 flex-shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="ko-eyebrow mb-1">{eyebrow}</div>}
          <h1 className="ko-h1">{title}</h1>
          {description && (
            <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}
