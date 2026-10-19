import Link from "next/link";

// Moldura das páginas públicas (privacidade e termos), acessíveis sem login.
export function LegalPage({ title, updatedAt, children }: { title: string; updatedAt: string; children: React.ReactNode }) {
  return (
    <div className="login-shell min-h-screen px-4 py-10">
      <article className="login-card mx-auto w-full max-w-2xl border bg-white p-8 text-sm leading-relaxed text-[var(--text)] sm:p-10">
        <Link href="/login" className="mb-8 flex items-center gap-3">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-glyph">&lt;/&gt;</span>
          </span>
          <span className="brand-copy"><span className="brand-name">NovaCRM</span><span className="brand-byline">by Kodexx</span></span>
        </Link>
        <h1 className="mb-1 text-2xl font-semibold">{title}</h1>
        <p className="mb-8 text-xs text-[var(--text-faint)]">Última atualização: {updatedAt}</p>
        <div className="legal-body space-y-4 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>
        <p className="mt-10 text-xs text-[var(--text-faint)]">
          <Link href="/privacidade">Política de Privacidade</Link> · <Link href="/termos">Termos de Uso</Link> · <Link href="/login">Entrar</Link>
        </p>
      </article>
    </div>
  );
}
