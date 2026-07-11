const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Sabr Technologies — Synthetic Intelligence</title>
      <style>
        body { font-family: system-ui; background: #0a0a0a; color: #eee; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .container { text-align: center; }
        h1 { font-size: 3rem; margin: 0; }
        p { color: #999; font-size: 1.2rem; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Sabr Technologies</h1>
        <p>Synthetic Intelligence. Coming Soon.</p>
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Sabr Technologies site live on port', PORT);
});
// rebuilt at Fri Jul 10 11:18:31 PM EDT 2026
