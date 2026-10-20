// Partner agency enquiry, stored with the partner data used by the consultant area.
import { addPartnerLead } from '../api/partners.js';
import { getLeadSource } from '../ui/lead-source.js';
import { validate, clearErrorsOnInput, consentsFrom, showStatus, setBusy } from '../ui/forms.js';
import { $ } from '../ui/dom.js';

const TEXT = {
  en: { okTitle: 'Request received', ok: 'Thank you. We will contact you to agree the terms in writing before any introduction.', demo: 'In this demo the request is stored in this browser.', errTitle: 'Your request was not sent', retry: 'Please try again.' },
  it: { okTitle: 'Richiesta ricevuta', ok: 'Grazie. Vi contatteremo per fissare le condizioni per iscritto prima di qualsiasi segnalazione.', demo: 'In questa demo la richiesta resta salvata in questo browser.', errTitle: 'La richiesta non è stata inviata', retry: 'Riprova tra un momento.' },
};

export function init() {
  const t = TEXT[document.documentElement.lang] || TEXT.en;
  const form = $('#partner-form');
  const status = $('#partner-status');
  clearErrorsOnInput(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate(form)) return;
    const button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    const data = Object.fromEntries(new FormData(form));
    try {
      await addPartnerLead({
        agency: data.agency.trim(), name: data.name.trim(), email: data.email.trim(), area: data.area.trim(),
        software: data.software, message: (data.message || '').trim(), consents: consentsFrom(form), leadSource: getLeadSource(),
      });
      form.reset();
      showStatus(status, 'ok', t.okTitle, t.ok, t.demo);
    } catch (error) {
      showStatus(status, 'error', t.errTitle, `${error.message} ${t.retry}`);
    } finally {
      setBusy(button, false);
    }
  });
}
