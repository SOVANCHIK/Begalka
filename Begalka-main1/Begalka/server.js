const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();

// Раздаём статические файлы из папки public
app.use(express.static(path.join(__dirname, "public")));

// Все запросы отдаём index.html из public
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});