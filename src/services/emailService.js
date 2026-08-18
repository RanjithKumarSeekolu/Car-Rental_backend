const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const { logger } = require('../utils/logger');
const { db, admin } = require('../config/firebaseAdmin');

const FROM = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'RentNHost <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resendReady() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function smtpReady() {
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASSWORD?.trim());
}

function smtpTransporter() {
  const port = Number(process.env.SMTP_PORT) || 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function sendMail({ to, subject, html, type = 'generic', meta = {} }) {
  if (!to) return { ok: false, error: 'no recipient' };

  const ref = await db.collection('mail').add({
    to, subject, html, type, meta,
    status: 'queued',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 1. Try Resend API (works on all cloud hosts, no SMTP ports needed)
  if (resendReady()) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({ from: FROM, to, subject, html });
      await ref.update({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp() });
      logger.info(`Mail sent via Resend: ${type} -> ${to}`);
      return { ok: true, sent: true, id: ref.id };
    } catch (error) {
      await ref.update({ status: 'failed', error: error.message });
      logger.error(`Resend failed: ${error.message}`);
      return { ok: true, stored: true, sent: false, id: ref.id, error: error.message };
    }
  }

  // 2. Fall back to SMTP (local dev)
  if (smtpReady()) {
    try {
      await smtpTransporter().sendMail({ from: FROM, to, subject, html });
      await ref.update({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp() });
      logger.info(`Mail sent via SMTP: ${type} -> ${to}`);
      return { ok: true, sent: true, id: ref.id };
    } catch (error) {
      await ref.update({ status: 'failed', error: error.message });
      logger.error(`SMTP failed, kept in inbox: ${error.message}`);
      return { ok: true, stored: true, sent: false, id: ref.id, error: error.message };
    }
  }

  // 3. No sender configured — store only
  await ref.update({ status: 'stored', reason: 'no_sender' });
  logger.info(`Mail stored (no sender configured): ${type} -> ${to}`);
  return { ok: true, stored: true, id: ref.id };
}

const wrap = (title, body) => `
  <div style="font-family:Outfit,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0B1F3A">
    <p style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#FF5C1A;font-weight:700">RentNHost</p>
    <h2 style="margin:8px 0 16px">${title}</h2>
    ${body}
    <p style="margin-top:24px;font-size:13px;color:#5C6B7A"><a href="${APP_URL}">Open RentNHost</a></p>
  </div>
`;

const sendBookingConfirmation = (to, bookingDetails = {}) =>
  sendMail({
    to,
    type: 'booking',
    subject: 'Booking confirmed — RentNHost',
    meta: { bookingId: bookingDetails.bookingId },
    html: wrap(
      'Booking confirmed',
      `<ul>
        <li>Ref: ${esc(bookingDetails.bookingId)}</li>
        <li>Car: ${esc(bookingDetails.carName)}</li>
        <li>Dates: ${esc(bookingDetails.startDate)} → ${esc(bookingDetails.endDate)}</li>
        <li>Total: ₹${esc(bookingDetails.totalPrice)}</li>
      </ul>`
    ),
  });

const sendKYCStatusEmail = (to, status, reason = '') =>
  sendMail({
    to,
    type: 'kyc',
    subject: status === 'verified' ? 'Licence verified — RentNHost' : 'KYC update — RentNHost',
    html: wrap(
      'Driving licence',
      status === 'verified'
        ? '<p>Your driving licence is verified. You can book and list cars.</p>'
        : `<p>Status: ${esc(status)}. ${esc(reason)}</p>`
    ),
  });

const sendWelcomeEmail = (to, userName) =>
  sendMail({
    to,
    type: 'welcome',
    subject: 'Welcome to RentNHost',
    html: wrap(`Welcome ${esc(userName) || 'there'}`, '<p>Browse cars or list yours when your licence is verified.</p>'),
  });

const sendContactEmail = ({ name, email, message }) =>
  sendMail({
    to: process.env.CONTACT_INBOX || process.env.SMTP_USER || 'admin@rentnhost.com',
    type: 'contact',
    subject: `Contact: ${name || email}`,
    meta: { from: email, name },
    html: wrap(
      'New contact message',
      `<p><strong>${esc(name)}</strong> (${esc(email)})</p><p style="white-space:pre-wrap">${esc(message)}</p>`
    ),
  });

module.exports = {
  sendMail,
  sendBookingConfirmation,
  sendKYCStatusEmail,
  sendWelcomeEmail,
  sendContactEmail,
};
