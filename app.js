const dotenv = require('dotenv')

const express = require('express')
const mysql = require('mysql2')
const session = require('express-session')
var FileStore = require('session-file-store')(session)
const qs = require('querystring');


const multer = require('multer')
const FormData = require('form-data')
const axios = require('axios')

const fs = require('fs')
if (!fs.existsSync('./sessions')) {
  fs.mkdirSync('./sessions')
}

const app = express()
const upload = multer({ dest: 'uploads/' })

const ZOHO_UPLOAD_URL = 'https://workdrive.zoho.com/api/v1/upload'
const ZOHO_FILE_INFO_URL = 'https://workdrive.zoho.com/api/v1/files'

const envFile = `env/dev.env` // ✅ Directly point to the file
dotenv.config({ path: envFile })
console.log('ENV CHECK:', process.env.DB_USER, process.env.DB_PASSWORD) // Debug

// app.mysqlClient = mysql.createPool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   waitForConnections: true,
//   connectionLimit: 5,
//   queueLimit: 0,
// })

// app.mysqlClient =  mysql.createPool({
//     host: 'localhost',
//     user: 'root',
//     password: 'root',
//     database: 'mydb',
//     waitForConnections: true,
//     connectionLimit: 5,
//     queueLimit: 0
// })
app.use(express.json())

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
      maxAge: 1000 * 60 * 60 * 24, // 1 day
      secure: false, //(when http)
      // secure: true,
    },
  }),
)

// 🔄 Get new access token using refresh token
let cachedToken = null
let tokenExpiry = null

async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken
  }

  const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
    params: {
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    },
  })

  cachedToken = response.data.access_token
  tokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000 // 1 min buffer

  return cachedToken
}

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  console.log(code)

  if (!code) return res.status(400).send('Authorization code missing');

  try {
    const response = await axios.post(
      'https://accounts.zoho.in/oauth/v2/token',
      qs.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        redirect_uri: process.env.REDIRECT_URI,
        code: code,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log('TOKEN RESPONSE:', response.data);
    res.json(response.data); // This will include refresh_token
  } catch (error) {
    console.error('TOKEN ERROR:', error.response?.data || error.message);
    res.status(500).send(error.response?.data || 'Token exchange failed');
  }
});


// 📤 Upload file to Zoho WorkDrive
app.post('/api/upload', upload.single('file'), async (req, res) => {
  console.log('uploadddd')
  try {
    const accessToken = await getAccessToken()
    const form = new FormData()
    form.append('content', fs.createReadStream(req.file.path))
    form.append('parent_id', process.env.ZOHO_FOLDER_ID)

    const response = await axios.post(ZOHO_UPLOAD_URL, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    })

    // Clean up uploaded file
    fs.unlinkSync(req.file.path)

    const fileId = response.data.data[0].id
    res.json({ success: true, fileId })
  } catch (err) {
    if (err.response?.status === 401) {
      cachedToken = null
      tokenExpiry = null
      // Retry once
      const newToken = await getAccessToken()
      // continue with newToken...
    } else {
      throw err
    }
    // console.log(err)
    // res.status(500).json({ error: err.response?.data || err.message });
  }
})


app.get("/", (req, res) => {
  res.send(`<a href="https://accounts.zoho.com/oauth/v2/auth?scope=WorkDrive.files.ALL&client_id=${process.env.CLIENT_ID}&response_type=code&access_type=offline&redirect_uri=${process.env.REDIRECT_URI}">Connect Zoho</a>`)
})

app.get('/api/preview/:id', async (req, res) => {
  console.log('previewww')
  try {
    const accessToken = await getAccessToken()
    const response = await axios.get(`${ZOHO_FILE_INFO_URL}/${req.params.id}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    })
    if (res.status == 404) {
    }
    res.json({
      preview_url: response.data.data.preview_url,
      web_url: response.data.data.web_url,
    })
  } catch (err) {
    // console.log(err)
    // res.status(500).json({ error: err.response?.data || err.message });
    if (err.response?.status === 401) {
      cachedToken = null
      tokenExpiry = null
      // Retry once
      const newToken = await getAccessToken()
      // continue with newToken...
    } else {
      throw err
    }
  }
})

// app.mysqlClient.getConnection(function (err, connection) {
//   if (err) {
//     console.log(err)
//   } else {
//     console.log('mysql connected')
//     connection.release() // Always release back to pool

//     app.mysqlClient.on('connection', (connection) => {
//       connection.query(/*sql*/ `SET time_zone = '+05:30'`, (err) => {
//         if (err) {
//           console.error('Failed to set MySQL timezone:', err)
//         } else {
//           console.log('MySQL timezone set to +05:30 for this connection')
//         }
//       })
//     })

//     // users(app)
//     // projects(app)
//     // timeSheet(app)
//     // dashBoard(app)

//     app.listen(process.env.APP_PORT, () => {
//       // logger.info(`listen ${process.env.APP_PORT} port`)
//       console.log(`start on ${process.env.APP_PORT}`)
//     })
//   }
// })
