// Contact form: creates a buyer in the CRM, or adds the message to an existing one with the same email.
import { createBuyer, findBuyerByEmail, addInteraction, updateBuyer } from '../api/crm.js';
import { getLeadSource } from '../ui/lead-source.js';
import { validate, clearErrorsOnInput, consentsFrom, showStatus, setBusy } from '../ui/forms.js';
import { $ } from '../ui/dom.js';
import { t } from '../core/i18n.js';

export function init() {
  const form = $('#contact-form');
  const status = $('#contact-status');
  const property = new URLSearchParams(location.search).get('property');
  if (property && /^[A-Z0-9-]{3,20}$/i.test(property)) {
    form.elements.property.value = property;
    form.elements.subject.value = 'property';
  }
  clearErrorsOnInput(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate(form)) return;
    const button = form.querySelector('[type="submit"]');
    setBusy(button, true);
    const data = new FormData(form);
    const subject = form.elements.subject.selectedOptions[0].textContent;
    const ref = data.get('property').trim();
    const summary = `Message (${subject}${ref ? `, ${ref}` : ''}): ${data.get('message').trim().slice(0, 500)}`;
    const contact = { name: data.get('name').trim(), email: data.get('email').trim(), phone: '', country: data.get('country').trim(), language: document.documentElement.lang };
    try {
      const existing = await findBuyerByEmail(contact.email);
      if (existing) {
        await updateBuyer(existing.id, (b) => ({ ...b, consents: { ...b.consents, ...consentsFrom(form) } }));
        await addInteraction(existing.id, { type: 'message', summary, by: 'buyer' });
      } else {
        await createBuyer({ source: 'contact', contact, consents: consentsFrom(form), leadSource: getLeadSource(), interaction: { type: 'message', summary } });
      }
      form.reset();
      showStatus(status, 'ok', t('contact.okTitle'), t('contact.ok'), t('contact.demo'));
    } catch (error) {
      showStatus(status, 'error', t('contact.errTitle'), `${error.message} ${t('contact.retry')}`);
    } finally {
      setBusy(button, false);
    }
  });
}
