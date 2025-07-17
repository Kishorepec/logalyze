require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
//uploading
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
//analyzing log
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const stream = require('stream');
const readline = require('readline');
//Listing Log files
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// S3 Config
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const storage = multer.memoryStorage(); // Use memory, not disk
const upload = multer({ storage });

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/upload', upload.single('logfile'), async (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded.');

  // const fileName = `${Date.now()}-${req.file.originalname}`;
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
    const ipMap = {};
    const urlMap = {};
    const statusMap = {};

    for await (const line of rl) {
      total++;

      // Extract data using simple regex
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

    // Get most frequent IP and URL
    const topIP = Object.entries(ipMap).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topURL = Object.entries(urlMap).sort((a, b) => b[1] - a[1])[0]?.[0];

    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Log Analytics Report</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-light p-4">
  <div class="container">
    <h1 class="mb-4">📊 Log Analytics Dashboard</h1>

    <div class="row mb-4">
      <div class="col-md-6">
        <div class="card shadow-sm">
          <div class="card-body">
            <h5 class="card-title">Total Requests</h5>
            <p class="display-6 text-success">${total}</p>
          </div>
        </div>
      </div>
      <div class="col-md-6">
        <div class="card shadow-sm">
          <div class="card-body">
            <h5 class="card-title">Error Count (404/500)</h5>
            <p class="display-6 text-danger">${errors}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="row mb-4">
      <div class="col-md-6">
        <div class="card shadow-sm">
          <div class="card-body">
            <h5 class="card-title">Most Frequent IP</h5>
            <p class="h5">${topIP || 'N/A'}</p>
          </div>
        </div>
      </div>
      <div class="col-md-6">
        <div class="card shadow-sm">
          <div class="card-body">
            <h5 class="card-title">Most Visited URL</h5>
            <p class="h5">${topURL || 'N/A'}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="card shadow-sm mb-4">
      <div class="card-body">
        <h5 class="card-title">Status Code Breakdown</h5>
        <canvas id="statusChart" height="150"></canvas>
      </div>
    </div>

    <div class="card shadow-sm">
      <div class="card-body">
        <h5 class="card-title">Raw Status Data</h5>
        <pre>${JSON.stringify(statusMap, null, 2)}</pre>
      </div>
    </div>
  </div>

  <script>
    const ctx = document.getElementById('statusChart').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ${JSON.stringify(Object.keys(statusMap))},
        datasets: [{
          label: 'Status Code Count',
          data: ${JSON.stringify(Object.values(statusMap))},
          backgroundColor: ['#198754', '#0d6efd', '#ffc107', '#dc3545']
        }]
      }
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




app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});