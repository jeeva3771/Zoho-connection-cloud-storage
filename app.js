const dotenv = require('dotenv')
const express = require('express')
const mysql = require('mysql2')
const session = require('express-session')
var FileStore = require('session-file-store')(session)
const qs = require('querystring')
const multer = require('multer')
const FormData = require('form-data')
const axios = require('axios')
const fs = require('fs')
const path = require('path')

// Create necessary directories
if (!fs.existsSync('./sessions')) {
  fs.mkdirSync('./sessions')
}
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads')
}

const app = express()

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  }
})

// Zoho API URLs
const ZOHO_UPLOAD_URL = 'https://workdrive.zoho.com/api/v1/upload'
const ZOHO_FILE_INFO_URL = 'https://workdrive.zoho.com/api/v1/files'
const ZOHO_FOLDERS_URL = 'https://workdrive.zoho.com/api/v1/folders'
const ZOHO_TOKEN_URL = 'https://accounts.zoho.com/oauth/v2/token'
const ZOHO_AUTH_URL = 'https://accounts.zoho.com/oauth/v2/auth'

// Load environment variables
const envFile = `env/dev.env`
dotenv.config({ path: envFile })

// Database connection
app.mysqlClient = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
})

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Session configuration
app.use(
  session({
    store: new FileStore({
      path: './sessions',
      retries: 0,
      ttl: 1000 * 60 * 60 * 24,
    }),
    secret: process.env.SESSION_SECRET || 'default_secret_key',
    resave: true,
    saveUninitialized: true,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      secure: false, // Set to true in production with HTTPS
    },
  }),
)

// Token management
let cachedToken = null
let tokenExpiry = null

async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    console.log('Using cached token')
    return cachedToken
  }

  try {
    console.log('Refreshing access token...')
    const response = await axios.post(ZOHO_TOKEN_URL, null, {
      params: {
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token',
      },
    })

    cachedToken = response.data.access_token
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000

    console.log('Token refreshed successfully')
    return cachedToken
  } catch (error) {
    console.error('Token refresh failed:', error.response?.data || error.message)
    throw new Error('Failed to refresh access token')
  }
}

// Step 1: Initial authorization (to get refresh token)
app.get("/", (req, res) => {
  const authUrl = `${ZOHO_AUTH_URL}?` + qs.stringify({
    scope: 'WorkDrive.files.ALL,WorkDrive.folders.READ',
    client_id: process.env.ZOHO_CLIENT_ID,
    response_type: 'code',
    access_type: 'offline',
    redirect_uri: process.env.REDIRECT_URI,
    prompt: 'consent'
  })

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Zoho WorkDrive Setup</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .btn { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 10px 0; }
            .btn:hover { background: #0056b3; }
            .btn.success { background: #28a745; }
            .btn.warning { background: #ffc107; color: #212529; }
            .code { background: #f8f9fa; padding: 15px; border-radius: 5px; font-family: monospace; margin: 10px 0; }
            .step { margin: 20px 0; padding: 15px; border-left: 4px solid #007bff; background: #f8f9fa; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Zoho WorkDrive Setup</h1>

            <div class="step">
                <h3>Step 1: Get Authorization</h3>
                <p>Click below to authorize this app with your Zoho WorkDrive account:</p>
                <a href="${authUrl}" class="btn">🔗 Connect Zoho WorkDrive</a>
            </div>

            <div class="step">
                <h3>Step 2: After Authorization</h3>
                <p>After clicking the link above, you'll be redirected back here with tokens that you need to add to your environment file.</p>
            </div>

            <div class="step">
                <h3>Current Environment Status:</h3>
                <div class="code">
                    ZOHO_CLIENT_ID: ${process.env.ZOHO_CLIENT_ID ? '✅ Set' : '❌ Missing'}<br>
                    ZOHO_CLIENT_SECRET: ${process.env.ZOHO_CLIENT_SECRET ? '✅ Set' : '❌ Missing'}<br>
                    ZOHO_REFRESH_TOKEN: ${process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_REFRESH_TOKEN !== 'YOUR_REFRESH_TOKEN' ? '✅ Set' : '❌ Missing'}<br>
                    ZOHO_FOLDER_ID: ${process.env.ZOHO_FOLDER_ID && process.env.ZOHO_FOLDER_ID !== 'YOUR_WORKDRIVE_FOLDER_ID' ? '✅ Set' : '❌ Missing'}<br>
                    REDIRECT_URI: ${process.env.REDIRECT_URI ? '✅ Set' : '❌ Missing'}
                </div>
            </div>

            <div class="step">
                <h3>API Endpoints (Available after setup):</h3>
                <ul>
                    <li><strong>GET /api/folders</strong> - List folders to find your folder ID</li>
                    <li><strong>POST /api/upload</strong> - Upload file</li>
                    <li><strong>GET /api/preview/:id</strong> - Get file preview</li>
                    <li><strong>GET /api/download/:id</strong> - Download file</li>
                    <li><strong>DELETE /api/file/:id</strong> - Delete file</li>
                    <li><strong>GET /api/files</strong> - List files</li>
                </ul>
            </div>
        </div>
    </body>
    </html>
  `)
})

// Step 2: Handle callback and get tokens
app.get('/callback', async (req, res) => {
  const code = req.query.code
  console.log('Authorization code received:', code)

  if (!code) {
    return res.status(400).json({ error: 'Authorization code missing' })
  }

  try {
    const response = await axios.post(
      ZOHO_TOKEN_URL,
      qs.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        code: code,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    )

    const tokens = response.data
    console.log('TOKEN RESPONSE:', tokens)

    // Store in session for immediate use
    req.session.accessToken = tokens.access_token
    req.session.refreshToken = tokens.refresh_token

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Authorization Success</title>
          <style>
              body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
              .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .success { background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; margin: 20px 0; }
              .code { background: #f8f9fa; padding: 15px; border-radius: 5px; font-family: monospace; margin: 10px 0; white-space: pre-wrap; }
              .btn { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 10px 0; }
          </style>
      </head>
      <body>
          <div class="container">
              <h1>✅ Authorization Successful!</h1>

              <div class="success">
                  Your Zoho WorkDrive account has been successfully connected!
              </div>

              <h3>📝 Update Your Environment File</h3>
              <p>Add this refresh token to your <code>env/dev.env</code> file:</p>
              <div class="code">ZOHO_REFRESH_TOKEN=${tokens.refresh_token}</div>

              <h3>🔗 Next Steps:</h3>
              <ol>
                  <li>Update your environment file with the refresh token above</li>
                  <li>Restart your server</li>
                  <li>Visit <a href="/api/folders">/api/folders</a> to find your folder ID</li>
                  <li>Update ZOHO_FOLDER_ID in your environment file</li>
              </ol>

              <a href="/api/folders" class="btn">📁 Browse Folders</a>
              <a href="/" class="btn">🏠 Home</a>
          </div>
      </body>
      </html>
    `)

  } catch (error) {
    console.error('TOKEN ERROR:', error.response?.data || error.message)
    res.status(500).json({
      error: 'Token exchange failed',
      details: error.response?.data || error.message
    })
  }
})

// Get folders to help user find folder ID
app.get('/api/folders', async (req, res) => {
  try {
    let accessToken

    // Try to use session token first, then refresh token
    if (req.session.accessToken) {
      accessToken = req.session.accessToken
    } else {
      accessToken = await getAccessToken()
    }

    const response = await axios.get(`${ZOHO_FOLDERS_URL}`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`
      }
    })

    const folders = response.data.data || []

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Zoho Folders</title>
          <style>
              body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
              .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
              .folder { padding: 15px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; cursor: pointer; }
              .folder:hover { background: #f8f9fa; }
              .folder-id { font-family: monospace; color: #666; font-size: 12px; }
              .btn { display: inline-block; padding: 8px 16px; background: #007bff; color: white; text-decoration: none; border-radius: 3px; font-size: 12px; }
          </style>
      </head>
      <body>
          <div class="container">
              <h1>📁 Your Zoho WorkDrive Folders</h1>
              <p>Click on a folder ID to copy it, then add it to your environment file as ZOHO_FOLDER_ID:</p>

              ${folders.map(folder => `
                <div class="folder" onclick="copyToClipboard('${folder.id}')">
                    <strong>📁 ${folder.name}</strong><br>
                    <span class="folder-id">ID: ${folder.id}</span><br>
                    <small>Created: ${new Date(folder.created_time).toLocaleDateString()}</small>
                    <span class="btn" style="float: right;">Copy ID</span>
                </div>
              `).join('')}

              <script>
                function copyToClipboard(text) {
                  navigator.clipboard.writeText(text).then(function() {
                    alert('Folder ID copied to clipboard: ' + text);
                  });
                }
              </script>
          </div>
      </body>
      </html>
    `)

  } catch (error) {
    console.error('Folders error:', error.response?.data || error.message)
    res.status(500).json({
      error: 'Failed to get folders',
      details: error.response?.data || error.message
    })
  }
})

// Upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  console.log('File upload initiated')

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  let retryCount = 0
  const maxRetries = 2

  while (retryCount <= maxRetries) {
    try {
      const accessToken = await getAccessToken()
      const form = new FormData()

      form.append('content', fs.createReadStream(req.file.path), {
        filename: req.file.originalname,
        contentType: req.file.mimetype
      })

      form.append('parent_id', process.env.ZOHO_FOLDER_ID)

      if (req.body.filename) {
        form.append('filename', req.body.filename)
      }

      console.log('Uploading to Zoho WorkDrive...')
      const response = await axios.post(ZOHO_UPLOAD_URL, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      })

      fs.unlinkSync(req.file.path)

      const uploadedFile = response.data.data[0]
      console.log('Upload successful:', uploadedFile.id)

      res.json({
        success: true,
        fileId: uploadedFile.id,
        fileName: uploadedFile.name,
        fileSize: uploadedFile.size,
        uploadedAt: new Date().toISOString()
      })
      return

    } catch (error) {
      if (error.response?.status === 401 && retryCount < maxRetries) {
        console.log('Token expired, refreshing and retrying...')
        cachedToken = null
        tokenExpiry = null
        retryCount++
        continue
      }

      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path)
      }

      console.error('Upload error:', error.response?.data || error.message)
      res.status(500).json({
        error: 'Upload failed',
        details: error.response?.data || error.message
      })
      return
    }
  }
})

// Preview endpoint
app.get('/api/preview/:id', async (req, res) => {
  console.log('Preview requested for file:', req.params.id)

  let retryCount = 0
  const maxRetries = 2

  while (retryCount <= maxRetries) {
    try {
      const accessToken = await getAccessToken()
      const response = await axios.get(`${ZOHO_FILE_INFO_URL}/${req.params.id}`, {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`
        },
      })

      const fileData = response.data.data
      res.json({
        success: true,
        fileId: fileData.id,
        fileName: fileData.name,
        fileSize: fileData.size,
        mimeType: fileData.content_type,
        preview_url: fileData.preview_url,
        web_url: fileData.web_url,
        download_url: fileData.download_url,
        created_time: fileData.created_time,
        modified_time: fileData.modified_time,
      })
      return

    } catch (error) {
      if (error.response?.status === 401 && retryCount < maxRetries) {
        console.log('Token expired, refreshing and retrying...')
        cachedToken = null
        tokenExpiry = null
        retryCount++
        continue
      }

      if (error.response?.status === 404) {
        res.status(404).json({ error: 'File not found' })
        return
      }

      console.error('Preview error:', error.response?.data || error.message)
      res.status(500).json({
        error: 'Failed to get file preview',
        details: error.response?.data || error.message
      })
      return
    }
  }
})

// Download endpoint
app.get('/api/download/:id', async (req, res) => {
  try {
    const accessToken = await getAccessToken()
    const response = await axios.get(`${ZOHO_FILE_INFO_URL}/${req.params.id}/download`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`
      },
      responseType: 'stream'
    })

    res.setHeader('Content-Disposition', `attachment; filename="${req.query.filename || 'download'}"`)
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream')

    response.data.pipe(res)

  } catch (error) {
    console.error('Download error:', error.response?.data || error.message)
    res.status(500).json({
      error: 'Download failed',
      details: error.response?.data || error.message
    })
  }
})

// Delete endpoint
app.delete('/api/file/:id', async (req, res) => {
  try {
    const accessToken = await getAccessToken()
    await axios.delete(`${ZOHO_FILE_INFO_URL}/${req.params.id}`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`
      },
    })

    res.json({
      success: true,
      message: 'File deleted successfully'
    })

  } catch (error) {
    console.error('Delete error:', error.response?.data || error.message)
    res.status(500).json({
      error: 'Delete failed',
      details: error.response?.data || error.message
    })
  }
})

// List files endpoint
app.get('/api/files', async (req, res) => {
  try {
    const accessToken = await getAccessToken()
    const folderId = req.query.folder_id || process.env.ZOHO_FOLDER_ID
    const page = req.query.page || 1
    const perPage = req.query.per_page || 50

    const response = await axios.get(`${ZOHO_FILE_INFO_URL}`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`
      },
      params: {
        parent_id: folderId,
        page: page,
        per_page: perPage
      }
    })

    res.json({
      success: true,
      files: response.data.data,
      pagination: {
        page: parseInt(page),
        per_page: parseInt(perPage),
        total: response.data.info?.total || 0
      }
    })

  } catch (error) {
    console.error('List files error:', error.response?.data || error.message)
    res.status(500).json({
      error: 'Failed to list files',
      details: error.response?.data || error.message
    })
  }
})

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    tokenCached: !!cachedToken,
    env: {
      hasClientId: !!process.env.ZOHO_CLIENT_ID,
      hasClientSecret: !!process.env.ZOHO_CLIENT_SECRET,
      hasRefreshToken: !!(process.env.ZOHO_REFRESH_TOKEN && process.env.ZOHO_REFRESH_TOKEN !== 'YOUR_REFRESH_TOKEN'),
      hasFolderId: !!(process.env.ZOHO_FOLDER_ID && process.env.ZOHO_FOLDER_ID !== 'YOUR_WORKDRIVE_FOLDER_ID'),
    }
  })
})

// Database connection test
app.mysqlClient.getConnection(function (err, connection) {
  if (err) {
    console.log('Database connection failed:', err)
  } else {
    console.log('✅ Database connected successfully')
    connection.release()

    app.mysqlClient.on('connection', (connection) => {
      connection.query(`SET time_zone = '+05:30'`, (err) => {
        if (err) {
          console.error('Failed to set MySQL timezone:', err)
        } else {
          console.log('✅ MySQL timezone set to +05:30')
        }
      })
    })

    // Start server
    const PORT = process.env.APP_PORT || 3000
    app.listen(PORT, () => {
      console.log(`🚀 Server started on port ${PORT}`)
      console.log(`🌐 Visit https://zoho-connection-cloud-storage.onrender.com to get started`)
      console.log(`📋 Health check: https://zoho-connection-cloud-storage.onrender.com/health`)
    })
  }
})
