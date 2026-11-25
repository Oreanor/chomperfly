'use client';

import { Button, Modal } from '@/components/ui';
import { useI18n, type I18nKey } from '@/lib/i18n';

const SECTIONS: { icon: string; title: I18nKey; text: I18nKey }[] = [
  { icon: '🏆', title: 'help.goal.t', text: 'help.goal' },
  { icon: '🐛', title: 'help.move.t', text: 'help.move' },
  { icon: '🍏', title: 'help.dig.t', text: 'help.dig' },
  { icon: '💥', title: 'help.fight.t', text: 'help.fight' },
  { icon: '🌰', title: 'help.seeds.t', text: 'help.seeds' },
  { icon: '🐜', title: 'help.ants.t', text: 'help.ants' },
  { icon: '🐞', title: 'help.bugs.t', text: 'help.bugs' },
  { icon: '🕷', title: 'help.spiders.t', text: 'help.spiders' },
  { icon: '🪲', title: 'help.earwig.t', text: 'help.earwig' },
  { icon: '🟢', title: 'help.chafer.t', text: 'help.chafer' },
  { icon: '🔄', title: 'help.round.t', text: 'help.round' },
];

/** How to play: the goal, moving, gnawing, fighting, seeds and every critter. */
export default function HelpDialog({ open, onClose, onKeys }: { open: boolean; onClose: () => void; onKeys: () => void }) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      title={t('help.title')}
      width={600}
      onClose={onClose}
      onSubmit={onClose}
      footer={
        <>
          <Button
            type="button"
            onClick={() => {
              onClose();
              onKeys();
            }}
          >
            ⌨ {t('settings.keys')} (K)
          </Button>
          <Button type="submit" variant="primary">
            {t('keys.ok')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14, lineHeight: 1.45, maxHeight: '64vh', overflowY: 'auto', paddingRight: 4 }}>
        {SECTIONS.map((s) => (
          <div key={s.title} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: 10 }}>
            <span style={{ fontSize: 18, lineHeight: 1.2 }}>{s.icon}</span>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{t(s.title)}</div>
              <div style={{ color: 'var(--ui-fg-muted)' }}>{t(s.text)}</div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
