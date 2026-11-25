'use client';

import { useEffect, useState } from 'react';
import { Button, Field, Input, Modal, Segmented, Select } from '@/components/ui';
import { LANGS, useI18n, type Lang } from '@/lib/i18n';
import { useTheme, type Theme } from '@/lib/theme';
import { cleanName, filterNameInput, NAME_MAX } from '@/lib/name';

type Props = {
  name: string | null;
  needName: boolean; // first visit: mandatory name prompt
  settingsOpen: boolean;
  onSettingsOpen: (open: boolean) => void;
  onName: (name: string) => void;
  onShowKeys: () => void;
  onShowHelp: () => void;
  onLeave?: () => void; // only in a room: back to the lobby
  confirmLeave: boolean;
  onConfirmLeave: (open: boolean) => void;
};

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="4.2" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
      <line key={a} x1="12" y1="2.6" x2="12" y2="5" transform={`rotate(${a} 12 12)`} />
    ))}
  </svg>
);

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </svg>
);

/**
 * The name prompt on the first visit, the settings dialog (language, theme; how to play, the keys,
 * leaving the room) and the leave confirmation. The name itself is changed in the lobby.
 */
export default function AccountDialogs({ name, needName, settingsOpen, onSettingsOpen, onName, onShowKeys, onShowHelp, onLeave, confirmLeave, onConfirmLeave }: Props) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (settingsOpen || needName) setDraft(name ?? '');
  }, [settingsOpen, needName, name]);

  const nameInput = (
    <>
      <Input value={draft} maxLength={NAME_MAX} placeholder={t('name.placeholder')} onChange={(e) => setDraft(filterNameInput(e.target.value))} />
      <span style={{ fontSize: 12, color: 'var(--ui-fg-muted)' }}>{t('name.rules')}</span>
    </>
  );

  return (
    <>
      <Modal
        open={needName}
        title={t('name.title')}
        onSubmit={() => {
          const nm = cleanName(draft);
          if (nm) onName(nm);
        }}
        footer={
          <Button type="submit" variant="primary" disabled={!cleanName(draft)}>
            {t('name.go')}
          </Button>
        }
      >
        {nameInput}
        <Segmented value={lang} options={LANGS} onChange={setLang} />
      </Modal>

      <Modal
        open={settingsOpen && !needName}
        title={t('settings.title')}
        width={360}
        onClose={() => onSettingsOpen(false)}
        onSubmit={() => onSettingsOpen(false)}
        footer={
          <Button type="submit" variant="primary" style={{ minWidth: 130 }}>
            {t('ok')}
          </Button>
        }
      >
        <Field inline label={t('settings.lang')}>
          <Select value={lang} options={LANGS} onChange={(e) => setLang(e.target.value as Lang)} />
        </Field>
        <Field inline label={t('settings.theme')}>
          <Segmented<Theme>
            value={theme}
            options={[
              {
                value: 'light',
                label: (
                  <span title={t('theme.light')} aria-label={t('theme.light')} style={{ display: 'flex' }}>
                    <SunIcon />
                  </span>
                ),
              },
              {
                value: 'dark',
                label: (
                  <span title={t('theme.dark')} aria-label={t('theme.dark')} style={{ display: 'flex' }}>
                    <MoonIcon />
                  </span>
                ),
              },
            ]}
            onChange={setTheme}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 4 }}>
          <Button onClick={onShowHelp} style={{ whiteSpace: 'nowrap' }}>
            ? {t('help.title')}
          </Button>
          <Button onClick={onShowKeys} style={{ whiteSpace: 'nowrap' }}>
            ⌨ {t('settings.keys')}
          </Button>
          {onLeave && (
            <Button
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => {
                onSettingsOpen(false);
                onConfirmLeave(true);
              }}
            >
              ⎋ {t('settings.exit')}
            </Button>
          )}
        </div>
      </Modal>

      {/* leaving the room asks first */}
      <Modal
        open={confirmLeave}
        title={t('lobby.leave')}
        onClose={() => onConfirmLeave(false)}
        onSubmit={() => {
          onConfirmLeave(false);
          onLeave?.();
        }}
        footer={
          <>
            <Button onClick={() => onConfirmLeave(false)}>{t('cancel')}</Button>
            <Button type="submit" variant="primary">
              {t('leave.go')}
            </Button>
          </>
        }
      >
        <div style={{ fontSize: 15 }}>{t('leave.text')}</div>
      </Modal>
    </>
  );
}
