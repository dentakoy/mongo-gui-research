#!/usr/bin/env node
// eslint-disable-next-line strict
require('dotenv').config();
const cors = require('cors');
const argv = require('minimist')(process.argv.slice(2));
const express = require('express');
const bodyParser = require('body-parser');
const gzipProcessor = require('connect-gzip-static');
// const updateNotifier = require('update-notifier'); commeting this as its dependents have vulnarablities
const winston = require('winston');
require('winston-daily-rotate-file');


const fs = require('fs');
const https = require('https');

const dataAccessAdapter = require('./src/db/dataAccessAdapter');
const databasesRoute = require('./src/routes/database');
const authMiddleware = require('./src/controllers/auth');

// notify users on new releases - https://github.com/arunbandari/mongo-gui/issues/5
// const pkg = require('./package.json');
// updateNotifier({ pkg }).notify();

// initialize app
const app = express();


const serName = 'mongo-gui'

//Путь до дириктории логфайлов
const logDirName = `/var/log/${serName}/`

const transport = new winston.transports.DailyRotateFile({
    level: 'info',
    filename: `${logDirName}${serName}.%DATE%.log`,
    datePattern: 'DD.MM.YYYY',
    zippedArchive: false,
    maxSize: '2m',
    maxFiles: '32d'
});

transport.on('rotate', function(oldFilename, newFilename) {
    console.log(`Новый файл лога ${newFilename}, старый файл лога${oldFilename}`);
});
  

// Настройка логгера
const logger = winston.createLogger({
    level: 'info', // Уровень логирования
    format: winston.format.simple(), // Формат логов
    transports: [
      new winston.transports.Console(), // Вывод в консоль
      transport
    ]
});

// Глобальный обработчик ошибок
process.on('uncaughtException', function (err) {
    // Записываем ошибку в лог
    logger.error(err.stack);
});


function logToLogger(...args) {
    const time = new Date().toLocaleString();
    const message    = args.map(arg => {
        return typeof arg === 'object' ? JSON.stringify(arg) : arg
    })
    logger.info(`${time} ${message}`);
}

console.log = (...args) => logToLogger(...args);
console.error = (...args) => logToLogger(...args);
console.debug = (...args) => logToLogger(...args);
console.info = (...args) => logToLogger(...args);
console.trace = (...args) => logToLogger(...args);
console.warn = (...args) => logToLogger(...args);

// middleware for simple authorization.
app.use(authMiddleware.auth);

// serve static files form public
app.use(express.static('public'));

// process gzipped static files
app.use(gzipProcessor(__dirname + '/public'));

// enables cors
app.use(cors());

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json({ limit: process.env.BODY_SIZE || '50mb' }));

// api routing
app.use('/databases', databasesRoute);

// serve home page
app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

// connect to database
dataAccessAdapter.InitDB(app);

const sslCertificatePath    = argv.c || process.env.SSL_CERT    || 'cert.pem';
const sslCertificateKeyPath = argv.k || process.env.SSL_KEY     || 'key.pem';

const sslCertificate        = fs.readFileSync(sslCertificatePath);
const sslCertificateKey     = fs.readFileSync(sslCertificateKeyPath);

const serverOptions = {
  key:  sslCertificateKey,
  cert: sslCertificate,
}

const server = https.createServer(serverOptions, app);


// listen on :port once the app is connected to the MongoDB
app.once('connectedToDB', () => {
  const port = argv.p || process.env.PORT || 4321;
  const host = argv.l || process.env.LISTEN_ADDRESS || 'localhost';
  server.listen(port, host, () => {
    console.log(`> Access Mongo GUI at https://${host}:${port}`);
  });
});

// error handler
app.use((err, req, res, next) => {
  console.log(err);
  const error = {
    errmsg: err.errmsg,
    name: err.name,
  };
  return res.status(500).send(error);
});
