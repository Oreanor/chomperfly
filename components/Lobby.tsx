'use client';

import { WIN_DEFAULT, WIN_OPTIONS } from '@/lib/worm/constants';
import { useEffect, useState } from 'react';
import { Button, Field, IconButton, Input, Panel, Segmented, Select, Toast } from '@/components/ui';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { filterNameInput } from '@/lib/name';
import type { RoomInfo } from '@/lib/game/engine';

const FRUIT_NAMES: Record<string, I18nKey> = { apple: 'fruit.apple', pear: 'fruit.pear', peach: 'fruit.peach' };

/** "Яблоко" for apple; unknown maps get their file name capitalised. */
export function useFruitLabel() {
  const { t } = useI18n();
  return (f: string) => (FRUIT_NAMES[f] ? t(FRUIT_NAMES[f]) : f.charAt(0).toUpperCase() + f.slice(1));
}

type Props = {
  name: string;
  notice: '' | 'noroom' | 'full'; // why we came back from a room
  onJoin: (room: RoomInfo, bots: number) => void;
  onSettings: () => void;
};

/** Room list + "create room" (map, max players, bots). */
export default function Lobby({ name, notice, onJoin, onSettings }: Props) {
  const { t } = useI18n();
  const fruitLabel = useFruitLabel();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [fruits, setFruits] = useState<string[]>([]);
  const [roomName, setRoomName] = useState('');
  const [fruit, setFruit] = useState('');
  const [max, setMax] = useState('4');
  const [bots, setBots] = useState('0');
  const [win, setWin] = useState(String(WIN_DEFAULT));
  const [busy, setBusy] = useState(false);

  // the room list refreshes every 2 s
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/rooms')
        .then((r) => r.json())
        .then((list: RoomInfo[]) => alive && setRooms(list))
        .catch(() => {});
    load();
    const id = setInterval(load, 2000);
    fetch('/api/fruits')
      .then((r) => r.json())
      .then((list: string[]) => {
        if (!alive) return;
        setFruits(list);
        setFruit((f) => f || list[0] || '');
      })
      .catch(() => {});
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const maxBots = Number(max) - 1;
  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: roomName.trim() || t('lobby.defaultRoom', { name }), fruit, max: Number(max), win: Number(win) }),
      });
      if (res.ok) onJoin((await res.json()) as RoomInfo, Math.min(maxBots, Number(bots)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: 16, overflow: 'auto' }}>
      <h1 style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{t('lobby.title')}</h1>
      <div style={{ position: 'absolute', right: 16, top: 16 }}>
        <IconButton label={t('settings.title')} onClick={onSettings}>
          ⚙
        </IconButton>
      </div>
      <div className="lobbySheet">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* create a room */}
          <Panel style={{ flex: '1 1 280px', padding: 16, fontSize: 14 }}>
            <form
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 16 }}>{t('lobby.create')}</div>
              <Field label={t('lobby.roomName')}>
                <Input value={roomName} maxLength={24} placeholder={t('lobby.defaultRoom', { name })} onChange={(e) => setRoomName(filterNameInput(e.target.value).slice(0, 24))} />
              </Field>
              <Field inline label={t('reset.fruit')}>
                <Select value={fruit} onChange={(e) => setFruit(e.target.value)} options={fruits.map((f) => ({ value: f, label: fruitLabel(f) }))} />
              </Field>
              <Field inline label={t('lobby.max')}>
                <Segmented value={max} options={['2', '3', '4', '6', '8'].map((n) => ({ value: n, label: n }))} onChange={setMax} />
              </Field>
              <Field inline label={t('lobby.win')}>
                <Segmented value={win} options={WIN_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))} onChange={setWin} />
              </Field>
              <Field inline label={t('reset.bots')}>
                <Segmented
                  value={String(Math.min(maxBots, Number(bots)))}
                  options={['0', '1', '2', '3'].filter((n) => Number(n) <= maxBots).map((n) => ({ value: n, label: n }))}
                  onChange={setBots}
                />
              </Field>
              <Button type="submit" variant="primary" disabled={busy || !fruit}>
                {t('lobby.createGo')}
              </Button>
            </form>
          </Panel>

          {/* open rooms */}
          <Panel style={{ flex: '1 1 340px', padding: 16, fontSize: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>{t('lobby.rooms')}</div>
            {rooms.length === 0 ? (
              <div style={{ color: 'var(--ui-fg-muted)', padding: '18px 0' }}>{t('lobby.empty')}</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto auto', columnGap: 12, rowGap: 8, alignItems: 'center' }}>
                {rooms.map((r) => {
                  const full = r.players >= r.max;
                  return (
                    <div key={r.id} style={{ display: 'contents' }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      <span style={{ color: 'var(--ui-fg-muted)' }}>{fruitLabel(r.fruit)}</span>
                      <span style={{ color: 'var(--ui-fg-muted)', fontVariantNumeric: 'tabular-nums' }}>🏆 {r.win ?? WIN_DEFAULT}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {r.players}/{r.max}
                      </span>
                      <Button size="sm" variant={full ? 'secondary' : 'primary'} disabled={full} onClick={() => onJoin(r, 0)}>
                        {full ? t('lobby.full') : t('lobby.join')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </div>
      {notice && <Toast style={{ position: 'absolute', left: '50%', top: 16, transform: 'translateX(-50%)' }}>{t(`notice.${notice}`)}</Toast>}
    </div>
  );
}
