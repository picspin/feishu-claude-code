import type { CrabState } from './state.js';
import { labelForCrabState } from './activity.js';

export function renderCrabState(button: HTMLElement, panel: HTMLElement, state: CrabState, message?: string): void {
  const label = labelForCrabState(state);
  button.dataset.state = state;
  button.setAttribute('aria-label', label);
  panel.textContent = message ?? label;
  panel.dataset.visible = state === 'bubbling' ? 'true' : 'false';
}
