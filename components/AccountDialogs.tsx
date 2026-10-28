'use client';

import { useEffect, useState } from 'react';
import { Button, Field, Input, Modal, Segmented } from '@/components/ui';
import { LANGS, useI18n } from '@/lib/i18n';
import { useTheme, type Theme } from '@/lib/theme';
import { cleanName, filterNameInput, NAME_MAX } from '@/lib/name';

type Props = {
  name: string | null;
  needName: boolean; // first visit: mandatory name prompt
  settingsOpen: boolean;
  onSettingsOpen: (open: boolean) => void;
  onName: (name: string) => void;
  onShowKeys: () => void;
  onLeave?: () => void; // only in a room: back to the lobby
  confirmLeave: boolean;
  onConfirmLeave: (open: boolean) => void;
};

/** Name prompt on the first visit and the settings dialog (name, language, theme). */
export default function AccountDialogs({ name, needName, settingsOpen, onSettingsOpen, onName, onShowKeys, onLeave, confirmLeave, onConfirmLeave }: Props) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (settingsOpen || needName) setDraft(name ?? '');
  }, [settingsOpen, needName, name]);

  const submit = () => {
    const nm = cleanName(draft);
    if (nm) onName(nm);
  };
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
        onSubmit={submit}
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
        onClose={() => onSettingsOpen(false)}
        onSubmit={submit}
        footer={
          <>
            <Button type="submit" disabled={!cleanName(draft)}>
              {t('ok')}
            </Button>
            <Button onClick={() => onSettingsOpen(false)}>{t('cancel')}</Button>
            {onLeave && (
              <Button
                onClick={() => {
                  onSettingsOpen(false);
                  onConfirmLeave(true);
                }}
              >
                ⎋ {t('lobby.leave')}
              </Button>
            )}
          </>
        }
      >
        <Field label={t('settings.name')}>{nameInput}</Field>
        <Field inline label={t('settings.lang')}>
          <Segmented value={lang} options={LANGS} onChange={setLang} />
        </Field>
        <Field inline label={t('settings.theme')}>
          <Segmented<Theme>
            value={theme}
            options={[
              { value: 'dark', label: t('theme.dark') },
              { value: 'light', label: t('theme.light') },
            ]}
            onChange={setTheme}
          />
        </Field>
        <Button onClick={onShowKeys} style={{ alignSelf: 'center' }}>
          ⌨ {t('settings.keys')} (K)
        </Button>
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
