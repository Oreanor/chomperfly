// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NetMsg = any;

export type Net = { send(m: object): void; close(): void };

export type NetStatus = 'connecting' | 'online' | 'offline';

export function connectNet(room: string, name: string, onMsg: (m: NetMsg) => void, onStatus: (s: NetStatus) => void, isBot = false): Net {
  let ws: WebSocket | null = null;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?room=' + encodeURIComponent(room) + '&name=' + encodeURIComponent(name) + (isBot ? '&bot=1' : '');
    onStatus('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => onStatus('online');
    ws.onmessage = (e) => {
      try {
        onMsg(JSON.parse(e.data));
      } catch {}
    };
    ws.onclose = () => {
      if (closed) return; // closed on purpose: no status, no reconnect
      onStatus('offline');
      timer = setTimeout(open, 2000);
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return {
    send(m) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
    },
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
