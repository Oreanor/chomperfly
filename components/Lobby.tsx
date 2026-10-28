'use client';

import { WIN_DEFAULT, WIN_OPTIONS } from '@/lib/worm/constants';
import { useEffect, useRef, useState } from 'react';
import { BinIcon, Button, Field, IconButton, Input, Panel, Segmented, Select, Toast } from '@/components/ui';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { filterNameInput } from '@/lib/name';
import type { RoomInfo } from '@/lib/game/engine';

const FRUIT_NAMES: Record<string, I18nKey> = { apple: 'fruit.apple', pear: 'fruit.pear', peach: 'fruit.peach', pomegranate: 'fruit.pomegranate' };

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
  const [tab, setTab] = useState<'rooms' | 'create'>('rooms');
  const tabPicked = useRef(false); // the first room list decides the opening tab
  const [busy, setBusy] = useState(false);

  // the room list refreshes every 2 s
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/rooms')
        .then((r) => r.json())
        .then((list: RoomInfo[]) => {
          if (!alive) return;
          setRooms(list);
          // the lobby opens on the rooms if there are any, else on "create"
          if (!tabPicked.current) {
            tabPicked.current = true;
            setTab(list.length ? 'rooms' : 'create');
          }
        })
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
  // keys of the rooms made in this browser (the server hands one out on creation)
  const [roomKeys, setRoomKeys] = useState<Record<string, string>>({});
  useEffect(() => setRoomKeys(loadRoomKeys()), []);
  const closeRoom = async (id: string) => {
    const key = roomKeys[id];
    if (!key) return;
    const res = await fetch(`/api/rooms/${id}?key=${key}`, { method: 'DELETE' }).catch(() => null);
    if (res && (res.ok || res.status === 404)) {
      forgetRoomKey(id);
      setRoomKeys(loadRoomKeys());
      setRooms((list) => list.filter((r) => r.id !== id));
    }
  };
  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: roomName.trim() || t('lobby.defaultRoom', { name }), fruit, max: Number(max), win: Number(win) }),
      });
      if (res.ok) {
        const room = (await res.json()) as RoomInfo & { key?: string };
        if (room.key) saveRoomKey(room.id, room.key); // so it can be closed from the lobby later
        onJoin(room, Math.min(maxBots, Number(bots)));
      }
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
        {/* one panel, two tabs: "create a room" and the open rooms */}
        <Panel style={{ width: 'min(330px, 100%)', margin: '0 auto', padding: 16, fontSize: 14 }}>
          <div role="tablist" style={{ display: 'flex', gap: 18, marginBottom: 14, borderBottom: '1px solid var(--ui-border)' }}>
            {(['create', 'rooms'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '4px 0 10px',
                  marginBottom: -1,
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 16,
                  fontWeight: 700,
                  color: tab === k ? 'var(--ui-fg)' : 'var(--ui-fg-muted)',
                  borderBottom: `2px solid ${tab === k ? 'var(--ui-accent)' : 'transparent'}`,
                }}
              >
                {k === 'rooms' ? `${t('lobby.rooms')}${rooms.length ? ` (${rooms.length})` : ''}` : t('lobby.tabCreate')}
              </button>
            ))}
          </div>
          {/* both tabs in one cell: the panel keeps the height of the form; a long room list scrolls inside */}
          <div style={{ display: 'grid' }}>
            <div style={{ gridArea: '1 / 1', visibility: tab === 'create' ? 'visible' : 'hidden' }}>
              <form
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
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
            </div>
            <div style={{ gridArea: '1 / 1', position: 'relative', visibility: tab === 'rooms' ? 'visible' : 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
              {rooms.length === 0 ? (
                <div style={{ color: 'var(--ui-fg-muted)', padding: '18px 0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {t('lobby.empty')}
                  <Button size="sm" variant="primary" onClick={() => setTab('create')}>
                    {t('lobby.tabCreate')}
                  </Button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto 26px', columnGap: 8, rowGap: 8, alignItems: 'center' }}>
                  {rooms.map((r) => {
                    const full = r.players >= r.max;
                    return (
                      <div key={r.id} style={{ display: 'contents' }}>
                        {/* the name, and under it the map, the goal and who's in */}
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                          <span style={{ display: 'block', color: 'var(--ui-fg-muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {fruitLabel(r.fruit)} · 🏆 {r.win ?? WIN_DEFAULT} · {r.players}/{r.max}
                          </span>
                        </span>
                        <Button size="sm" variant={full ? 'secondary' : 'primary'} disabled={full} onClick={() => onJoin(r, 0)}>
                          {full ? t('lobby.full') : t('lobby.join')}
                        </Button>
                        {/* my rooms (I made them here): a bin to close them */}
                        {roomKeys[r.id] ? (
                          <Button size="sm" variant="ghost" title={t('lobby.close')} onClick={() => void closeRoom(r.id)} style={{ padding: '0 4px', opacity: 0.55 }}>
                            <BinIcon />
                          </Button>
                        ) : (
                          <span />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            </div>
          </div>
        </Panel>
      </div>
      {notice && <Toast style={{ position: 'absolute', left: '50%', top: 16, transform: 'translateX(-50%)' }}>{t(`notice.${notice}`)}</Toast>}
    </div>
  );
}

const KEYS = 'wormRoomKeys';

function loadRoomKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEYS) || '{}');
  } catch {
    return {};
  }
}

function saveRoomKey(id: string, key: string) {
  try {
    localStorage.setItem(KEYS, JSON.stringify({ ...loadRoomKeys(), [id]: key }));
  } catch {}
}

function forgetRoomKey(id: string) {
  try {
    const keys = loadRoomKeys();
    delete keys[id];
    localStorage.setItem(KEYS, JSON.stringify(keys));
  } catch {}
}
