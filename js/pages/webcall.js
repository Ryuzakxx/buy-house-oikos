// Video call booking: weekday slots in Italian office hours, shown in the visitor's time zone.
import { OFFICE_ZONE, zonedInstant, detectedZone, allZones, formatInZone } from '../core/time.js';
import { loadState, buildWishlist } from '../core/interview.js';
import { createBuyer, findBuyerByEmail, addBooking, addInteraction, updateBuyer } from '../api/crm.js';
import { getLeadSource } from '../ui/lead-source.js';
import { validate, clearErrorsOnInput, consentsFrom, showStatus, setBusy, setFieldError, MESSAGES } from '../ui/forms.js';
import { h, $ } from '../ui/dom.js';
import { t, link } from '../core/i18n.js';

// Demo office hours; production reads free slots from the consultants' calendars.
const FIRST_SLOT = 9 * 60;
const LAST_SLOT = 17 * 60 + 30;
const SLOT_MINUTES = 30;
const DAYS_AHEAD = 60;

let form;

const isoDay = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function italianWeekday(isoDate) {
  return formatInZone(zonedInstant(isoDate, 12, 0, OFFICE_ZONE), OFFICE_ZONE, { weekday: 'short' }, 'en-GB');
}

function dateProblem(isoDate) {
  if (!isoDate) return MESSAGES.required;
  const today = isoDay(new Date());
  const latest = isoDay(new Date(Date.now() + DAYS_AHEAD * 864e5));
  if (isoDate <= today || isoDate > latest) return t('webcall.dateRange', { n: DAYS_AHEAD });
  if (['Sat', 'Sun'].includes(italianWeekday(isoDate))) return t('webcall.weekday');
  return '';
}

function fillSlots() {
  const date = form.elements.date.value;
  const zone = form.elements.timeZone.value;
  const select = form.elements.time;
  const previous = select.value;
  const problem = dateProblem(date);
  form.elements.date.dataset.customError = problem && date ? problem : '';
  if (date) setFieldError(form.elements.date, problem);
  select.replaceChildren();
  if (problem) {
    select.append(h('option', { value: '' }, date ? t('webcall.chooseAnotherDay') : t('webcall.chooseDayFirst')));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.append(h('option', { value: '' }, t('webcall.chooseTime')));
  for (let m = FIRST_SLOT; m <= LAST_SLOT; m += SLOT_MINUTES) {
    const instant = zonedInstant(date, Math.floor(m / 60), m % 60, OFFICE_ZONE);
    const local = formatInZone(instant, zone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const italy = formatInZone(instant, OFFICE_ZONE, { hour: '2-digit', minute: '2-digit' });
    const label = zone === OFFICE_ZONE ? local : `${local} (${t('webcall.inItaly', { time: italy })})`;
    select.append(h('option', { value: instant.toISOString(), selected: instant.toISOString() === previous }, label));
  }
}

export function init() {
  form = $('#webcall-form');
  const zone = detectedZone();
  const zoneSelect = form.elements.timeZone;
  for (const z of allZones(zone)) zoneSelect.append(h('option', { value: z, selected: z === zone }, z.replace(/_/g, ' ')));
  $('#wc-tz-label').textContent = zone.replace(/_/g, ' ');
  const dateInput = form.elements.date;
  dateInput.min = isoDay(new Date(Date.now() + 864e5));
  dateInput.max = isoDay(new Date(Date.now() + DAYS_AHEAD * 864e5));
  dateInput.addEventListener('change', fillSlots);
  zoneSelect.addEventListener('change', () => {
    $('#wc-tz-label').textContent = zoneSelect.value.replace(/_/g, ' ');
    fillSlots();
  });
  const lang = document.documentElement.lang;
  if (form.elements.language.querySelector(`option[value="${lang}"]`)) form.elements.language.value = lang;
  clearErrorsOnInput(form);
  form.addEventListener('submit', submit);
}

async function submit(e) {
  e.preventDefault();
  fillSlots();
  const status = $('#webcall-status');
  if (!validate(form)) return;
  const button = form.querySelector('[type="submit"]');
  setBusy(button, true, t('webcall.booking'));
  const data = new FormData(form);
  const consents = consentsFrom(form);
  const booking = {
    startsAt: data.get('time'),
    timeZone: data.get('timeZone'),
    language: data.get('language'),
    recordingConsent: consents.recording.granted,
    notes: data.get('notes').trim(),
    bookedAt: new Date().toISOString(),
  };
  const contact = { name: data.get('name').trim(), email: data.get('email').trim(), phone: data.get('phone').trim(), country: data.get('country').trim(), language: data.get('language') };
  const when = formatInZone(new Date(booking.startsAt), booking.timeZone, { dateStyle: 'full', timeStyle: 'short' });
  try {
    let buyer = await findBuyerByEmail(contact.email);
    if (!buyer) {
      const interview = loadState();
      const wishlist = interview && Object.keys(interview.answers).length ? { ...buildWishlist(interview.answers), status: 'draft' } : undefined;
      buyer = await createBuyer({ source: 'webcall', contact, consents, leadSource: getLeadSource(), wishlist });
    } else {
      await updateBuyer(buyer.id, (b) => ({ ...b, consents: { ...b.consents, ...consents } }));
    }
    buyer = await addBooking(buyer.id, booking);
    await addInteraction(buyer.id, { type: 'webcall', summary: `Video call booked for ${when} (${booking.language}, recording ${booking.recordingConsent ? 'allowed' : 'not allowed'})`, by: 'buyer' });
    const saved = buyer.bookings[buyer.bookings.length - 1];
    location.href = `${link('start/webcall/confirmed')}?buyer=${encodeURIComponent(buyer.id)}&booking=${encodeURIComponent(saved.id)}`;
  } catch (error) {
    setBusy(button, false);
    showStatus(status, 'error', t('webcall.notBookedTitle'), `${error.message} ${t('webcall.retry')}`);
  }
}
