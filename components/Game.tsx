'use client';

import { useEffect, useRef, useState } from 'react';
import { loadAppleModel, loadPitModel } from '@/lib/appleModel';
import { setFruitSize } from '@/lib/apple';
import { fruitSpec } from '@/lib/fruits';
import { withBase } from '@/lib/paths';
import { startEngine, type Engine, type HudState, type RoomInfo } from '@/lib/game/engine';
import { cleanName } from '@/lib/name';
import { browserLang } from '@/lib/i18n';
import { HUE_KEY, hueColor } from '@/lib/hue';
import type { LevelName } from '@/lib/worm/levels';
import GameUI from '@/components/GameUI';
import Lobby from '@/components/Lobby';
import AccountDialogs from '@/components/AccountDialogs';
import KeysDialog from '@/components/KeysDialog';
import HelpDialog from '@/components/HelpDialog';

const NAME_KEY = 'wormName';
const KEYS_SEEN_KEY = 'wormKeysSeen'; // the controls panel opens by itself the first time

const initialHud = (): HudState => ({
  players: 1,
  net: 'connecting',
  roster: '[]',
  toast: '',
  fps: 0,
  seedBoost: 0,
  seedMul: 1,
  countdown: 0,
  ants: 0,
  grip: '',
  web: 0,
  earwig: 0,
  winner: '',
  winnerMe: false,
  end: '',
  roundTime: 0,
  light: 'day',
  readyMe: false,
  readyN: 0,
  readyOf: 0,
  goAt: 0,
  canStartNow: false,
});

/** My worm's hue: remembered in this browser (a random one the first time). */
function savedHue() {
  try {
    const v = Number(localStorage.getItem(HUE_KEY));
    if (localStorage.getItem(HUE_KEY) !== null && Number.isFinite(v)) return ((v % 360) + 360) % 360;
    const h = Math.floor(Math.random() * 360);
    localStorage.setItem(HUE_KEY, String(h));
    return h;
  } catch {
    return Math.floor(Math.random() * 360);
  }
}

/** React shell: the lobby (name, colour; pick or create a room) → the 3D game with its HUD. */
export default function Game() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [hue, setHue] = useState(0);
  useEffect(() => setHue(savedHue()), []);
  const [needName, setNeedName] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [notice, setNotice] = useState<'' | 'noroom' | 'full'>('');
  const botsToAdd = useRef(0);
  const botLevel = useRef<LevelName>('easy');
  const [hud, setHud] = useState<HudState>(initialHud);
  const roundEnded = !!hud.winner || hud.end === 'wipe';
  // the game ignores the keyboard while a dialog is open
  const uiBlocked = useRef(false);
  uiBlocked.current = needName || settingsOpen || keysOpen || helpOpen || confirmLeave || confirmRestart || roundEnded;

  // the name is remembered in this browser; the first time a random one ("Wormy 42") — change it in the lobby
  useEffect(() => {
    let saved = '';
    try {
      saved = cleanName(localStorage.getItem(NAME_KEY) || '');
    } catch {}
    if (!saved) {
      let lang = browserLang();
      try {
        const l = localStorage.getItem('wormLang');
        if (l === 'ru' || l === 'en' || l === 'pt') lang = l;
      } catch {}
      const base = lang === 'ru' ? 'Червячок' : lang === 'pt' ? 'Minhoca' : 'Wormy';
      saved = cleanName(`${base} ${Math.floor(10 + Math.random() * 90)}`);
      try {
        localStorage.setItem(NAME_KEY, saved);
      } catch {}
    }
    setName(saved);
  }, []);

  // any dialog (the end of a round, settings…) frees the mouse so its buttons can be clicked
  const dialogOpen = needName || settingsOpen || keysOpen || helpOpen || confirmLeave || confirmRestart || roundEnded;
  useEffect(() => {
    if (dialogOpen && document.pointerLockElement) document.exitPointerLock();
  }, [dialogOpen]);

  // K shows / hides the controls (not while typing or another dialog is open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyK' || e.repeat || e.target instanceof HTMLInputElement) return;
      if (needName || settingsOpen || helpOpen || confirmLeave || confirmRestart || roundEnded) return;
      e.preventDefault();
      setKeysOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [needName, settingsOpen, helpOpen, confirmLeave, confirmRestart, roundEnded]);

  // R asks to restart the round for everyone (the same as the ⟳ button), E to leave the room
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code !== 'KeyR' && e.code !== 'KeyE') || e.repeat || e.target instanceof HTMLInputElement || !room) return;
      if (needName || settingsOpen || keysOpen || helpOpen || confirmLeave || confirmRestart || roundEnded) return;
      e.preventDefault();
      if (document.pointerLockElement) document.exitPointerLock();
      if (e.code === 'KeyR') setConfirmRestart(true);
      else setConfirmLeave(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [room, needName, settingsOpen, keysOpen, helpOpen, confirmLeave, confirmRestart, roundEnded]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(id);
  }, [notice]);

  const onName = (nm: string) => {
    try {
      localStorage.setItem(NAME_KEY, nm);
    } catch {}
    setNeedName(false);
    setSettingsOpen(false);
    setName(nm); // in a room this reconnects under the new name
  };

  const join = (r: RoomInfo, bots: number, level?: LevelName) => {
    botsToAdd.current = bots;
    if (level) botLevel.current = level;
    try {
      if (!localStorage.getItem(KEYS_SEEN_KEY)) {
        localStorage.setItem(KEYS_SEEN_KEY, '1');
        setKeysOpen(true);
      }
    } catch {}
    setHud(initialHud());
    setRoom(r);
  };
  const leave = (reason: '' | 'noroom' | 'full' = '') => {
    setRoom(null);
    setNotice(reason);
  };

  useEffect(() => {
    if (!name || !room) return;
    let cancelled = false;
    setFruitSize(room.size, room.max); // the fruit's size, before anything is built on it
    loadAppleModel(withBase(`/fruits/${room.fruit}.glb`), fruitSpec(room.fruit).upsideDown)
      .catch((e) => {
        console.warn(`${room.fruit}.glb not loaded, using the built-in shape`, e);
        return null;
      })
      .then(async (model) => {
        // a fruit with a pit (lib/fruits.json) has it as an obstacle instead of seeds
        const pitFile = fruitSpec(room.fruit).pit;
        const pit = model && pitFile ? await loadPitModel(withBase(`/fruits/${pitFile}`), model.geometry).catch(() => null) : null;
        if (cancelled || !mountRef.current) return;
        engineRef.current = startEngine({
          mount: mountRef.current,
          room,
          name,
          color: hueColor(hue),
          model,
          pit,
          hud: initialHud(),
          onHud: setHud,
          uiBlocked: () => uiBlocked.current,
          openSettings: () => setSettingsOpen(true),
          bots: botsToAdd.current,
          botLevel: botLevel.current,
          onLeave: (reason) => leave(reason),
        });
        botsToAdd.current = 0;
      });
    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // the colour is read when entering (not a reason to rebuild the scene)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, room]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {!room && <div className="lobbyBg" aria-hidden />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {name && !room && (
        <Lobby
          name={name}
          notice={notice}
          onJoin={join}
          onSettings={() => setSettingsOpen(true)}
          onName={onName}
          hue={hue}
          onHue={(h) => {
            setHue(h);
            try {
              localStorage.setItem(HUE_KEY, String(Math.round(h)));
            } catch {}
          }}
        />
      )}
      {room && (
        <GameUI
          hud={hud}
          room={room}
          onSettings={() => setSettingsOpen(true)}
          onRestartRound={() => engineRef.current?.restartRoundForAll()}
          confirmRestart={confirmRestart}
          onConfirmRestart={setConfirmRestart}
          onAddBot={() => engineRef.current?.addBot()}
          onRemoveBot={(id) => engineRef.current?.removeBot(id)}
          onRestart={() => engineRef.current?.roundReady()}
          onStartNow={() => engineRef.current?.startNow()}
          onNextLight={() => engineRef.current?.nextLight()}
        />
      )}
      <AccountDialogs
        name={name}
        needName={needName}
        settingsOpen={settingsOpen}
        onSettingsOpen={setSettingsOpen}
        onName={onName}
        onLeave={room ? () => leave() : undefined}
        confirmLeave={confirmLeave}
        onConfirmLeave={setConfirmLeave}
        onShowKeys={() => {
          setSettingsOpen(false);
          setKeysOpen(true);
        }}
        onShowHelp={() => {
          setSettingsOpen(false);
          setHelpOpen(true);
        }}
      />
      <KeysDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} onKeys={() => setKeysOpen(true)} />
    </div>
  );
}
