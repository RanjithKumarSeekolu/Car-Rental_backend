const { sendContactEmail } = require('../services/emailService');

exports.submitContact = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'name, email, and message are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Message is too long' });
    }

    await sendContactEmail({ name, email, message });
    res.json({ success: true, message: 'Message received' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
