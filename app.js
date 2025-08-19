require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
// S3 upload dependencies
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
// S3 log analysis dependency
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const stream = require('stream');
const readline = require('readline');
// S3 list files dependency
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

const app = express();
const PORT = 3000;

const { CohereClientV2 } = require('cohere-ai');
const cohere = new CohereClientV2({
  token: process.env.COHERE_API_KEY,
});




app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Use memory storage for multer (no disk writes)
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/upload', upload.single('logfile'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');

  const extension = path.extname(req.file.originalname);
const baseName = path.basename(req.file.originalname, extension);
const fileName = `${baseName}-${uuidv4()}${extension}`;


  const uploadParams = {
    Bucket: process.env.S3_BUCKET,
    Key: fileName,
    Body: req.file.buffer,
    ContentType: req.file.mimetype
  };

  try {
    await s3.send(new PutObjectCommand(uploadParams));
    res.redirect(`/analyze?file=${fileName}`);

  } catch (err) {
    console.error('S3 Upload Error:', err);
    res.status(500).send('❌ Failed to upload to S3');
  }
});


// In-memory log cache for AI access (consider S3 for production)
const logCache = {};

// Analyze a log file and show dashboard
app.get('/analyze', async (req, res) => {
  const fileKey = req.query.file;
  if (!fileKey) return res.status(400).send('No file specified.');

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: fileKey
    });

    const s3Response = await s3.send(command);
    const logStream = s3Response.Body;

    const rl = readline.createInterface({
      input: logStream,
      crlfDelay: Infinity
    });

    let total = 0;
    let errors = 0;
    const ipMap = {}, urlMap = {}, statusMap = {};
  let logText = '';

    for await (const line of rl) {
  // Accumulate full log content for AI
  logText += line + '\n';

      total++;
      const ip = line.match(/^(\d+\.\d+\.\d+\.\d+)/)?.[1];
      const path = line.match(/"(GET|POST) ([^ ]+)/)?.[2];
      const status = line.match(/" (\d{3})/)?.[1];

      if (ip) ipMap[ip] = (ipMap[ip] || 0) + 1;
      if (path) urlMap[path] = (urlMap[path] || 0) + 1;
      if (status) {
        statusMap[status] = (statusMap[status] || 0) + 1;
        if (['404', '500'].includes(status)) errors++;
      }
    }

    const topIP = Object.entries(ipMap).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topURL = Object.entries(urlMap).sort((a, b) => b[1] - a[1])[0]?.[0];

  // Cache the log for AI
  logCache[fileKey] = logText;

  // Send analytics dashboard and chat UI
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Log Analytics</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-light p-4">
  <div class="container">
    <h2 class="mb-4">Log Analytics Dashboard</h2>

    <div class="row mb-4">
      <div class="col"><b>Total Requests:</b> ${total}</div>
      <div class="col"><b>Errors (404/500):</b> ${errors}</div>
      <div class="col"><b>Top IP:</b> ${topIP || 'N/A'}</div>
      <div class="col"><b>Top URL:</b> ${topURL || 'N/A'}</div>
    </div>

    <div class="card p-3 mb-4">
      <h5>Status Code Breakdown</h5>
      <canvas id="statusChart" height="150"></canvas>
    </div>

    <div class="card p-3 mb-4">
      <h5>Ask AI About This Log</h5>
      <form id="chat-form">
        <input type="text" class="form-control mb-2" id="user-query" placeholder="e.g. What is the most common error?">
        <button class="btn btn-primary" type="submit">Ask</button>
        <div id="ai-response" class="mt-3 text-secondary"></div>
      </form>
    </div>

    <div class="card p-3">
      <h5>Raw Status Data</h5>
      <pre>${JSON.stringify(statusMap, null, 2)}</pre>
    </div>
  </div>

  <script>
    const ctx = document.getElementById('statusChart').getContext('2d');
    new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ${JSON.stringify(Object.keys(statusMap))},
        datasets: [{
          data: ${JSON.stringify(Object.values(statusMap))},
          backgroundColor: ['#198754', '#0d6efd', '#ffc107', '#dc3545']
        }]
      }
    });

    document.getElementById('chat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = document.getElementById('user-query').value;
      const res = await fetch('/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ logId: "${fileKey}", query })
      });
      const data = await res.json();
      document.getElementById('ai-response').textContent = data.answer;
    });
  </script>
</body>
</html>
    `);

  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).send('❌ Failed to analyze file.');
  }
});


// List all files in the S3 bucket
app.get('/files', async (req, res) => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: process.env.S3_BUCKET
    });

    const response = await s3.send(command);
    const files = response.Contents.map(obj => obj.Key);

    res.render('files', { files });
  } catch (err) {
    console.error('Error listing files:', err);
    res.status(500).send('❌ Failed to list files.');
  }
});



// Q&A endpoint for chat UI
app.post('/chat', express.json(), async (req, res) => {
  const { logId, query } = req.body;
  const context = logCache[logId];
  if (!context) {
    return res.status(404).json({ answer: "Log not found." });
  }
  try {
    const response = await cohere.chat({
      model: 'command-r',
      messages: [
        {
          role: 'user',
          content: `Analyze this server log:\n${context.slice(0, 3000)}\n\nUser question: ${query}`
        }
      ]
    });
    const answer = response.text || "No response";
    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ answer: "AI error." });
  }
});

// MCP Server endpoint for standardized Q&A API
app.post('/mcp/server', express.json(), async (req, res) => {
  const { fileKey, question } = req.body;
  if (!fileKey || !question) {
    return res.status(400).json({ error: 'fileKey and question are required.' });
  }
  const context = logCache[fileKey];
  if (!context) {
    return res.status(404).json({ error: 'Log not found.' });
  }
  try {
    const response = await cohere.chat({
      model: 'command-r',
      messages: [
        {
          role: 'user',
          content: `Analyze this server log:\n${context.slice(0, 3000)}\n\nUser question: ${question}`
        }
      ]
    });
    const answer = response.text || 'No response';
    res.json({ answer });
  } catch (err) {
    console.error('MCP error:', err);
    res.status(500).json({ error: 'AI error.' });
  }
});






// Start the server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});