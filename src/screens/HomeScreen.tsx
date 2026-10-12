import { t } from '@/i18n/he';

export function HomeScreen() {
  return (
    <section className="flex flex-col gap-5 px-4 pb-8 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.app.name}</h1>
        <span className="rounded-pill bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
          {t.common.soon}
        </span>
      </header>
      <div className="card p-5">
        <h2 className="text-xl font-bold">{t.home.comingSoon}</h2>
        <p className="mt-2 text-ink-2">{t.home.comingSoonBody}</p>
      </div>
      <div className="card p-5">
        <h3 className="font-bold">{t.home.install}</h3>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-ink-2">
          {t.home.installSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
      <p className="text-center text-xs text-ink-3">{t.app.tagline}</p>
    </section>
  );
}
