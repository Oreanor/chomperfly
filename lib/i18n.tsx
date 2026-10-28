'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'ru' | 'en';

const ru = {
  'where.surface': 'на кожуре',
  'where.dig': 'внутри',
  'where.stunned': 'в ступоре',
  'where.panic': 'в панике',
  'seconds': 'с',
  'seed.boost': 'семечко: скорость ×2',
  'ants.shake': 'кликай ПКМ, чтобы стряхнуть',
  'web.stuck': 'Застрял в паутине! Дёргайся — ПКМ (осталось {n})',
  'key.jump': 'прыжок на хвосте (через паутину)',
  'bug.head': 'Божья коровка держит за голову! Хлещи хвостом — кликай ПКМ',
  'bug.tail': 'Божья коровка держит за хвост! Хлещи головой — кликай ПКМ',
  'score.points': '{n} очк.',
  'key.forward': 'вперёд',
  'key.turn': 'поворот',
  'key.rear': 'привстать',
  'key.boost': 'бег ×2',
  'key.dig': 'вгрызться / грызть',
  'key.hit': 'хлестнуть хвостом: отогнать, стряхнуть, отбиться',
  'rmb': 'ПКМ',
  'key.pitch': 'вверх / вниз внутри',
  'key.orbit': 'облёт камеры',
  'key.zoom': 'ближе / дальше',
  'key.reset': 'сброс вида',
  'key.xray': 'рентген',
  'key.settings': 'настройки',
  'key.bot': 'добавить бота',
  'key.keys': 'показать / скрыть клавиши',
  'keys.title': 'Управление',
  'keys.ok': 'Понятно',
  'settings.keys': 'Клавиши',
  'leave.text': 'Твой червяк покинет комнату, очки пропадут.',
  'leave.go': 'Выйти',
  'round.restart': 'Перезапустить раунд',
  'round.text': 'Начать раунд заново для всех? Ходы и дырки сотрутся, очки у всех обнулятся, семечки вернутся.',
  'round.go': 'Перезапустить',
  'round.start': 'СТАРТ!',
  'toast.reset': '{name} перезапустил раунд',
  'lmb': 'ЛКМ',
  'space': 'пробел',
  'wheel': 'колесо',
  'net.connecting': 'подключение…',
  'net.online': 'онлайн',
  'net.offline': 'оффлайн',
  'toast.joined': '{name} зашёл',
  'toast.left': '{name} вышел',
  'toast.win': '🏆 {name} первым добрался до цели и улетел! Новый раунд',
  'toast.bitten': '{name} тебя укусил! Замри на 5 секунд',
  'toast.stung': 'Паук укусил! 5 секунд несёшься без тормозов — только подруливай',
  'toast.botFull': 'Комната полна, бот не поместился',
  'lobby.title': 'Chomperfly',
  'lobby.rooms': 'Комнаты',
  'lobby.empty': 'Пока нет открытых комнат — создай свою',
  'lobby.join': 'Войти',
  'lobby.full': 'Полна',
  'lobby.create': 'Создать комнату',
  'lobby.roomName': 'Название',
  'lobby.defaultRoom': 'Комната {name}',
  'lobby.max': 'Макс. игроков',
  'lobby.win': 'Победа, очков',
  'toast.nodig': 'Вгрызться нельзя: {name}',
  'nodig.grip': 'держит божья коровка (ПКМ)',
  'nodig.ants': 'на тебе муравьи (ПКМ)',
  'nodig.web': 'ты в паутине (ПКМ)',
  'nodig.amok': 'ты в панике после укуса паука',
  'nodig.frozen': 'ты в ступоре',
  'lobby.createGo': 'Создать и войти',
  'lobby.leave': 'Выйти в лобби',
  'notice.noroom': 'Эта комната уже закрыта',
  'notice.full': 'Комната заполнена',
  'reset.fruit': 'Карта',
  'reset.bots': 'Сколько ботов',
  'fruit.apple': 'Яблоко',
  'fruit.pear': 'Груша',
  'fruit.peach': 'Персик',
  'win.title': '🏆 Победа!',
  'win.me': 'Ты первым набрал нужные очки, отрастил крылья и улетел!',
  'win.other': '{name} первым набрал нужные очки, отрастил крылья и улетел.',
  'win.ok': 'ОК, новый раунд',
  'bot.add': 'Добавить бота',
  'bot.addHint': 'Бот играет из этой вкладки, пока она открыта',
  'bot.removeOne': 'Убрать {name}',
  'name.title': '🐛 Как тебя зовут?',
  'name.placeholder': 'например, Вася',
  'name.go': 'В яблоко',
  'name.rules': '2–16 символов: буквы, цифры, пробел, _ . -',
  'settings.title': 'Настройки',
  'settings.name': 'Имя',
  'settings.lang': 'Язык',
  'settings.theme': 'Тема',
  'theme.dark': 'Тёмная',
  'theme.light': 'Светлая',
  'cancel': 'Отмена',
  'ok': 'ОК',
} as const;

export type I18nKey = keyof typeof ru;

const en: Record<I18nKey, string> = {
  'where.surface': 'on the skin',
  'where.dig': 'inside',
  'where.stunned': 'stunned',
  'where.panic': 'panicking',
  'seconds': 's',
  'seed.boost': 'seed: speed ×2',
  'ants.shake': 'right-click to shake them off',
  'web.stuck': 'Stuck in a web! Wriggle — right-click ({n} to go)',
  'key.jump': 'spring hop on the tail (over a web)',
  'bug.head': 'A ladybug has your head! Lash it with your tail — right-click',
  'bug.tail': 'A ladybug has your tail! Lash it with your head — right-click',
  'score.points': '{n} pts',
  'key.forward': 'forward',
  'key.turn': 'turn',
  'key.rear': 'rear up',
  'key.boost': 'run ×2',
  'key.dig': 'burrow / gnaw',
  'key.hit': 'tail swat: shoo, shake off, fight back',
  'rmb': 'RMB',
  'key.pitch': 'up / down inside',
  'key.orbit': 'orbit camera',
  'key.zoom': 'closer / farther',
  'key.reset': 'reset view',
  'key.xray': 'x-ray',
  'key.settings': 'settings',
  'key.bot': 'add a bot',
  'key.keys': 'show / hide keys',
  'keys.title': 'Controls',
  'keys.ok': 'Got it',
  'settings.keys': 'Keys',
  'leave.text': 'Your worm leaves the room and its points are lost.',
  'leave.go': 'Leave',
  'round.restart': 'Restart the round',
  'round.text': 'Start the round over for everyone? Passages and holes are wiped, everyone’s points reset, seeds come back.',
  'round.go': 'Restart',
  'round.start': 'GO!',
  'toast.reset': '{name} restarted the round',
  'lmb': 'LMB',
  'space': 'space',
  'wheel': 'wheel',
  'net.connecting': 'connecting…',
  'net.online': 'online',
  'net.offline': 'offline',
  'toast.joined': '{name} joined',
  'toast.left': '{name} left',
  'toast.win': '🏆 {name} reached the goal and flew away! New round',
  'toast.bitten': '{name} bit you! Frozen for 5 seconds',
  'toast.stung': 'A spider bit you! 5 s running wild — you can only steer',
  'toast.botFull': 'The room is full, no space for a bot',
  'lobby.title': 'Chomperfly',
  'lobby.rooms': 'Rooms',
  'lobby.empty': 'No open rooms yet — create one',
  'lobby.join': 'Join',
  'lobby.full': 'Full',
  'lobby.create': 'Create a room',
  'lobby.roomName': 'Name',
  'lobby.defaultRoom': '{name}’s room',
  'lobby.max': 'Max players',
  'lobby.win': 'Win at, points',
  'toast.nodig': "Can't burrow: {name}",
  'nodig.grip': 'a ladybug holds you (right-click)',
  'nodig.ants': 'ants on you (right-click)',
  'nodig.web': 'stuck in a web (right-click)',
  'nodig.amok': 'panicking after a spider bite',
  'nodig.frozen': 'stunned',
  'lobby.createGo': 'Create and join',
  'lobby.leave': 'Back to the lobby',
  'notice.noroom': 'That room is closed',
  'notice.full': 'The room is full',
  'reset.fruit': 'Map',
  'reset.bots': 'Bots',
  'fruit.apple': 'Apple',
  'fruit.pear': 'Pear',
  'fruit.peach': 'Peach',
  'win.title': '🏆 Victory!',
  'win.me': 'You were first to the goal, grew wings and flew away!',
  'win.other': '{name} was first to the goal, grew wings and flew away.',
  'win.ok': 'OK, new round',
  'bot.add': 'Add bot',
  'bot.addHint': 'The bot plays from this tab while it is open',
  'bot.removeOne': 'Remove {name}',
  'name.title': '🐛 What is your name?',
  'name.placeholder': 'e.g. Sam',
  'name.go': 'Into the apple',
  'name.rules': '2–16 characters: letters, digits, space, _ . -',
  'settings.title': 'Settings',
  'settings.name': 'Name',
  'settings.lang': 'Language',
  'settings.theme': 'Theme',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'cancel': 'Cancel',
  'ok': 'OK',
};

const DICTS: Record<Lang, Record<I18nKey, string>> = { ru, en };
export const LANGS: { value: Lang; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
];

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: I18nKey, vars?: Record<string, string | number>) => string };
const I18nCtx = createContext<Ctx | null>(null);

const KEY = 'wormLang';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ru');
  useEffect(() => {
    let l: string | null = null;
    try {
      l = localStorage.getItem(KEY);
    } catch {}
    if (l !== 'ru' && l !== 'en') l = 'ru'; // Russian by default, English in settings
    setLangState(l as Lang);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {}
  }, []);
  const t = useCallback(
    (k: I18nKey, vars?: Record<string, string | number>) => {
      let str = DICTS[lang][k] ?? k;
      if (vars) for (const [name, v] of Object.entries(vars)) str = str.replaceAll(`{${name}}`, String(v));
      return str;
    },
    [lang],
  );
  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const c = useContext(I18nCtx);
  if (!c) throw new Error('useI18n outside I18nProvider');
  return c;
}
