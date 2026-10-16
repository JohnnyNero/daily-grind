// Saving to this device (localStorage) and to a file. Storage can be unavailable
// (private browsing, blocked site data), so every access is guarded.

import { deserialize, serialize } from '../sim/manage';
import type { Sim } from '../sim/sim';

const SAVE_KEY = 'daily-grind:save';

export function saveToDevice(sim: Sim): boolean {
  try {
    localStorage.setItem(SAVE_KEY, serialize(sim));
    return true;
  } catch {
    return false;
  }
}

/** The saved café, or null if there isn't one (or it can't be read). */
export function loadFromDevice(): Sim | null {
  let json: string | null = null;
  try {
    json = localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!json) return null;
  try {
    return deserialize(json);
  } catch {
    return null;
  }
}

export function clearDeviceSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing saved, nothing to clear.
  }
}

export function exportSave(sim: Sim): void {
  const blob = new Blob([serialize(sim)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `daily-grind-day-${sim.day}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reads a save file and stores it on this device. Throws a readable error if it isn't valid. */
export async function importSave(file: File): Promise<void> {
  const text = await file.text();
  const sim = deserialize(text);
  if (!saveToDevice(sim)) throw new Error("Couldn't store the save on this device.");
}
