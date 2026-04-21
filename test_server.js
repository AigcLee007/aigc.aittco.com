const express = require('express');
const app = express();
const PORT = Number.parseInt(process.env.PORT || '3355', 10);

app.get('/', (req, res) => res.send('Hello World'));

app.listen(PORT, () => {
    console.log(`Test server running on ${PORT}`);
});
