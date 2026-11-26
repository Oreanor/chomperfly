'use client';

import { useEffect, useState } from 'react';
import { BinIcon, Button, Dot, IconButton, Modal, Panel, Toast } from '@/components/ui';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { useFruitLabel } from '@/components/Lobby';
import Countdown from '@/components/Countdown';
import type { HudState, RoomInfo, RosterRow } from '@/lib/game/engine';
import type { LightName } from '@/lib/render/lighting';

export type { HudState };
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

type Props = {
  hud: HudState;
  room: RoomInfo;
  onSettings: () => void;
  onRestartRound: () => void; // for everyone, after confirming
  confirmRestart: boolean;
  onConfirmRestart: (open: boolean) => void;
  onAddBot: () => void;
  onRemoveBot: (id: string) => void;
  onRestart: () => void; // OK in the end-of-round dialog: ready for the next round
  onStartNow: () => void; // the room's creator starts it without waiting
  onNextLight: () => void; // the next time of day
};

const TOASTS: Record<string, I18nKey> = {
  joined: 'toast.joined',
  left: 'toast.left',
  win: 'toast.win',
  bitten: 'toast.bitten',
  lashed: 'toast.lashed',
  youbit: 'toast.youbit',
  bitter: 'toast.bitter',
  water: 'toast.water',
  ladybit: 'toast.ladybit',
  earwig: 'toast.earwig',
  earwigdrill: 'toast.earwigdrill',
  chafer: 'toast.chafer',
  chaferkill: 'toast.chaferkill',
  out: 'toast.out',
  strike: 'toast.strike',
  dropgrow: 'toast.dropgrow',
  arenawin: 'toast.arenawin',
  arenawinMe: 'toast.arenawinMe',
  wipe: 'toast.wipe',
  shield: 'toast.shield',
  rocket: 'toast.rocket',
  dive: 'toast.dive',
  pitshield: 'toast.pitshield',
  chaferon: 'toast.chaferon',
  earwiggrab: 'toast.earwiggrab',
  juicy: 'toast.juicy',
  pit: 'toast.pit',
  youlashed: 'toast.youlashed',
  stung: 'toast.stung',
  antbit: 'toast.antbit',
  nodig: 'toast.nodig',
  full: 'toast.botFull',
  reset: 'toast.reset',
};

const ROW_H = 26;
const ROW_GAP = 6;

/** In-game HUD: players (sorted by points, sliding into place), the round's clock, buttons, toasts, the end-of-round dialog. */
export default function GameUI({ hud, room, onSettings, onRestartRound, confirmRestart, onConfirmRestart, onAddBot, onRemoveBot, onRestart, onStartNow, onNextLight }: Props) {
  const { t } = useI18n();
  const fruitLabel = useFruitLabel();
  const [hoverBot, setHoverBot] = useState('');

  const roster: RosterRow[] = JSON.parse(hud.roster);
  // where each row should be (by points; a tie keeps the order), as a slide from where it is in the list
  const rank = new Map(
    roster
      .map((r, i) => ({ id: r.id, score: r.score, i }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((r, k) => [r.id, k]),
  );
  const [toastKind, ...toastRest] = hud.toast.split(':');
  const toastArg = toastKind === 'nodig' ? t(`nodig.${toastRest[0]}` as I18nKey) : toastRest.join(':');
  const toast = hud.toast && TOASTS[toastKind] ? t(TOASTS[toastKind], { name: toastArg }) : '';
  const light = (hud.light || 'day') as LightName;

  return (
    <>
      {/* online players */}
      {roster.length > 0 && (
        <div style={{ position: 'absolute', left: 16, top: 16, maxWidth: 'min(560px, calc(100vw - 32px))', pointerEvents: 'none' }}>
          <Panel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ marginRight: 'auto', paddingRight: 12, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{room.name}</span>
                <span style={{ fontSize: 12, color: 'var(--ui-fg-muted)' }}>
                  {fruitLabel(room.fruit)} · {hud.players}/{room.max} · {room.arena ? t('lobby.mode.arena') : '🏆'} {room.win ?? 300}
                </span>
              </span>
              <Button
                size="sm"
                onClick={onAddBot}
                disabled={hud.players >= room.max}
                title={`B — ${t('bot.add')}. ${t('bot.addHint')}`}
                style={{ pointerEvents: 'auto' }}
              >
                +🤖
              </Button>
            </div>
            {/* columns: dot · name · where · rounds won · points · remove-bot; rows share them via subgrid */}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: '10px 11ch 15ch 3.5ch 4ch 26px', columnGap: 12, rowGap: ROW_GAP }}>
              {roster.map((p, i) => (
                <li
                  key={p.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'subgrid',
                    gridColumn: '1 / -1',
                    alignItems: 'center',
                    height: ROW_H,
                    pointerEvents: p.myBot ? 'auto' : 'none',
                    transform: `translateY(${((rank.get(p.id) ?? i) - i) * (ROW_H + ROW_GAP)}px)`,
                    transition: 'transform 0.5s cubic-bezier(0.3, 0.8, 0.3, 1)',
                    ...(p.me ? { background: 'color-mix(in srgb, var(--ui-accent) 22%, transparent)', borderRadius: 7, margin: '0 -8px', padding: '0 8px' } : null),
                  }}
                  onMouseEnter={() => p.myBot && setHoverBot(p.id)}
                  onMouseLeave={() => setHoverBot((h) => (h === p.id ? '' : h))}
                >
                  <Dot color={hex(p.color)} />
                  <span style={{ fontWeight: p.me ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>
                    {p.name}
                  </span>
                  {p.out ? (
                    <span style={{ color: '#ff5a4a', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden' }}>{t('where.out')}</span>
                  ) : p.panic || p.stunned ? (
                    <span style={{ color: '#ff5a4a', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                      {t(p.panic ? 'where.panic' : 'where.stunned')} · {p.panic || p.stunned} {t('seconds')}
                    </span>
                  ) : p.web ? (
                    <span style={{ color: '#ff5a4a', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden' }}>{t('where.web')}</span>
                  ) : (
                    <span style={{ color: 'var(--ui-fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden' }}>{t(p.mode === 'dig' ? 'where.dig' : 'where.surface')}</span>
                  )}
                  <span title={t('roster.wins')} style={{ color: 'var(--ui-fg-muted)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {p.wins ? `🏆${p.wins}` : ''}
                  </span>
                  <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{p.score}</span>
                  {/* your bots: an outlined bin, faint until you point at the row */}
                  {p.myBot ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('bot.removeOne', { name: p.name })}
                      onClick={() => onRemoveBot(p.id)}
                      style={{ padding: '0 4px', opacity: hoverBot === p.id ? 1 : 0.35, transition: 'opacity 0.15s' }}
                    >
                      <BinIcon />
                    </Button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {/* the round's clock */}
      <div
        title={t('round.time')}
        style={{
          position: 'absolute',
          left: '50%',
          top: 16,
          transform: 'translateX(-50%)',
          padding: '4px 12px',
          borderRadius: 10,
          background: 'var(--ui-panel)',
          backdropFilter: 'blur(6px)',
          color: 'var(--ui-fg)',
          fontSize: 18,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.5,
          pointerEvents: 'none',
        }}
      >
        ⏱ {Math.floor(hud.roundTime / 60)}:{String(hud.roundTime % 60).padStart(2, '0')}
      </div>

      <div style={{ position: 'absolute', right: 16, top: 16, display: 'flex', gap: 8 }}>
        <IconButton label={`${t(('light.' + light) as I18nKey)} — ${t('light.next')}`} onClick={onNextLight}>
          <LightIcon light={light} />
        </IconButton>
        <IconButton label={t('round.restart')} onClick={() => onConfirmRestart(true)}>
          ⟳
        </IconButton>
        <IconButton label={t('settings.title')} onClick={onSettings}>
          ⚙
        </IconButton>
        {hud.fps > 0 && (
          <span
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 6px)',
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              color: hud.fps < 30 ? '#ff8a7a' : 'var(--ui-fg-muted)',
              textShadow: '0 1px 3px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}
          >
            {hud.fps} FPS
          </span>
        )}
      </div>

      {/* what's happening to me */}
      <div style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
        {toast && <Toast>{toast}</Toast>}
        {hud.web > 0 && <Toast>🕸 {t('web.stuck', { n: hud.web })}</Toast>}
        {hud.earwig > 0 && <Toast>🪲 {t('earwig.held', { n: hud.earwig })}</Toast>}
        {hud.grip && <Toast style={{ color: '#ff5a4a' }}>🐞 {t(hud.grip === 'head' ? 'bug.head' : 'bug.tail')}</Toast>}
        {hud.ants > 0 && (
          <Toast>
            🐜 ×{hud.ants} — {t('ants.shake')}
          </Toast>
        )}
        {hud.seedMul > 1 && (
          <Toast style={{ fontVariantNumeric: 'tabular-nums' }}>
            💧 {t('seed.boost', { x: hud.seedMul })} · {hud.seedBoost} {t('seconds')}
          </Toast>
        )}
        {hud.net !== 'online' && <Toast>{t(`net.${hud.net}` as I18nKey)}</Toast>}
      </div>

      {/* restart the round (for everyone) */}
      <Modal
        open={confirmRestart}
        title={t('round.restart')}
        onClose={() => onConfirmRestart(false)}
        onSubmit={() => {
          onConfirmRestart(false);
          onRestartRound();
        }}
        footer={
          <>
            <Button onClick={() => onConfirmRestart(false)}>{t('cancel')}</Button>
            <Button type="submit" variant="primary">
              {t('round.go')}
            </Button>
          </>
        }
      >
        <div style={{ fontSize: 15 }}>{t('round.text')}</div>
      </Modal>

      <Countdown startedAt={hud.countdown} />

      {/* the round is over: who won (or nobody, alone in the arena); OK = ready for the next one */}
      <Modal
        open={!!hud.winner || hud.end === 'wipe'}
        title={hud.end === 'wipe' ? t('wipe.title') : hud.end === 'arena' ? t('win.arenaTitle') : t('win.title')}
        center
        onSubmit={onRestart}
        footer={
          <>
            {hud.canStartNow && hud.readyOf > 1 && <Button onClick={onStartNow}>{t('win.now')}</Button>}
            <Button type="submit" variant="primary" disabled={hud.readyMe}>
              {hud.readyMe ? t('win.waiting') : t('win.ok')}
            </Button>
          </>
        }
      >
        <div style={{ fontSize: 20, fontWeight: 800 }}>
          {hud.end === 'wipe'
            ? t('wipe.head')
            : hud.end === 'arena'
              ? hud.winnerMe
                ? t('win.arenaMe')
                : t('win.arena', { name: hud.winner })
              : hud.winnerMe
                ? t('win.headMe')
                : t('win.head', { name: hud.winner })}
        </div>
        {hud.goAt > 0 && hud.readyOf > 1 && <Ready n={hud.readyN} of={hud.readyOf} goAt={hud.goAt} />}
      </Modal>
    </>
  );
}

/** "Ready 2 of 3 · starts in 12 s". */
function Ready({ n, of, goAt }: { n: number; of: number; goAt: number }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.ceil((goAt - now) / 1000));
  return <div style={{ fontSize: 14, opacity: 0.8, marginTop: 8 }}>{t('win.ready', { n, of, s })}</div>;
}

/** The time of day: the sun low on the left (morning), high (day), low on the right (sunset); the moon at night. */
function LightIcon({ light }: { light: LightName }) {
  const sun = light === 'morning' ? { x: 6, y: 15, c: '#ffc58a' } : light === 'sunset' ? { x: 18, y: 15, c: '#ff8a4c' } : { x: 12, y: 6.5, c: '#ffd84a' };
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      {light === 'night' ? (
        <>
          <circle cx="7.2" cy="6.4" r="0.7" fill="currentColor" opacity="0.55" />
          <circle cx="18.4" cy="5.2" r="0.45" fill="currentColor" opacity="0.4" />
          <path fill="#e7f1ff" stroke="rgba(0,0,0,0.35)" strokeWidth="0.7" d="M13.2 3.6a5.4 5.4 0 1 0 3.6 9.4 4.3 4.3 0 1 1-3.6-9.4z" />
        </>
      ) : (
        <>
          {/* the sun's path across the sky */}
          <path d="M3 18.5 Q12 1 21 18.5" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.4" strokeDasharray="1.6 2.2" strokeLinecap="round" />
          <path d="M21 18.5 l-0.6 -3.4 M21 18.5 l-3.1 -1.4" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx={sun.x} cy={sun.y} r="3.4" fill={sun.c} stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
        </>
      )}
      <line x1="2" y1="20.5" x2="22" y2="20.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
