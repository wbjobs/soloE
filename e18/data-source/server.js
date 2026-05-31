const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3002;

app.use(cors());

app.get('/api/steps', (req, res) => {
  const today = new Date();
  const steps = Math.floor(Math.random() * 5000) + 5000;
  
  res.json({
    date: today.toISOString().split('T')[0],
    steps: steps
  });
});

app.get('/api/heart-rate', (req, res) => {
  const today = new Date();
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=heart_rate.csv');
  
  let csvContent = 'time,heart_rate,bpm\n';
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const heartRate = Math.floor(Math.random() * 40) + 70;
    const timeStr = `${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`;
    csvContent += `${timeStr},${heartRate},${heartRate}\n`;
  }
  
  res.send(csvContent);
});

app.listen(PORT, () => {
  console.log(`Data source server running on port ${PORT}`);
  console.log(`Steps API: http://localhost:${PORT}/api/steps`);
  console.log(`Heart Rate API: http://localhost:${PORT}/api/heart-rate`);
});
