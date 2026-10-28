'use client';

import { useState } from 'react';
import { Button, Dot, IconButton, Modal, Panel, Toast } from '@/components/ui';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { useFruitLabel } from '@/components/Lobby';
import Countdown from '@/components/Countdown';
import type { HudState, RoomInfo, RosterRow } from '@/lib/game/engine';

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
  onRestart: () => void; // after the victory dialog
};

const TOASTS: Record<string, I18nKey> = {
  joined: 'toast.joined',
  left: 'toast.left',
  win: 'toast.win',
  bitten: 'toast.bitten',
  stung: 'toast.stung',
  nodig: 'toast.nodig',
  full: 'toast.botFull',
  reset: 'toast.reset',
};

/** In-game HUD: players, settings, FPS, toasts and the victory dialog. */
export default function GameUI({ hud, room, onSettings, onRestartRound, confirmRestart, onConfirmRestart, onAddBot, onRemoveBot, onRestart }: Props) {
  const { t } = useI18n();
  const fruitLabel = useFruitLabel();
  const [hoverBot, setHoverBot] = useState('');

  const roster: RosterRow[] = JSON.parse(hud.roster);
  const [toastKind, ...toastRest] = hud.toast.split(':');
  const toastArg = toastKind === 'nodig' ? t(`nodig.${toastRest[0]}` as I18nKey) : toastRest.join(':');
  const toast = hud.toast && TOASTS[toastKind] ? t(TOASTS[toastKind], { name: toastArg }) : '';

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
                  {fruitLabel(room.fruit)} · {hud.players}/{room.max} · 🏆 {room.win ?? 300}
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
            {/* columns: dot · name · points · where · remove-bot; rows share them via subgrid */}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: '10px auto auto auto 26px', columnGap: 10, rowGap: 6 }}>
              {roster.map((p, i) => (
                <li
                  key={i}
                  style={{ display: 'grid', gridTemplateColumns: 'subgrid', gridColumn: '1 / -1', alignItems: 'center', minHeight: 26, pointerEvents: p.myBot ? 'auto' : 'none' }}
                  onMouseEnter={() => p.myBot && setHoverBot(p.id)}
                  onMouseLeave={() => setHoverBot((h) => (h === p.id ? '' : h))}
                >
                  <Dot color={hex(p.color)} />
                  <span style={{ fontWeight: p.me ? 700 : 400 }}>{p.name}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{t('score.points', { n: p.score })}</span>
                  {p.panic || p.stunned ? (
                    <span style={{ color: '#ff5a4a', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {t(p.panic ? 'where.panic' : 'where.stunned')} · {p.panic || p.stunned} {t('seconds')}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--ui-fg-muted)' }}>{t(p.mode === 'dig' ? 'where.dig' : 'where.surface')}</span>
                  )}
                  {p.myBot && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('bot.removeOne', { name: p.name })}
                      onClick={() => onRemoveBot(p.id)}
                      style={{ padding: '0 6px', visibility: hoverBot === p.id ? 'visible' : 'hidden' }}
                    >
                      🗑
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {/* restart the round + settings */}
      <div style={{ position: 'absolute', right: 16, top: 16, display: 'flex', gap: 8 }}>
        <IconButton label={t('round.restart')} onClick={() => onConfirmRestart(true)}>
          ⟳
        </IconButton>
        <IconButton label={t('settings.title')} onClick={onSettings}>
          ⚙
        </IconButton>
      </div>

      {hud.fps > 0 && (
        <span
          style={{
            position: 'absolute',
            right: 12,
            bottom: 10,
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

      {hud.web > 0 && (
        <Toast style={{ position: 'absolute', left: '50%', bottom: 162, transform: 'translateX(-50%)' }}>
          🕸 {t('web.stuck', { n: hud.web })}
        </Toast>
      )}

      {hud.grip && (
        <Toast style={{ position: 'absolute', left: '50%', bottom: 116, transform: 'translateX(-50%)', color: '#ff5a4a' }}>
          🐞 {t(hud.grip === 'head' ? 'bug.head' : 'bug.tail')}
        </Toast>
      )}

      {hud.ants > 0 && (
        <Toast style={{ position: 'absolute', left: '50%', bottom: 70, transform: 'translateX(-50%)' }}>
          🐜 ×{hud.ants} — {t('ants.shake')}
        </Toast>
      )}

      {hud.seedBoost > 0 && (
        <Toast style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', fontVariantNumeric: 'tabular-nums' }}>
          🌰 {t('seed.boost')} · {hud.seedBoost} {t('seconds')}
        </Toast>
      )}

      {hud.net !== 'online' && (
        <Toast style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)' }}>{t(`net.${hud.net}`)}</Toast>
      )}

      {toast && <Toast style={{ position: 'absolute', left: '50%', top: 16, transform: 'translateX(-50%)' }}>{toast}</Toast>}

      {/* restarting the round asks first */}
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

      {/* round over */}
      <Modal
        open={!!hud.winner}
        title={t('win.title')}
        onSubmit={onRestart}
        footer={
          <Button type="submit" variant="primary">
            {t('win.ok')}
          </Button>
        }
      >
        <div style={{ fontSize: 16 }}>{hud.winnerMe ? t('win.me') : t('win.other', { name: hud.winner })}</div>
      </Modal>
    </>
  );
}
