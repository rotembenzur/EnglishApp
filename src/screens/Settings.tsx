import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { rebuildWord } from '@/engine/learn';
import { clampCap, MAX_CAP, MIN_CAP } from '@/engine/selection';
import { db, deviceId, type UserSettings } from '@/data/db';
import {
  downloadBackup,
  exportAll,
  importAll,
  isExportFile,
  putWord,
  resetUser,
  saveProfile,
} from '@/data/repo';
import { englishVoices, loadVoices, playWord, unlockAudio } from '@/audio/speech';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { useTheme, type ThemeMode } from '@/state/theme';
import {
  DEFAULT_PROJECT,
  hashPassphrase,
  loadConfig,
  saveConfig,
  syncNow,
  testConfig,
  useSync,
} from '@/sync/engine';
import { optimizeFor } from '@/engine/optimizer';
import { Button, Header, Section, Sheet } from '@/ui/kit';
import { toast } from '@/ui/toast';
import { PinPad } from './PinGate';
import {
  disablePush,
  enablePush,
  loadPushPrefs,
  pushActive,
  pushAvailability,
  sendTestPush,
  updatePushPrefs,
  type PushAvailability,
  type PushPrefs,
} from '@/sync/push';
import { USER_NAMES } from '@/data/repo';

const TOPICS = [
  'family',
  'work',
  'travel',
  'food',
  'tech',
  'emotions',
  'health',
  'nature',
  'law',
  'finance',
  'academic',
  'slang',
];
const KINDS = ['phrasal', 'idiom', 'collocation'];
const SETUP_URL =
  'https://github.com/rotembenzur/EnglishApp/blob/claude/trusting-knuth-gbbnzv/SETUP.md';

export function Settings() {
  const nav = useNavigate();
  const loc = useLocation();
  const profile = useApp((s) => s.profile)!;
  const update = useApp((s) => s.updateSettings);
  const selectUser = useApp((s) => s.selectUser);
  const setProfile = useApp((s) => s.setProfile);
  const s = profile.settings;
  const mode = useTheme((x) => x.mode);
  const setMode = useTheme((x) => x.setMode);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [pinOpen, setPinOpen] = useState(false);
  const [resetStep, setResetStep] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadVoices().then(() => setVoices(englishVoices()));
  }, []);
  useEffect(() => {
    if (loc.hash === '#sync') document.getElementById('sync')?.scrollIntoView({ block: 'start' });
  }, [loc.hash]);

  const set = (patch: Partial<UserSettings>) => void update(patch);

  if (pinOpen) {
    return (
      <PinPad
        userId={profile.id}
        title={t.settings.pinSet}
        onCancel={() => setPinOpen(false)}
        onOk={async (pinHash) => {
          setProfile(await saveProfile({ ...profile, pinHash }));
          setPinOpen(false);
          toast('✓');
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      <Header title={t.settings.title} onBack={() => nav(-1)} />
      <div className="flex flex-col gap-7 px-4">
        <Section title={t.settings.profile}>
          <Row label={profile.name}>
            <Button
              variant="outline"
              className="py-2 text-sm"
              onClick={async () => {
                await selectUser(null);
                nav('/welcome', { replace: true });
              }}
            >
              {t.settings.switchUser}
            </Button>
          </Row>
        </Section>

        <Section title={t.settings.learning}>
          <Stepper
            label={t.settings.dailyGoal}
            value={s.dailyGoal}
            step={10}
            min={20}
            max={300}
            suffix=" XP"
            onChange={(v) => set({ dailyGoal: v })}
          />
          <Stepper
            label={t.settings.newPerDay}
            value={s.newPerDay}
            step={1}
            min={MIN_CAP}
            max={MAX_CAP}
            onChange={(v) => set({ newPerDay: clampCap(v) })}
          />
          <Stepper
            label={t.settings.retention}
            value={Math.round(s.retention * 100)}
            step={1}
            min={80}
            max={97}
            suffix="%"
            onChange={(v) => set({ retention: v / 100 })}
          />
          <div className="flex flex-col gap-2">
            <span className="text-sm text-ink-2">{t.settings.topics}</span>
            <Chips
              options={TOPICS.map((k) => [k, t.topics[k] ?? k])}
              selected={s.topics}
              onToggle={(k) =>
                set({
                  topics: s.topics.includes(k) ? s.topics.filter((x) => x !== k) : [...s.topics, k],
                })
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-ink-2">{t.settings.kinds}</span>
            <Chips
              options={KINDS.map((k) => [k, t.settings.kindNames[k] ?? k])}
              selected={KINDS.filter((k) => !s.disabledKinds.includes(k))}
              onToggle={(k) =>
                set({
                  disabledKinds: s.disabledKinds.includes(k)
                    ? s.disabledKinds.filter((x) => x !== k)
                    : [...s.disabledKinds, k],
                })
              }
            />
          </div>
        </Section>

        <Section title={t.settings.audio}>
          <Segmented
            options={[
              ['us', t.settings.accents.us],
              ['uk', t.settings.accents.uk],
            ]}
            value={s.accent}
            onChange={(v) => {
              const { voiceURI: _v, ...rest } = s;
              void update({
                ...rest,
                accent: v as 'us' | 'uk',
                voiceURI: undefined,
              } as Partial<UserSettings>);
            }}
          />
          <Row label={t.settings.voice}>
            <select
              value={s.voiceURI ?? ''}
              onChange={(e) =>
                set({ voiceURI: e.target.value || undefined } as Partial<UserSettings>)
              }
              className="max-w-48 rounded-xl bg-card-2 px-3 py-2 text-sm"
              aria-label={t.settings.voice}
            >
              <option value="">{t.settings.voiceAuto}</option>
              {voices
                .filter((v) => v.lang.toLowerCase().includes(s.accent === 'us' ? 'us' : 'gb'))
                .map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                  </option>
                ))}
            </select>
          </Row>
          <Row label={`${t.settings.speed} (${s.speechRate.toFixed(2)})`}>
            <input
              type="range"
              min={0.6}
              max={1.2}
              step={0.05}
              value={s.speechRate}
              onChange={(e) => set({ speechRate: Number(e.target.value) })}
              className="w-40 accent-[var(--c-accent)]"
              aria-label={t.settings.speed}
              dir="ltr"
            />
          </Row>
          <Toggle
            label={t.settings.autoplay}
            value={s.autoplay}
            onChange={(v) => set({ autoplay: v })}
          />
          <Toggle label={t.settings.sounds} value={s.sounds} onChange={(v) => set({ sounds: v })} />
          <Button
            variant="soft"
            onClick={() => {
              unlockAudio();
              void playWord(
                'Wonderful. This is how I sound.',
                {},
                {
                  accent: s.accent,
                  ...(s.voiceURI ? { voiceURI: s.voiceURI } : {}),
                  rate: s.speechRate,
                },
              );
            }}
          >
            🔊 {t.settings.test}
          </Button>
        </Section>

        <Section title={t.settings.appearance}>
          <Segmented
            options={(['auto', 'dark', 'light'] as ThemeMode[]).map((m) => [
              m,
              t.settings.themes[m],
            ])}
            value={mode}
            onChange={(v) => setMode(v as ThemeMode)}
          />
          <Toggle
            label={t.settings.largeText}
            value={s.largeText}
            onChange={(v) => set({ largeText: v })}
          />
        </Section>

        <Section title={t.settings.security}>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setPinOpen(true)}>
              {profile.pinHash ? t.settings.pinChange : t.settings.pinSet}
            </Button>
            {profile.pinHash && (
              <Button
                variant="ghost"
                onClick={async () => {
                  const { pinHash: _p, ...rest } = profile;
                  setProfile(await saveProfile(rest));
                }}
              >
                {t.settings.pinRemove}
              </Button>
            )}
          </div>
          <p className="text-xs text-ink-3">{t.settings.pinPrompt}</p>
        </Section>

        <Section title={t.settings.placement}>
          <Button variant="outline" onClick={() => nav('/placement')}>
            {t.settings.retake}
          </Button>
          <OptimizeButton />
        </Section>

        <SyncSection />

        <PushSection />

        <Section title={t.settings.data}>
          <Button variant="outline" onClick={() => void downloadBackup()}>
            ⬇️ {t.settings.export}
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            ⬆️ {t.settings.import}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const parsed: unknown = JSON.parse(await f.text());
                if (!isExportFile(parsed)) throw new Error('bad');
                const r = await importAll(parsed);
                await useApp.getState().reload();
                toast(t.settings.imported(r.words, r.reviews), { icon: '✓' });
              } catch {
                toast(t.settings.importBad, { tone: 'warn' });
              }
            }}
          />
          <Button
            variant="outline"
            onClick={async () => {
              const dev = await deviceId();
              const reviews = await db.reviews.where('userId').equals(profile.id).toArray();
              const words = await db.userWords.where('userId').equals(profile.id).toArray();
              let n = 0;
              for (const w of words) {
                const rebuilt = rebuildWord(profile.id, w.lemmaId, reviews, dev, w, {
                  retention: s.retention,
                  ...(profile.fsrsW ? { w: profile.fsrsW } : {}),
                });
                if (rebuilt) {
                  await putWord({
                    ...rebuilt,
                    firstSeenAt: w.firstSeenAt,
                    origin: w.origin,
                    updatedAt: Date.now(),
                  });
                  n++;
                }
              }
              await useApp.getState().reload();
              toast(t.settings.rebuilt(n));
            }}
          >
            🔧 {t.settings.rebuild}
          </Button>
          <Button variant="danger" onClick={() => setResetStep(1)}>
            {t.settings.reset}
          </Button>
        </Section>

        <p className="text-center text-xs text-ink-3">
          {t.settings.version} <span dir="ltr">{__APP_VERSION__}</span>
          {import.meta.env.DEV && (
            <>
              {' · '}
              <a href={`${import.meta.env.BASE_URL}dev/bidi`} className="underline">
                {t.settings.bidiTest}
              </a>
            </>
          )}
        </p>
      </div>

      <Sheet open={resetStep > 0} onClose={() => setResetStep(0)}>
        <p className="mb-5 text-lg font-semibold">
          {resetStep === 1 ? t.settings.resetConfirm1 : t.settings.resetConfirm2}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => setResetStep(0)}>
            {t.common.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (resetStep === 1) {
                await downloadBackup();
                setResetStep(2);
                return;
              }
              // A backup file was just produced; keep an in-database copy too.
              await db.kv.put({
                key: `backup:${profile.id}:${Date.now()}`,
                value: await exportAll(),
              });
              await resetUser(profile.id);
              setResetStep(0);
              await selectUser(profile.id);
              nav('/placement', { replace: true });
            }}
          >
            {t.settings.reset}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function SyncSection() {
  const status = useSync((s) => s.status);
  const error = useSync((s) => s.error);
  const configured = useSync((s) => s.configured);
  const [url, setUrl] = useState(DEFAULT_PROJECT.url);
  const [key, setKey] = useState(DEFAULT_PROJECT.anonKey);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadConfig().then((c) => {
      setUrl(c?.url ?? DEFAULT_PROJECT.url);
      setKey(c?.anonKey ?? DEFAULT_PROJECT.anonKey);
    });
  }, [configured]);
  const custom = url.trim() !== DEFAULT_PROJECT.url || key.trim() !== DEFAULT_PROJECT.anonKey;
  const statusLabel =
    status === 'syncing' ? t.settings.syncStatus.pending : t.settings.syncStatus[status];
  const connect = async () => {
    setBusy(true);
    const existing = await loadConfig();
    const keyHash = pass ? await hashPassphrase(pass) : (existing?.keyHash ?? '');
    const cfg = { url: url.trim(), anonKey: key.trim(), keyHash };
    const result = await testConfig(cfg);
    if (result === 'ok') {
      await saveConfig(cfg);
      setPass('');
      await syncNow();
      toast(t.settings.syncConnected, { icon: '🟢' });
    } else
      toast(
        result === 'passphrase'
          ? t.settings.syncWrongPass
          : result === 'network'
            ? t.settings.syncNoNetwork
            : t.settings.syncFailed,
        { tone: 'warn' },
      );
    setBusy(false);
  };
  return (
    <section id="sync" className="flex scroll-mt-16 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-3">{t.settings.sync}</h2>
        <span className="text-xs text-ink-2" data-testid="sync-status">
          {statusLabel}
        </span>
      </div>
      {error && (
        <p className="text-xs text-bad" dir="ltr">
          {error}
        </p>
      )}
      {!configured && <p className="text-sm text-ink-2">{t.settings.syncPassHint}</p>}
      <Field
        label={t.settings.syncPass}
        value={pass}
        onChange={setPass}
        type="password"
        placeholder={configured ? '••••••' : ''}
      />
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={busy || !url.trim() || !key.trim() || (!pass && !configured)}
          onClick={() => void connect()}
        >
          {t.settings.syncSave}
        </Button>
        {configured && (
          <Button variant="ghost" onClick={() => void saveConfig(null)}>
            {t.settings.syncDisconnect}
          </Button>
        )}
      </div>
      <details className="text-sm" open={custom}>
        <summary className="cursor-pointer text-ink-3">{t.settings.syncAdvanced}</summary>
        <div className="mt-2 flex flex-col gap-3">
          <Field
            label={t.settings.syncUrl}
            value={url}
            onChange={setUrl}
            placeholder="https://xxxx.supabase.co"
          />
          <Field
            label={t.settings.syncKey}
            value={key}
            onChange={setKey}
            placeholder="eyJhbGciOi..."
          />
        </div>
      </details>
      <a
        href={SETUP_URL}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-semibold text-accent"
      >
        {t.settings.syncHelp} ↗
      </a>
    </section>
  );
}

function PushSection() {
  const profile = useApp((x) => x.profile)!;
  const configured = useSync((x) => x.configured);
  const [availability, setAvailability] = useState<PushAvailability | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const rival = profile.id === 'rotem' ? 'noa' : 'rotem';

  useEffect(() => {
    let live = true;
    void Promise.all([pushAvailability(), loadPushPrefs(), pushActive()]).then(([a, p, on]) => {
      if (!live) return;
      setAvailability(a);
      setPrefs(p);
      setActive(on);
    });
    return () => {
      live = false;
    };
  }, [configured]);

  const change = (next: PushPrefs, delay = 0) => {
    setPrefs(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void updatePushPrefs(profile.id, next).then((ok) => {
        if (!ok) toast(t.settings.pushFailed, { tone: 'warn' });
      });
    }, delay);
  };

  const turnOn = () => {
    if (!prefs) return;
    setBusy(true);
    // Straight from the tap: iOS asks for permission only inside a user gesture.
    void enablePush(profile.id, prefs).then((result) => {
      setBusy(false);
      if (result === 'ok') {
        setActive(true);
        setPrefs({ ...prefs, enabled: true });
        toast(t.settings.pushEnabled, { icon: '🔔' });
      } else if (result === 'denied') {
        setAvailability(Notification.permission === 'denied' ? 'denied' : 'ready');
        toast(t.settings.pushDenied, { tone: 'warn' });
      } else toast(t.settings.pushFailed, { tone: 'warn' });
    });
  };

  const turnOff = () => {
    if (!prefs) return;
    setActive(false);
    setPrefs({ ...prefs, enabled: false });
    void disablePush();
  };

  return (
    <Section title={t.settings.notifications}>
      {availability === null || !prefs ? (
        <p className="text-sm text-ink-3">{t.settings.pushChecking}</p>
      ) : availability !== 'ready' ? (
        <p className="text-sm text-ink-3" data-testid="push-status">
          {t.settings.pushStatus[availability]}
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-2">{t.settings.pushHint}</p>
          <div aria-busy={busy}>
            <Toggle
              label={t.settings.pushOn}
              value={active}
              onChange={(v) => (v ? turnOn() : turnOff())}
            />
          </div>
          {active && (
            <>
              <Toggle
                label={t.settings.pushDaily}
                value={prefs.reminderTime !== null}
                onChange={(v) => change({ ...prefs, reminderTime: v ? '20:00' : null })}
              />
              {prefs.reminderTime !== null && (
                <Row label={t.settings.reminderTime}>
                  <input
                    type="time"
                    value={prefs.reminderTime}
                    onChange={(e) =>
                      e.target.value && change({ ...prefs, reminderTime: e.target.value }, 1200)
                    }
                    className="rounded-xl bg-card-2 px-3 py-2"
                    dir="ltr"
                  />
                </Row>
              )}
              <Toggle
                label={t.settings.pushStreak}
                value={prefs.streakAlert}
                onChange={(v) => change({ ...prefs, streakAlert: v })}
              />
              <Toggle
                label={t.settings.pushNudges(USER_NAMES[rival])}
                value={prefs.nudges}
                onChange={(v) => change({ ...prefs, nudges: v })}
              />
              <Button
                variant="outline"
                onClick={() =>
                  void sendTestPush(profile.id).then((r) =>
                    r.ok
                      ? toast(t.settings.pushTestSent, { icon: '🔔' })
                      : toast(t.settings.pushTestFailed(r.detail), { tone: 'warn', ms: 8000 }),
                  )
                }
              >
                🔔 {t.settings.pushTest}
              </Button>
            </>
          )}
        </>
      )}
    </Section>
  );
}

function OptimizeButton() {
  const profile = useApp((s) => s.profile)!;
  const setProfile = useApp((s) => s.setProfile);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const reviews = await db.reviews.where('userId').equals(profile.id).toArray();
        const w = optimizeFor(reviews);
        if (w) {
          setProfile(await saveProfile({ ...profile, fsrsW: w, fsrsOptimizedAt: Date.now() }));
          toast(t.settings.fsrsOptimized, { icon: '✓' });
        } else toast(t.settings.fsrsNotEnough);
        setBusy(false);
      }}
    >
      ⚙️ {t.settings.fsrsOptimize}
    </Button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card flex min-h-14 items-center justify-between gap-3 px-4 py-2">
      <span className="font-medium">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row label={label}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-8 w-14 rounded-pill transition ${value ? 'bg-accent' : 'bg-line'}`}
      >
        <span
          className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${value ? 'start-7' : 'start-1'}`}
        />
      </button>
    </Row>
  );
}

function Stepper({
  label,
  value,
  step,
  min,
  max,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-2" dir="ltr">
        <button
          type="button"
          aria-label="פחות"
          className="tap grid h-10 w-10 place-items-center rounded-full bg-card-2 text-xl"
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </button>
        <span className="min-w-16 text-center font-bold">
          {value}
          {suffix}
        </span>
        <button
          type="button"
          aria-label="יותר"
          className="tap grid h-10 w-10 place-items-center rounded-full bg-card-2 text-xl"
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </button>
      </div>
    </Row>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="card flex gap-1 p-1">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`tap flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${value === k ? 'bg-accent text-accent-ink' : 'text-ink-2'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Chips({
  options,
  selected,
  onToggle,
}: {
  options: [string, string][];
  selected: string[];
  onToggle: (k: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onToggle(k)}
          aria-pressed={selected.includes(k)}
          className={`rounded-pill px-3 py-2 text-sm font-semibold ${selected.includes(k) ? 'bg-accent text-accent-ink' : 'bg-card text-ink-2 shadow-card'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-3">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        dir="ltr"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="rounded-xl border border-line bg-card px-3 py-3 outline-none focus:border-accent"
      />
    </label>
  );
}
