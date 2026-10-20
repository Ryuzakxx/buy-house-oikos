// Form validation with visible, text-first error messages linked through aria-describedby.
import { h } from './dom.js';
import { consentRecord } from '../api/crm.js';

const BY_LANG = {
  en: { required: 'Please fill in this field.', email: 'Enter an email address like name@example.com.', consent: 'Please tick this box: we need it to handle your request.', sending: 'Sending…' },
  it: { required: 'Compila questo campo.', email: 'Inserisci un indirizzo email come nome@esempio.it.', consent: 'Spunta questa casella: ci serve per gestire la tua richiesta.', sending: 'Invio in corso…' },
  de: { required: 'Bitte füllen Sie dieses Feld aus.', email: 'Geben Sie eine E-Mail-Adresse wie name@beispiel.de ein.', consent: 'Bitte setzen Sie das Häkchen: Wir brauchen es, um Ihre Anfrage zu bearbeiten.', sending: 'Wird gesendet…' },
  fr: { required: 'Veuillez remplir ce champ.', email: 'Saisissez une adresse e-mail comme nom@exemple.fr.', consent: 'Cochez cette case\u00a0: nous en avons besoin pour traiter votre demande.', sending: 'Envoi…' },
  nl: { required: 'Vul dit veld in.', email: 'Vul een e-mailadres in zoals naam@voorbeeld.nl.', consent: 'Vink dit vakje aan: we hebben het nodig om je aanvraag te behandelen.', sending: 'Bezig met verzenden…' },
  es: { required: 'Rellena este campo.', email: 'Escribe un correo como nombre@ejemplo.es.', consent: 'Marca esta casilla: la necesitamos para tramitar tu solicitud.', sending: 'Enviando…' },
};
const pageLang = typeof document === 'undefined' ? 'en' : document.documentElement.lang;
const MESSAGES = { ...BY_LANG.en, ...(BY_LANG[pageLang] || {}) };

function errorElementFor(field) {
  const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/);
  return ids.map((id) => document.getElementById(id)).find((el) => el?.classList.contains('field-error')) || null;
}

export function setFieldError(field, message) {
  const target = errorElementFor(field);
  if (target) target.textContent = message;
  if (message) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
}

function messageFor(field) {
  if (field.type === 'checkbox') return field.required && !field.checked ? MESSAGES.consent : '';
  if (field.validity.valueMissing) return MESSAGES.required;
  if (field.type === 'email' && field.validity.typeMismatch) return MESSAGES.email;
  if (field.dataset.customError) return field.dataset.customError;
  return '';
}

export function validate(form) {
  let first = null;
  for (const field of form.querySelectorAll('input, select, textarea')) {
    if (field.disabled || !errorElementFor(field)) continue;
    const message = messageFor(field);
    setFieldError(field, message);
    if (message && !first) first = field;
  }
  if (first) first.focus();
  return !first;
}

export function clearErrorsOnInput(form) {
  form.addEventListener('input', (e) => {
    if (e.target.getAttribute('aria-invalid') === 'true' && !messageFor(e.target)) setFieldError(e.target, '');
  });
  form.addEventListener('change', (e) => {
    if (e.target.getAttribute('aria-invalid') === 'true' && !messageFor(e.target)) setFieldError(e.target, '');
  });
}

// Each consent is stored with the exact label text the person saw.
export function consentsFrom(form) {
  const out = {};
  for (const [name, key] of [['consentProcessing', 'processing'], ['consentRecording', 'recording'], ['consentMarketing', 'marketing']]) {
    const box = form.elements[name];
    if (!box) continue;
    const label = box.closest('label')?.querySelector('strong')?.textContent.trim() || name;
    out[key] = consentRecord(box.checked, label);
  }
  return out;
}

export function showStatus(el, kind, title, ...body) {
  el.className = `form-status form-status--${kind}`;
  el.replaceChildren(h('h2', { text: title }), ...body.map((b) => (typeof b === 'string' ? h('p', { text: b }) : b)));
  el.focus();
  el.scrollIntoView({ block: 'nearest' });
}

export function setBusy(button, busy, busyText = MESSAGES.sending) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

export { MESSAGES };
