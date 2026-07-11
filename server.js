const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// Read the HTML file once at startup
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

app.get('/', (req, res) => {
  res.type('text/html').send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Sabr Technologies site live on port', PORT);
});
