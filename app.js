const dotenv = require('dotenv')

const express = require('express')
const mysql = require('mysql2')
const session = require('express-session')
var FileStore = require('session-file-store')(session)

const fs = require('fs')
if (!fs.existsSync('./sessions')) {
    fs.mkdirSync('./sessions')
}

const app = express()
const envFile = `env/dev.env`; // ✅ Directly point to the file
dotenv.config({ path: envFile });
console.log('ENV CHECK:', process.env.DB_USER, process.env.DB_PASSWORD); // Debug




app.mysqlClient =  mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
})


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


app.use(session({ 
    store: new FileStore({
        path: './sessions',
        retries: 0,
        ttl: 1000 * 60 * 60 * 24
    }),
    secret: process.env.SESSION_SECRET || 'default_secret_key',
    resave: true,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 1 day
        secure: false,  //(when http)
        // secure: true,
  
    }
}))

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const form = new FormData();
form.append('content', fs.createReadStream('./myfile.pdf'));
form.append('parent_id', 'your_folder_id');

axios.post('https://workdrive.zoho.com/api/v1/upload', form, {
  headers: {
    ...form.getHeaders(),
    Authorization: 'Zoho-oauthtoken YOUR_ACCESS_TOKEN'
  }
}).then(res => {
  console.log('Upload Success:', res.data);
}).catch(err => {
  console.error('Upload Error:', err.response?.data || err.message);
});


app.mysqlClient.getConnection(function (err, connection){
    if (err) {
        console.log(err)
    } else {
        console.log('mysql connected')
        connection.release() // Always release back to pool

        app.mysqlClient.on('connection', (connection) => {
            connection.query(/*sql*/`SET time_zone = '+05:30'`, (err) => {
                if (err) {
                    console.error('Failed to set MySQL timezone:', err)
                } else {
                    console.log('MySQL timezone set to +05:30 for this connection')
                }
            })
        })

        // users(app)
        // projects(app)
        // timeSheet(app)
        // dashBoard(app)

        app.listen(process.env.APP_PORT, () => {
            // logger.info(`listen ${process.env.APP_PORT} port`)
            console.log(`start on ${process.env.APP_PORT}`)
        })
    }
})