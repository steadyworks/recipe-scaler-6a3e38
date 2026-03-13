const http = require('http')
const fs = require('fs')
const path = require('path')

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(HTML)
}).listen(3000, '0.0.0.0')
