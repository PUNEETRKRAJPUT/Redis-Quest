import { useState } from 'react';
import { ApiError } from '../api';
import { IconBall } from '../icons';
import { useQuest } from '../store';

export function Welcome() {
  const create = useQuest((s) => s.createPlayer);
  const init = useQuest((s) => s.init);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await create(name.trim());
    } catch (e) {
      if (e instanceof ApiError && e.code === 'player_exists') await init();
      else setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <main className="page narrow welcome" data-testid="welcome">
      <div className="welcome-mark"><IconBall size={44} /></div>
      <h1>Redis Quest</h1>
      <p className="lead">
        Season 7 of the Nukkad Cricket League starts in three weeks. You and Teja built a fantasy cricket app for your hostel in one weekend.
        It is about to go very, very wrong, in the best way. You are the backend.
      </p>
      <p>Everything runs on this Mac. Your progress is saved in a file next to the project, so you can close the laptop and come back.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void submit();
        }}
      >
        <label className="field">
          What should Teja call you?
          <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" data-testid="player-name" />
        </label>
        {err ? <p className="callout warn" role="alert">{err}</p> : null}
        <button type="submit" className="btn primary" disabled={busy || !name.trim()} data-testid="player-submit">
          {busy ? 'Starting...' : 'Start Chapter 0'}
        </button>
      </form>
    </main>
  );
}
