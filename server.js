require('dotenv').config();
const express = require('express');
const app = require('./src/app')

// health
app.get('/health', (req, res) => res.json({ ok: true }));


const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server started on ${PORT}`));
