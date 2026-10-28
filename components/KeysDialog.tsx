'use client';

import type { ReactNode } from 'react';
import { Button, Kbd, Modal } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

/** Controls, in a panel in the middle of the screen. K or Esc closes it. */
export default function KeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      title={t('keys.title')}
      onClose={onClose}
      onSubmit={onClose}
      footer={
        <Button type="submit" variant="primary">
          {t('keys.ok')}
        </Button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '8px 16px', fontSize: 14 }}>
        <Hint keys={['W']} text={t('key.forward')} />
        <Hint keys={['A', 'D']} text={t('key.turn')} />
        <Hint keys={['S']} text={t('key.rear')} />
        <Hint keys={[t('space')]} text={t('key.jump')} />
        <Hint keys={['Shift']} text={t('key.boost')} />
        <Hint keys={[t('lmb')]} text={t('key.dig')} />
        <Hint keys={[t('rmb')]} text={t('key.hit')} />
        <Hint keys={['E', 'Q']} text={t('key.pitch')} />
        <Hint keys={['←', '→']} text={t('key.orbit')} />
        <Hint keys={['↑', '↓', t('wheel')]} text={t('key.zoom')} />
        <Hint keys={['V']} text={t('key.reset')} />
        <Hint keys={['X']} text={t('key.xray')} />
        <Hint keys={['B']} text={t('key.bot')} />
        <Hint keys={['N']} text={t('key.settings')} />
        <Hint keys={['K']} text={t('key.keys')} />
      </div>
    </Modal>
  );
}

function Hint({ keys, text }: { keys: ReactNode[]; text: string }) {
  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        {keys.map((k, i) => (
          <Kbd key={i}>{k}</Kbd>
        ))}
      </span>
      <span style={{ color: 'var(--ui-fg-muted)', alignSelf: 'center' }}>{text}</span>
    </>
  );
}
