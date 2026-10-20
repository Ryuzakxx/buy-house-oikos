// Booking confirmation, with a calendar file the visitor can save.
import { OFFICE_ZONE, formatInZone } from '../core/time.js';
import { getBuyer } from '../api/crm.js';
import { h, $ } from '../ui/dom.js';
import { t, link } from '../core/i18n.js';

const LANGUAGES = { en: 'English', de: 'Deutsch', fr: 'Français', nl: 'Nederlands', es: 'Español', it: 'Italiano' };
const CALL_MINUTES = 30;

function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function calendarFile(booking) {
  const start = new Date(booking.startsAt);
  const end = new Date(start.getTime() + CALL_MINUTES * 60000);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Buy House in Italy//Video call//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@buyhouseinitaly.example`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${t('confirmed.icsSummary')}`,
    `DESCRIPTION:${t('confirmed.icsDescription')}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
}

export async function init() {
  const box = $('#booking-summary');
  const params = new URLSearchParams(location.search);
  try {
    const buyer = params.get('buyer') ? await getBuyer(params.get('buyer')) : null;
    const booking = buyer?.bookings?.find((b) => b.id === params.get('booking'));
    if (!booking) {
      box.replaceChildren(h('div', { class: 'empty-state' },
        h('h2', {}, t('confirmed.notFoundTitle')),
        h('p', {}, t('confirmed.notFoundText')),
        h('p', {}, h('a', { class: 'btn btn--primary', href: link('start/webcall') }, t('confirmed.book')))));
      return;
    }
    const start = new Date(booking.startsAt);
    const local = formatInZone(start, booking.timeZone, { dateStyle: 'full', timeStyle: 'short' });
    const italy = formatInZone(start, OFFICE_ZONE, { timeStyle: 'short' });
    const download = h('a', { class: 'btn btn--primary', download: t('confirmed.filename'), href: URL.createObjectURL(calendarFile(booking)) }, t('confirmed.addCalendar'));
    box.replaceChildren(
      h('p', { class: 'page-hero__lede' }, t('confirmed.thanks', { name: buyer.contact.name.split(' ')[0] })),
      h('dl', {},
        h('dt', {}, t('confirmed.when')), h('dd', {}, `${local} (${booking.timeZone.replace(/_/g, ' ')})`),
        h('dt', {}, t('confirmed.inItaly')), h('dd', {}, italy),
        h('dt', {}, t('confirmed.language')), h('dd', {}, LANGUAGES[booking.language] || booking.language),
        h('dt', {}, t('confirmed.recording')), h('dd', {}, booking.recordingConsent ? t('confirmed.recYes') : t('confirmed.recNo'))),
      h('p', { class: 'form-actions' }, download),
      h('p', { class: 'note' }, t('confirmed.emailNote')));
  } catch (error) {
    box.replaceChildren(h('div', { class: 'error-state', role: 'alert' },
      h('h2', {}, t('confirmed.loadErrorTitle')),
      h('p', {}, t('confirmed.reload', { error: error.message }))));
  }
}
