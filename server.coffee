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
  app.use express.cookieParser()
  app.use express.session({secret: '1234567890QWERTY'})
  app.use express.bodyParser() # needed for req.files
  app.use express.methodOverride() # hidden input _method for put/del
  app.use require('connect-assets')()
  app.use express.static(__dirname + "/public")

app.configure "development", -> # default, if NODE_ENV is not set
  app.use express.errorHandler()

# configure paths
srcPath = path.normalize(__dirname + if fs.existsSync "../tests" then "/.." else "/tmp") # goblint path (should be root of git repo), otherwise use tmp
fs.mkdirSync "tmp" unless fs.existsSync "tmp/"
src = (x, y) -> if x then path.join(srcPath, decodeURIComponent(x)) else y

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
  absPath = src(req.params.path, srcPath)
  relPath = path.relative(srcPath, absPath)
  console.log "files", relPath
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
  file = src(req.params.file)
  if not fs.existsSync file
    console.log "file not found: ", file
    res.send 404
    return
  console.log "file", file
  # (fs.createReadStream file).pipe res # streams file
  res.sendfile file

app.post "/file/:file", (req, res) ->
  file = src(req.params.file)
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
  file = src(req.params.file)
  console.log "deleting", file
  fs.unlink file, (err) ->
    if err
      console.log "error deleting file:", err
      res.send 500
    else
      res.send 200

app.post "/revert/:file", (req, res) ->
  file = src(req.params.file)
  console.log "reverting", file
  cmd = "git reset HEAD "+file+"; git checkout -- "+file
  exec cmd, {cwd: srcPath}, (error, stdout, stderr) ->
    sys.print "stderr:", stderr
    res.send stdout

# generic way to allow 'get action file' and 'post action file? value'
app.handleFile = (route, options, f) -> # f is (req, res, file)
  # set default options
  options.get ?= false
  options.writeFile ?= true
  if options.get
    app.get route+"/:file", (req, res) -> # use if file's content should be used
        f req, res, src(req.params.file)
  app.post route+"/:file?", (req, res) -> # use if there are unsaved changes (file is optional)
    req.session.tmp ?= {} # init tmp hash in session
    file = src(req.params.file)
    fWrite = (file) ->
      if options.writeFile # write value to file
        fs.writeFileSync file, req.body.content
      f req, res, path.resolve(file)
    if not req.body.content? # file is clean -> no need to write a temporary file
      f req, res, file
    else if file of req.session.tmp # user already has a tmp name for that file (avoid creating a new file for every request)
      # console.log "reusing tmp file", req.session.tmp[file]
      fWrite req.session.tmp[file]
    else # use a new tmp file
      # somehow goblint and clang have problem with files that don't end in .c
      baseFile = if file then path.basename file else "tmp.c" # avoid 'undefined'
      tmp.tmpName {template: "./tmp/"+baseFile+"-XXXXXX"+path.extname baseFile}, (err, tmpPath) ->
        req.session.tmp[file] = tmpPath # save in session for this user
        fWrite tmpPath

# SourceCtrl
compile = (res, file, success) ->
  baseFile = path.basename file
  tmp.tmpName {template: "./tmp/"+baseFile+"-XXXXXX"}, (err, tmpPath) ->
    cmd = "clang "+file+" -o "+tmpPath
    console.log "compiling:", cmd
    exec cmd, (error, stdout, stderr) ->
      if error
        res.send 500, stderr
      else
        success(tmpPath)

app.handleFile "/result", {}, (req, res, file) ->
  analyze = () ->
    # console.log "goblint options:", req.body.options
    cmd = "./goblint "+req.body.options.join(" ")+" "+file # --sets result none
    console.log cmd
    exec cmd, {cwd: srcPath}, (error, stdout, stderr) ->
      if error
        sys.print "stderr:", stderr
        res.send 500, stderr
      else
        res.send stdout
  writeSpec = () ->
    if not req.body.spec?.content?
      analyze() # spec is already saved and given as option
    else
      req.session.tmp ?= {} # init tmp hash in session
      spec = req.body.spec.file or "tmp.spec"
      tmp.tmpName {template: "./tmp/"+path.basename spec+"-XXXXXX"+path.extname spec}, (err, tmpPath) ->
        if spec of req.session.tmp
          tmpPath = req.session.tmp[spec]
        else
          req.session.tmp[spec] = tmpPath # save in session for this user
        fs.writeFileSync tmpPath, req.body.spec.content
        req.body.options.push "--sets ana.spec.file "+path.resolve tmpPath
        analyze()
  if req.body.compile
    compile res, file, writeSpec
  else
    writeSpec()

app.handleFile "/run", {}, (req, res, file) ->
  compile res, file, (bin) ->
    exec "./"+path.basename(bin), cwd: path.dirname(bin), (error, stdout, stderr) ->
      res.send stdout

app.handleFile "/cfg", {get: true}, (req, res, file) ->
  console.log "generating cfg for file", file
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
  console.log "convert spec to type", req.params.type
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
  spec.stdin.write req.body.content
  spec.stdin.end()


# watch files and inform clients on changes
# TODO not recursive! -> use module that watches trees (e.g. mikeal/watch, paulmillr/chokidar, bevry/watchr) or handle each user with socket.io
# watcher = fs.watch srcPath, (event, filename) ->
#   console.log event: event, filename: filename
#   io.sockets.emit 'files'

# watch = require("watch") # too slow
# watch.createMonitor srcPath, (monitor) ->
#   monitor.on "created", (f, stat) -> console.log "created", f
#   monitor.on "changed", (f, curr, prev) -> console.log "changed", f
#   monitor.on "removed", (f, stat) -> console.log "removed", f


server.listen app.get("port"), () ->
  console.log "server listening on port", app.get("port")
