'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import s from './Countdown.module.css';

/** "3", "2", "1", "START!" in the middle of the screen, one per second from `startedAt` (Date.now()). */
export default function Countdown({ startedAt }: { startedAt: number }) {
  const { t } = useI18n();
  const [step, setStep] = useState(-1);

  useEffect(() => {
    if (!startedAt) return setStep(-1);
    const tick = () => setStep(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 50);
    return () => clearInterval(id);
  }, [startedAt]);

  if (step < 0 || step > 3) return null;
  const label = step < 3 ? String(3 - step) : t('round.start');
  return (
    <div className={s.wrap}>
      <div key={step} className={`${s.step} ${step === 3 ? s.start : ''}`}>
        {label}
      </div>
    </div>
  );
}
