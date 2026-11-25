'use client';

import { WIN_DEFAULT, WIN_OPTIONS } from '@/lib/worm/constants';
import { useEffect, useRef, useState } from 'react';
import { BinIcon, Button, Field, IconButton, Input, Panel, Select, Toast } from '@/components/ui';
import HuePicker from '@/components/HuePicker';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { cleanName, filterNameInput, NAME_MAX } from '@/lib/name';
import { withBase } from '@/lib/paths';
import { LEVELS, type LevelName } from '@/lib/worm/levels';
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
  /** Join a room (with this many bots, at this level: bots are only added by the room's creator). */
  onJoin: (room: RoomInfo, bots: number, level?: LevelName) => void;
  onSettings: () => void;
  onName: (name: string) => void;
  hue: number; // the worm's colour
  onHue: (hue: number) => void;
};

const MAX_OPTIONS = ['2', '3', '4', '5', '6', '7', '8'];
const ROW_H = 40; // a room in the list
const LEVEL_KEY = 'wormBotLevel'; // the level last picked
const COMPACT = 'lobbyCompact'; // the small selects (app/globals.css)
const KEYS = 'wormRoomKeys'; // the rooms I made: id → the key that closes them

function roomKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEYS) || '{}');
  } catch {
    return {};
  }
}

function saveRoomKey(id: string, key: string) {
  try {
    localStorage.setItem(KEYS, JSON.stringify({ ...roomKeys(), [id]: key }));
  } catch {}
}

function forgetRoomKey(id: string) {
  try {
    const k = roomKeys();
    delete k[id];
    localStorage.setItem(KEYS, JSON.stringify(k));
  } catch {}
}

/** Your name and colour, a new room (mode, goal / lives, fruit size, fruit, players, bots, level) and the room list. */
export default function Lobby({ name, notice, onJoin, onSettings, onName, hue, onHue }: Props) {
  const { t } = useI18n();
  const fruitLabel = useFruitLabel();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [fruits, setFruits] = useState<string[]>([]);
  const [roomName, setRoomName] = useState('');
  const [fruit, setFruit] = useState('');
  const [max, setMax] = useState('4');
  const [bots, setBots] = useState('0');
  const [level, setLevel] = useState<LevelName>('easy');
  useEffect(() => {
    try {
      const l = localStorage.getItem(LEVEL_KEY);
      if (l === 'easy' || l === 'medium' || l === 'hard') setLevel(l);
    } catch {}
  }, []);
  const [win, setWin] = useState(String(WIN_DEFAULT));
  const [mode, setMode] = useState<'race' | 'arena'>('race');
  const [size, setSize] = useState<'small' | 'standard' | 'large'>('standard');
  const [tab, setTab] = useState<'rooms' | 'create'>('create');
  // no rooms: only "create"
  useEffect(() => {
    if (!rooms.length) setTab('create');
  }, [rooms.length]);
  const tabPicked = useRef(false); // the first room list decides the opening tab
  const [draftName, setDraftName] = useState(name);
  useEffect(() => setDraftName(name), [name]);
  const [busy, setBusy] = useState(false);

  // the room list refreshes every 2 s
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(withBase('/api/rooms'))
        .then((r) => r.json())
        .then((list: RoomInfo[]) => {
          if (!alive) return;
          setRooms(list);
          if (!tabPicked.current) {
            tabPicked.current = true;
            setTab(list.length ? 'rooms' : 'create');
          }
          // keys of rooms that are gone
          const mine = roomKeys();
          const ids = new Set(list.map((r) => r.id));
          const gone = Object.keys(mine).filter((id) => !ids.has(id));
          if (gone.length) {
            gone.forEach(forgetRoomKey);
            setKeys(roomKeys());
          }
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 2000);
    fetch(withBase('/api/fruits'))
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
  const [keys, setKeys] = useState<Record<string, string>>({});
  useEffect(() => setKeys(roomKeys()), []);

  /** Closes a room I made (everyone in it goes back to the lobby). */
  const close = async (id: string) => {
    const key = keys[id];
    if (!key) return;
    const res = await fetch(withBase(`/api/rooms/${id}?key=${key}`), { method: 'DELETE' }).catch(() => null);
    if (res && (res.ok || res.status === 404)) {
      forgetRoomKey(id);
      setKeys(roomKeys());
      setRooms((rs) => rs.filter((r) => r.id !== id));
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch(withBase('/api/rooms'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: roomName.trim() || t('lobby.defaultRoom', { name }), fruit, max: Number(max), win: Number(win), level, size, arena: mode === 'arena' }),
      });
      if (res.ok) {
        const room: RoomInfo & { key?: string } = await res.json();
        if (room.key) saveRoomKey(room.id, room.key);
        onJoin(room, Math.min(maxBots, Number(bots)), level);
      }
    } finally {
      setBusy(false);
    }
  };

  const pickLevel = (l: LevelName) => {
    setLevel(l);
    try {
      localStorage.setItem(LEVEL_KEY, l);
    } catch {}
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: 16, overflow: 'auto' }}>
      {/* the logo is in the key art; the heading is for screen readers */}
      <h1 style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{t('lobby.title')}</h1>
      <div style={{ position: 'absolute', right: 16, top: 16 }}>
        <IconButton label={t('settings.title')} onClick={onSettings}>
          ⚙
        </IconButton>
      </div>
      <div className="lobbySheet">
        <Panel style={{ width: 'min(380px, 100%)', margin: '0 auto', padding: 16, fontSize: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* who I am: name and colour */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field label={t('settings.name')}>
                <Input
                  value={draftName}
                  maxLength={NAME_MAX}
                  placeholder={t('name.placeholder')}
                  onChange={(e) => setDraftName(filterNameInput(e.target.value))}
                  onBlur={() => {
                    const nm = cleanName(draftName);
                    if (nm && nm !== name) onName(nm);
                    else setDraftName(name);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
              </Field>
            </div>
            <HuePicker hue={hue} onChange={onHue} label={t('lobby.color')} />
          </div>

          <div role="tablist" style={{ display: 'flex', gap: 18, borderBottom: '1px solid var(--ui-border)', marginTop: 2 }}>
            {(rooms.length ? (['create', 'rooms'] as const) : (['create'] as const)).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '4px 0 9px',
                  marginBottom: -1,
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 15,
                  fontWeight: 700,
                  color: tab === k ? 'var(--ui-fg)' : 'var(--ui-fg-muted)',
                  borderBottom: `2px solid ${tab === k ? 'var(--ui-accent)' : 'transparent'}`,
                }}
              >
                {k === 'rooms' ? `${t('lobby.rooms')}${rooms.length ? ` (${rooms.length})` : ''}` : t('lobby.room')}
              </button>
            ))}
          </div>

          {/* both tabs in one cell: the panel keeps its size when switching */}
          <div style={{ display: 'grid' }}>
            <form
              style={{ gridArea: '1 / 1', visibility: tab === 'create' ? 'visible' : 'hidden', display: 'flex', flexDirection: 'column', gap: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Input
                    value={roomName}
                    maxLength={24}
                    aria-label={t('lobby.roomName')}
                    placeholder={t('lobby.defaultRoom', { name })}
                    onChange={(e) => setRoomName(filterNameInput(e.target.value).slice(0, 24))}
                  />
                </div>
                <Select
                  className={COMPACT}
                  style={{ width: 'auto', flex: 'none' }}
                  aria-label={t('lobby.mode')}
                  title={t('lobby.mode')}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'race' | 'arena')}
                  options={(['race', 'arena'] as const).map((m) => ({ value: m, label: t(`lobby.mode.${m}`) }))}
                />
                {/* the race: the goal in points; the arena: lives */}
                <Select
                  className={COMPACT}
                  style={{ width: 'auto', flex: 'none' }}
                  aria-label={t(mode === 'arena' ? 'lobby.lives' : 'lobby.win')}
                  title={t(mode === 'arena' ? 'lobby.lives' : 'lobby.win')}
                  value={win}
                  onChange={(e) => setWin(e.target.value)}
                  options={WIN_OPTIONS.map((n) => ({ value: String(n), label: mode === 'arena' ? String(n) : `🏆 ${n}` }))}
                />
                <Select
                  className={COMPACT}
                  style={{ width: 'auto', flex: 'none' }}
                  aria-label={t('lobby.size')}
                  title={t('lobby.size')}
                  value={size}
                  onChange={(e) => setSize(e.target.value as 'small' | 'standard' | 'large')}
                  options={(['small', 'standard', 'large'] as const).map((s) => ({ value: s, label: t(`lobby.size.${s}`) }))}
                />
              </div>
              <div className="lobbyRow" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.6fr)', gap: 8 }}>
                <Field label={t('reset.fruit')}>
                  <Select className={COMPACT} value={fruit} onChange={(e) => setFruit(e.target.value)} options={fruits.map((f) => ({ value: f, label: fruitLabel(f) }))} />
                </Field>
                <Field label={t('lobby.max')}>
                  <Select
                    className={COMPACT}
                    value={max}
                    options={MAX_OPTIONS.map((n) => ({ value: n, label: n }))}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMax(v);
                      if (Number(bots) > Number(v) - 1) setBots(String(Number(v) - 1));
                    }}
                  />
                </Field>
                <Field label={t('reset.bots')}>
                  <Select
                    className={COMPACT}
                    value={bots}
                    options={['0', '1', '2', '3', '4', '5', '6', '7'].map((n) => ({ value: n, label: n }))}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBots(v);
                      // more bots than fit: the room grows
                      if (Number(v) > maxBots) setMax(MAX_OPTIONS.find((n) => Number(n) >= Number(v) + 1) ?? '8');
                    }}
                  />
                </Field>
                <Field label={t('lobby.level')}>
                  <Select className={COMPACT} value={level} onChange={(e) => pickLevel(e.target.value as LevelName)} options={LEVELS.map((l) => ({ value: l, label: t(`lobby.level.${l}`) }))} />
                </Field>
              </div>
              <Button type="submit" variant="primary" disabled={busy || !fruit} style={{ marginTop: 'auto' }}>
                {t('lobby.createGo')}
              </Button>
            </form>

            <div style={{ gridArea: '1 / 1', visibility: tab === 'rooms' ? 'visible' : 'hidden', height: ROW_H * 4 + 24, overflowY: 'auto', marginRight: -6, paddingRight: 6 }}>
              {rooms.length === 0 ? (
                <div style={{ color: 'var(--ui-fg-muted)', padding: '10px 0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {t('lobby.empty')}
                  <Button size="sm" variant="primary" onClick={() => setTab('create')}>
                    {t('lobby.room')}
                  </Button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto 26px', gridAutoRows: ROW_H, columnGap: 8, rowGap: 8, alignItems: 'center' }}>
                  {rooms.map((r) => {
                    const full = r.players >= r.max;
                    const lvl = (LEVELS as readonly string[]).includes(r.level ?? '') ? r.level : 'medium';
                    return (
                      <div key={r.id} style={{ display: 'contents' }}>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                          <span style={{ display: 'block', color: 'var(--ui-fg-muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {fruitLabel(r.fruit)} · {t(`lobby.level.${lvl}` as I18nKey)} · {r.arena ? t('lobby.mode.arena') : '🏆'} {r.win ?? WIN_DEFAULT} · {r.players}/{r.max}
                          </span>
                        </span>
                        <Button size="sm" variant={full ? 'secondary' : 'primary'} disabled={full} onClick={() => onJoin(r, 0)}>
                          {full ? t('lobby.full') : t('lobby.join')}
                        </Button>
                        {/* rooms I made: a bin to close it */}
                        {keys[r.id] ? (
                          <Button size="sm" variant="ghost" title={t('lobby.close')} onClick={() => void close(r.id)} style={{ padding: '0 4px', opacity: 0.55 }}>
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
        </Panel>
      </div>
      {notice && <Toast style={{ position: 'absolute', left: '50%', top: 16, transform: 'translateX(-50%)' }}>{t(`notice.${notice}`)}</Toast>}
    </div>
  );
}
