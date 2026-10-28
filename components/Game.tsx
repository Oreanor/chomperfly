'use client';

import { useEffect, useRef, useState } from 'react';
import { loadAppleModel, loadPitModel } from '@/lib/appleModel';
import { startEngine, type Engine, type HudState, type RoomInfo } from '@/lib/game/engine';
import { cleanName } from '@/lib/name';
import GameUI from '@/components/GameUI';
import Lobby from '@/components/Lobby';
import AccountDialogs from '@/components/AccountDialogs';
import KeysDialog from '@/components/KeysDialog';

const NAME_KEY = 'wormName';
const KEYS_SEEN_KEY = 'wormKeysSeen'; // the controls panel opens by itself the first time

const initialHud = (): HudState => ({ players: 1, net: 'connecting', roster: '[]', toast: '', fps: 0, seedBoost: 0, countdown: 0, ants: 0, grip: '', web: 0, winner: '', winnerMe: false });

/** React shell: name prompt → lobby (pick or create a room) → the 3D game with its HUD. */
export default function Game() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [needName, setNeedName] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [notice, setNotice] = useState<'' | 'noroom' | 'full'>('');
  const botsToAdd = useRef(0);
  const [hud, setHud] = useState<HudState>(initialHud);
  // the game ignores the keyboard while a dialog is open
  const uiBlocked = useRef(false);
  uiBlocked.current = needName || settingsOpen || keysOpen || confirmLeave || confirmRestart || !!hud.winner;

  // the name is asked once and remembered in this browser
  useEffect(() => {
    let saved = '';
    try {
      saved = cleanName(localStorage.getItem(NAME_KEY) || '');
    } catch {}
    if (saved) setName(saved);
    else setNeedName(true);
  }, []);

  // any dialog (victory, new game, settings) frees the mouse so its buttons can be clicked
  const dialogOpen = needName || settingsOpen || keysOpen || confirmLeave || confirmRestart || !!hud.winner;
  useEffect(() => {
    if (dialogOpen && document.pointerLockElement) document.exitPointerLock();
  }, [dialogOpen]);

  // K shows / hides the controls (not while typing or another dialog is open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyK' || e.repeat || e.target instanceof HTMLInputElement) return;
      if (needName || settingsOpen || confirmLeave || confirmRestart || hud.winner) return;
      e.preventDefault();
      setKeysOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [needName, settingsOpen, confirmLeave, confirmRestart, hud.winner]);

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

  const join = (r: RoomInfo, bots: number) => {
    botsToAdd.current = bots;
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
    loadAppleModel(`/fruits/${room.fruit}.glb`)
      .catch((e) => {
        console.warn(`${room.fruit}.glb not loaded, using the built-in shape`, e);
        return null;
      })
      .then(async (model) => {
        // a fruit with a pit (<fruit>-core.glb) has it as an obstacle instead of seeds
        const pit = model ? await loadPitModel(`/fruits/${room.fruit}-core.glb`, model.geometry).catch(() => null) : null;
        if (cancelled || !mountRef.current) return;
        engineRef.current = startEngine({
          mount: mountRef.current,
          room,
          name,
          model,
          pit,
          hud: initialHud(),
          onHud: setHud,
          uiBlocked: () => uiBlocked.current,
          openSettings: () => setSettingsOpen(true),
          bots: botsToAdd.current,
          onLeave: (reason) => leave(reason),
        });
        botsToAdd.current = 0;
      });
    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [name, room]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {!room && <div className="lobbyBg" aria-hidden />}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {name && !room && <Lobby name={name} notice={notice} onJoin={join} onSettings={() => setSettingsOpen(true)} />}
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
          onRestart={() => engineRef.current?.restartRound()}
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
      />
      <KeysDialog open={keysOpen} onClose={() => setKeysOpen(false)} />
    </div>
  );
}
