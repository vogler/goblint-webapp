express = require("express")
path = require("path")
fs = require("fs")
eyes = require("eyes")
xml2js = require("xml2js")
xmlParser = new xml2js.Parser()
sys = require("sys")
exec = require("child_process").exec
app = express()

# configure server
app.configure ->
  # app.use(express.logger());
  app.set "port", process.env.PORT or 3000
  app.set "views", __dirname + ""
  app.use express.bodyParser() # needed for req.files
  app.use express.methodOverride() # hidden input _method for put/del
  app.use require('connect-assets')()
  app.use express.static(__dirname + "/public")

app.configure "development", -> # default, if NODE_ENV is not set
  app.use express.errorHandler()


# configure paths
srcPath = __dirname + "/../tests/regression/17-file/"

# routes
app.get "/", (req, res) ->
  fs.readdir srcPath, (err, files) ->
    res.render "index.jade",
      pageTitle: "Goblint"
      files: files
      node_env: process.env.NODE_ENV ? "development"

app.get "/source/:file", (req, res) ->
  file = path.join(srcPath, req.params.file)
  if not fs.existsSync file
    console.log "file not found: ", file
    res.send 404
    return
  console.log "reading", file
  (fs.createReadStream file).pipe res # streams file

app.post "/source/:file", (req, res) ->
  file = path.join(srcPath, req.params.file)
  if req.body.name
    newfile = path.join(srcPath, req.body.name)
    console.log "renaming", file, "to", newfile
    fs.rename file, newfile, (err) ->
      if err
        console.log "error renaming file:", err
        res.send 500
      else
        res.send 200
  if req.body.value
    console.log "saving", file
    fs.writeFile file, req.body.value, (err) ->
      if err
        console.log "error writing to file:", err
        res.send 500
      else
        res.send 200

app.del "/source/:file", (req, res) ->
  file = path.join(srcPath, req.params.file)
  console.log "deleting", file
  fs.unlink file, (err) ->
    if err
      console.log "error deleting file:", err
      res.send 500
    else
      res.send 200

app.get "/result/:file", (req, res) ->
  file = path.join(srcPath, req.params.file)
  cmd = "../goblint --sets result pretty "+file
  exec cmd, (error, stdout, stderr) ->
    # sys.print "stderr:", stderr
    res.send stdout

watcher = fs.watch srcPath, (event, filename) ->
  console.log event: event, filename: filename
  # watcher.close()

app.listen app.get("port"), () ->
  console.log "server listening on port", app.get("port")
