import Link from "next/link";

// Tela cheia simples para erros e páginas inexistentes, no visual do login.
export function StatusScreen({
  code,
  title,
  message,
  action,
}: {
  code: string;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-8">
      <div className="login-card w-full max-w-sm border bg-white p-9 text-center">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-glyph">&lt;/&gt;</span>
          </span>
          <span className="brand-copy text-left"><span className="brand-name">NovaCRM</span><span className="brand-byline">by Kodexx</span></span>
        </div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-faint)]">{code}</p>
        <h1 className="mb-2 text-xl font-semibold">{title}</h1>
        <p className="mb-8 text-sm text-[var(--text-faint)]">{message}</p>
        <div className="flex flex-col gap-3">
          {action}
          <Link href="/dashboard" className="text-xs">Ir para o início</Link>
        </div>
      </div>
    </div>
  );
}
