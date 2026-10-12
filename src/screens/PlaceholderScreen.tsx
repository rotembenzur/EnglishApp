import { t } from '@/i18n/he';

export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-4 px-4 pt-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="card p-5 text-ink-2">{t.common.soon}</div>
    </section>
  );
}
