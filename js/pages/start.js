// Start page: offer to resume an interview already in progress in this browser.
import { STEPS, loadState, firstUnanswered } from '../core/interview.js';
import { $ } from '../ui/dom.js';
import { t } from '../core/i18n.js';

export function init() {
  const state = loadState();
  const box = $('#resume');
  if (!box || !state || !Object.keys(state.answers).length) return;
  const done = firstUnanswered(state);
  $('#resume-detail').textContent = state.submittedBuyerId
    ? t('start.resumeSent')
    : t('start.resumeProgress', { n: done, total: STEPS.length });
  box.hidden = false;
}
