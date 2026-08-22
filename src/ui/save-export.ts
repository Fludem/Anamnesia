import type { GameRuntime } from './useGameHost.ts';

/** Download the stored save as JSON. Raw, straight from the store — migration is not applied. */
export async function exportSave(runtime: GameRuntime): Promise<void> {
  const record: unknown = await runtime.env.store.load('main');
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `anamnesia-save-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
