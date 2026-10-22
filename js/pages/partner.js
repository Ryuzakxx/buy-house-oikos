// Partner agency enquiry, stored with the partner data used by the consultant area.
import { addPartnerLead } from '../api/partners.js';
import { getLeadSource } from '../ui/lead-source.js';
import { validate, clearErrorsOnInput, consentsFrom, showStatus, setBusy } from '../ui/forms.js';
import { $ } from '../ui/dom.js';

const TEXT = {
  en: { okTitle: 'Request received', ok: 'Thank you. We will contact you to agree the terms in writing before any introduction.', demo: 'In this demo the request is stored in this browser.', errTitle: 'Your request was not sent', retry: 'Please try again.' },
  it: { okTitle: 'Richiesta ricevuta', ok: 'Grazie. Vi contatteremo per fissare le condizioni per iscritto prima di qualsiasi segnalazione.', demo: 'In questa demo la richiesta resta salvata in questo browser.', errTitle: 'La richiesta non è stata inviata', retry: 'Riprova tra un momento.' },
  de: { okTitle: 'Anfrage erhalten', ok: 'Vielen Dank. Wir melden uns, um die Bedingungen schriftlich festzuhalten, bevor wir Ihnen jemanden vorstellen.', demo: 'In dieser Demo bleibt die Anfrage in diesem Browser gespeichert.', errTitle: 'Die Anfrage wurde nicht gesendet', retry: 'Bitte versuchen Sie es gleich noch einmal.' },
  fr: { okTitle: 'Demande reçue', ok: 'Merci. Nous vous contacterons pour fixer les conditions par écrit avant toute mise en relation.', demo: 'Dans cette démo, la demande reste enregistrée dans ce navigateur.', errTitle: "La demande n'a pas été envoyée", retry: 'Réessayez dans un instant.' },
  nl: { okTitle: 'Aanvraag ontvangen', ok: 'Dank je. We nemen contact op om de voorwaarden schriftelijk vast te leggen voordat we iemand voorstellen.', demo: 'In deze demo blijft de aanvraag in deze browser bewaard.', errTitle: 'De aanvraag is niet verstuurd', retry: 'Probeer het zo opnieuw.' },
  es: { okTitle: 'Solicitud recibida', ok: 'Gracias. Os contactaremos para fijar las condiciones por escrito antes de presentaros a ningún comprador.', demo: 'En esta demo la solicitud queda guardada en este navegador.', errTitle: 'La solicitud no se ha enviado', retry: 'Volved a intentarlo en un momento.' },
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
