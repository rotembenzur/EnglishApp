import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  answerPlacement,
  levelOf,
  needsVerification,
  nextPlacementDifficulty,
  placementResult,
  posteriorStats,
  startPlacement,
  PLACEMENT_MAX_ITEMS,
  type PlacementAnswer,
  type PlacementState,
} from '@/engine/ability';
import { createRng, shuffle } from '@/engine/rng';
import { loadInventory } from '@/content/inventory';
import { addEvent, saveProfile } from '@/data/repo';
import { t } from '@/i18n/he';
import { useApp } from '@/state/app';
import { unlockAudio } from '@/audio/speech';
import { Bar, Button, En, Speak } from '@/ui/kit';
import { CloseIcon } from '@/ui/icons';

interface BankItem {
  id: number;
  lemma: string;
  pos: string;
  d: number;
  he: string;
}

const BASE = import.meta.env.BASE_URL;

export function Placement() {
  const nav = useNavigate();
  const profile = useApp((s) => s.profile);
  const setProfile = useApp((s) => s.setProfile);
  const [bank, setBank] = useState<BankItem[] | null>(null);
  const [stage, setStage] = useState<'intro' | 'item' | 'check' | 'result'>('intro');
  const [state, setState] = useState<PlacementState>(() => startPlacement());
  const [current, setCurrent] = useState<BankItem | null>(null);
  const [pending, setPending] = useState<PlacementAnswer | null>(null);
  const [checkPicked, setCheckPicked] = useState<number | null>(null);
  const [knownCount, setKnownCount] = useState(0);
  const used = useRef(new Set<number>());
  const rng = useMemo(() => createRng(Date.now() >>> 0), []);

  useEffect(() => {
    void fetch(`${BASE}content/placement.json`)
      .then((r) => r.json() as Promise<BankItem[]>)
      .then(setBank)
      .catch(() => setBank([]));
  }, []);

  const pickNext = (s: PlacementState) => {
    if (!bank) return null;
    const target = nextPlacementDifficulty(s);
    const candidates = bank
      .filter((b) => !used.current.has(b.id))
      .sort((a, b) => Math.abs(a.d - target) - Math.abs(b.d - target))
      .slice(0, 4);
    const choice = candidates[Math.floor(rng() * candidates.length)] ?? null;
    if (choice) used.current.add(choice.id);
    return choice;
  };

  const options = useMemo(() => {
    if (!current || !bank) return [];
    const others = shuffle(
      rng,
      bank.filter(
        (b) =>
          b.id !== current.id &&
          b.pos === current.pos &&
          b.he !== current.he &&
          Math.abs(b.d - current.d) < 30,
      ),
    ).slice(0, 3);
    return shuffle(rng, [current, ...others]);
  }, [current, bank, rng]);

  const begin = () => {
    unlockAudio();
    setCurrent(pickNext(state));
    setStage('item');
  };

  const commit = async (s: PlacementState) => {
    setState(s);
    if (s.done) {
      await finish(s);
      return;
    }
    const n = pickNext(s);
    if (!n) {
      await finish({ ...s, done: true });
      return;
    }
    setCurrent(n);
    setPending(null);
    setCheckPicked(null);
    setStage('item');
  };

  const answer = (a: PlacementAnswer) => {
    if (!current) return;
    if (needsVerification(state) && a !== 'dont') {
      setPending(a);
      setStage('check');
      return;
    }
    void commit(answerPlacement(state, { lemmaId: current.id, d: current.d, answer: a }));
  };

  const check = (id: number) => {
    if (!current || !pending || checkPicked !== null) return;
    setCheckPicked(id);
    const verified = id === current.id;
    window.setTimeout(() => {
      void commit(
        answerPlacement(state, { lemmaId: current.id, d: current.d, answer: pending, verified }),
      );
    }, 650);
  };

  const finish = async (s: PlacementState) => {
    if (!profile) return;
    const now = Date.now();
    const previous = profile.ability ?? undefined;
    const ability = placementResult(s, now, previous);
    const levelUp =
      !!previous &&
      levelOf(ability.theta).band !== levelOf(previous.theta).band &&
      ability.theta > previous.theta;
    const next = await saveProfile({
      ...profile,
      ability,
      thetaHistory: [...profile.thetaHistory, [now, ability.theta] as [number, number]],
    });
    setProfile(next);
    await addEvent({
      userId: profile.id,
      type: 'placement',
      payload: { theta: ability.theta, sigma: ability.sigma, levelUp, items: s.items.length },
    });
    const inv = await loadInventory();
    setKnownCount(
      Math.round(inv.lemmas.filter((l) => l.kind === 'word' && l.d < ability.theta).length / 10) *
        10,
    );
    setStage('result');
  };

  if (stage === 'intro') {
    return (
      <Frame onClose={profile?.ability ? () => nav(-1) : undefined}>
        <div className="flex flex-1 flex-col justify-center gap-6 text-center">
          <div className="text-6xl">🧭</div>
          <h1 className="text-3xl font-extrabold">{t.placement.introTitle}</h1>
          <p className="text-lg text-ink-2">{t.placement.introBody}</p>
        </div>
        <Button className="w-full text-lg" onClick={begin} disabled={!bank?.length}>
          {bank ? t.placement.start : t.common.loading}
        </Button>
      </Frame>
    );
  }

  if (stage === 'result' && profile?.ability) {
    const lvl = levelOf(profile.ability.theta);
    return (
      <Frame>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-ink-2">{t.placement.resultTitle}</p>
          <div className="animate-pop text-7xl font-black text-accent" dir="ltr">
            {lvl.band}
          </div>
          <Bar value={lvl.progress} max={1} className="w-48" />
          <p className="text-lg text-ink-2">
            {t.placement.resultBody(knownCount.toLocaleString('he-IL'))}
          </p>
          <p className="text-xs text-ink-3">{t.placement.retakeNote}</p>
        </div>
        <Button className="w-full text-lg" onClick={() => nav('/', { replace: true })}>
          {t.placement.go}
        </Button>
      </Frame>
    );
  }

  const n = state.items.length;
  const { sd } = posteriorStats(state.posterior);
  return (
    <Frame onClose={() => nav(-1)}>
      <div className="flex items-center gap-3">
        <Bar
          value={n}
          max={Math.min(PLACEMENT_MAX_ITEMS, n + Math.max(3, Math.ceil(sd)))}
          className="flex-1"
        />
        <span className="text-xs text-ink-3">
          {t.placement.progress(n + 1, PLACEMENT_MAX_ITEMS)}
        </span>
      </div>
      {current && (
        <div
          key={current.id}
          className="flex flex-1 animate-fade-up flex-col items-center justify-center gap-6"
        >
          <div className="flex items-center gap-3">
            <En className="text-5xl font-bold">{current.lemma}</En>
            <Speak text={current.lemma} isWord />
          </div>
          {stage === 'check' && (
            <p className="text-lg font-semibold text-ink-2">{t.placement.checkTitle}</p>
          )}
        </div>
      )}
      {stage === 'item' ? (
        <div className="grid grid-cols-3 gap-3">
          <Button variant="outline" className="py-4" onClick={() => answer('dont')}>
            {t.placement.dont}
          </Button>
          <Button variant="soft" className="py-4" onClick={() => answer('unsure')}>
            {t.placement.unsure}
          </Button>
          <Button className="py-4" onClick={() => answer('know')}>
            {t.placement.know}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5">
          {options.map((o) => {
            const picked = checkPicked === o.id;
            const isRight = checkPicked !== null && o.id === current?.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => check(o.id)}
                className={`tap rounded-2xl border px-4 py-3.5 text-start text-lg font-medium transition ${
                  isRight
                    ? 'border-good bg-good-soft'
                    : picked
                      ? 'border-bad bg-bad-soft'
                      : 'border-line bg-card'
                }`}
              >
                {o.he}
              </button>
            );
          })}
        </div>
      )}
    </Frame>
  );
}

function Frame({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: (() => void) | undefined;
}) {
  return (
    <div
      className="mx-auto flex h-full max-w-md flex-col gap-6 px-5 pb-6"
      style={{
        paddingTop: 'calc(var(--sat) + 0.75rem)',
        paddingBottom: 'calc(var(--sab) + 1.25rem)',
      }}
    >
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="tap -ms-2 grid place-items-center self-start rounded-full text-ink-3"
        >
          <CloseIcon />
        </button>
      )}
      {children}
    </div>
  );
}
