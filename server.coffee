express = require("express")
path = require("path")
fs = require("fs")
# eyes = require("eyes")
# xml2js = require("xml2js")
# xmlParser = new xml2js.Parser()
sys = require("sys")
exec = require("child_process").exec
spawn = require("child_process").spawn
tmp = require("tmp")
tmp.setGracefulCleanup() # cleanup the temporary files even when an uncaught exception occurs
pause_stream = require('pause-stream')
app = express()
# socket.io
server = require("http").createServer(app)
io = require("socket.io").listen(server)
io.set 'log level', 1

# configure express
app.configure ->
  # app.use(express.logger());
  app.set "port", process.env.PORT or 3000
  app.set "views", __dirname + ""
  app.use express.compress()
  app.use express.bodyParser() # needed for req.files
  app.use express.methodOverride() # hidden input _method for put/del
  app.use require('connect-assets')()
  app.use express.static(__dirname + "/public")

app.configure "development", -> # default, if NODE_ENV is not set
  app.use express.errorHandler()

# configure paths
srcPath = path.normalize(__dirname + if fs.existsSync "../tests" then "/.." else "/tmp") # goblint path (should be root of git repo), otherwise use tmp
fs.mkdirSync "tmp" unless fs.existsSync "tmp/"


# functions
Array::partition = (p) ->
  @.reduce (([a,b], c) -> if p(c) then [a.concat(c),b] else [a,b.concat(c)]), [[],[]]

# routes
app.get "/", (req, res) ->
  res.render "index.jade",
    node_env: process.env.NODE_ENV ? "development"

app.get "/partial/:name", (req, res) ->
  res.render req.params.name+".jade"

# DirectoryCtrl
splitPath = (x) ->
  x = if x.substr(-1) == '/' then x.substr(0, x.length-1) else x # remove trailing slash
  x.split(path.sep)
gitModified = (absPath, relPath, clb) ->
  exec "git status --porcelain", {cwd: absPath}, (error, stdout, stderr) ->
    # console.log stdout
    xs = stdout.split("\n").map (x) -> x.substr(3, x.length) # drop status column
    xs.forEach (x) -> # take care of renamed files
      a = x.split " -> "
      if a.length is 2
        xs.push a[0], a[1]
        xs.splice(xs.indexOf(x), 1)
    xs = xs.filter (x) -> x.indexOf(relPath) == 0 # ignore files that are not in path
    xs = xs.map (x) -> x.substr(relPath.length+1, x.length) # remove path prefix
    clb(xs)
app.get "/files/:path?", (req, res) ->
  absPath = if req.params.path then path.join(srcPath, decodeURIComponent(req.params.path)) else srcPath
  relPath = path.relative(srcPath, absPath)
  console.log "reading path", absPath, relPath
  fs.readdir absPath, (err, files) ->
    if not files
      res.send 404
      return
    [a,b] = files.partition (x) -> fs.statSync(path.join(absPath, x)).isDirectory()
    files = (a.map (x) -> x+'/').concat b
    gitModified absPath, relPath, (modifiedFiles) ->
      console.log "modified files in this path:", modifiedFiles
      files = files.map (x) -> {name: x, modified: modifiedFiles.indexOf(x) != -1}
      res.json path: splitPath(relPath), files: files

# FileCtrl (editor)
app.get "/file/:file", (req, res) ->
  file = path.join(srcPath, decodeURIComponent(req.params.file))
  if not fs.existsSync file
    console.log "file not found: ", file
    res.send 404
    return
  console.log "reading", file
  # (fs.createReadStream file).pipe res # streams file
  res.sendfile file

app.post "/file/:file", (req, res) ->
  file = path.join(srcPath, decodeURIComponent(req.params.file))
  if req.body.name
    newfile = path.join(path.dirname(file), req.body.name)
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

app.del "/file/:file", (req, res) ->
  file = path.join(srcPath, decodeURIComponent(req.params.file))
  console.log "deleting", file
  fs.unlink file, (err) ->
    if err
      console.log "error deleting file:", err
      res.send 500
    else
      res.send 200

app.post "/revert/:file", (req, res) ->
  file = path.join(srcPath, decodeURIComponent(req.params.file))
  console.log "reverting", file
  cmd = "git reset HEAD "+file+"; git checkout -- "+file
  exec cmd, {cwd: srcPath}, (error, stdout, stderr) ->
    sys.print "stderr:", stderr
    res.send stdout

# generic way to allow 'get action file' and 'post action file? value'
app.handleFile = (route, f) -> # f is (res, file, value?)
  app.get route+"/:file", (req, res) -> # use if file's content should be used
      f res, path.join(srcPath, decodeURIComponent(req.params.file))
  app.post route+"/:file?", (req, res) -> # use if there are unsaved changes (file is optional)
    baseFile = if req.params.file then path.basename req.params.file else "" # avoid 'undefined'
    # somehow goblint and clang have problem with files that don't end in .c
    tmp.tmpName {template: "./tmp/"+baseFile+"-XXXXXX"+path.extname(baseFile)}, (err, tmpPath) ->
      f res, path.resolve(tmpPath), req.body.value

# SourceCtrl
app.get "/result/:file", (req, res) ->
  file = path.join(srcPath, decodeURIComponent(req.params.file))
  cmd = "../goblint --sets ana.activated[0][+] file --sets result none "+file
  exec cmd, (error, stdout, stderr) ->
    sys.print "stderr:", stderr
    res.send stdout

app.handleFile "/run", (res, file, value) ->
  if value # write value to file (clang needs some file as input)
    fs.writeFileSync file, value
  baseFile = path.basename file
  tmp.tmpName {template: "./tmp/"+baseFile+"-XXXXXX"}, (err, tmpPath) ->
    console.log "temporary path:", tmpPath
    cmd = "clang "+file+" -o "+tmpPath
    exec cmd, (error, stdout, stderr) ->
      if error
        res.send 500, stderr
        return
      exec "./"+path.basename(tmpPath), cwd: path.dirname(tmpPath), (error, stdout, stderr) ->
        res.send stdout

app.handleFile "/cfg", (res, file, value) ->
  console.log "generating cfg for file", file
  if value # write value to file (goblint needs some file as input)
    fs.writeFileSync file, value
  cmd = "../../goblint --enable justcfg "+file+" && cat cfg.dot"
  console.log cmd
  exec cmd, cwd: "./tmp", (error, stdout, stderr) ->
    # remove goblint's non-multithreaded program warning from cfg.dot
    stdout = stdout.replace(/NB[\s\S]*?(digraph)/, "$1")
    # escape quotes in labels, otherwise dot fails!
    re = /label ?= ?"(.*?)"] ?;/g
    escaped = stdout
    while m = re.exec(stdout)
      x = m[1]
      x = x.replace(/\\/g, '\\\\')
      x = x.replace(/"/g, '\\"')
      escaped = escaped.replace(m[1], x)
    dot = spawn "dot", ["-Tpng"]
    dot.stdout.pipe res
    dot.stdin.write escaped
    dot.stdin.end()

# SpecCtrl
app.post "/spec/:type", (req, res) ->
  console.log "converting spec to type", req.params.type
  spec = spawn "../_build/src/mainspec.native", ["-"]
  ps = pause_stream().pause() # buffer output, otherwise can't change status since headers already sent
  if req.params.type == "dot"
    spec.stdout.pipe ps
    spec.stderr.pipe ps
  else if req.params.type == "png"
    dot = spawn "dot", ["-Tpng"]
    spec.stdout.pipe dot.stdin
    dot.stdout.pipe ps
  else
    console.log "unknown type"
    res.send 500, "unknown type"
    return
  spec.on "close", (code) ->
    if code isnt 0
      console.log "parsing spec failed"
      res.status 500
    ps.pipe res
    ps.resume()
  spec.stdin.write req.body.value
  spec.stdin.end()


# watch files and inform clients on changes
# TODO not recursive! -> use module that watches trees (e.g. mikeal/watch, paulmillr/chokidar, bevry/watchr) or handle each user with socket.io
watcher = fs.watch srcPath, (event, filename) ->
  console.log event: event, filename: filename
  io.sockets.emit 'files'

# watch = require("watch") # too slow
# watch.createMonitor srcPath, (monitor) ->
#   monitor.on "created", (f, stat) -> console.log "created", f
#   monitor.on "changed", (f, curr, prev) -> console.log "changed", f
#   monitor.on "removed", (f, stat) -> console.log "removed", f


server.listen app.get("port"), () ->
  console.log "server listening on port", app.get("port")
