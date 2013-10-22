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

# configure paths
srcPath = path.normalize(__dirname + if fs.existsSync "../tests" then "/.." else "/tmp") # goblint path (should be root of git repo), otherwise use tmp
fs.mkdirSync "tmp" unless fs.existsSync "tmp/"
specBin = path.join(srcPath, "_build/src/mainspec.native")
if not fs.existsSync specBin
  return console.error "init failed: spec binary not found in", specBin
goblintBin = path.join(srcPath, "goblint")
if not fs.existsSync goblintBin
  return console.error "init failed: goblint binary not found in", goblintBin
src = (x, y) -> if x then path.join(srcPath, decodeURIComponent(x)) else y

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
  app.use "/html", express.static(srcPath + "/result")

app.configure "development", -> # default, if NODE_ENV is not set
  app.use express.errorHandler()

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
    sys.print "stderr:", stderr if error
    res.send stdout

# generic way to allow 'get action file' and 'post action file? value'
app.handleFile = (route, options, clb) -> # clb is (req, res, file)
  # set default options
  options.get ?= false
  options.writeFile ?= true
  if options.get
    app.get route+"/:file", (req, res) -> # use if file's content should be used
        clb req, res, src(req.params.file)
  app.post route+"/:file?", (req, res) -> # use if there are unsaved changes (file is optional)
    # somehow goblint and clang have problem with files that don't end in .c
    file = src(req.params.file, "tmp.c")
    if req.body.content? 
      content = if options.writeFile then req.body.content else null
      tmpFile req, file, content, (tmpPath) ->
        clb req, res, tmpPath
    else # file is clean -> no need to write a temporary file
      clb req, res, file

tmpFile = (req, file, content, clb) -> # get tmpName from session or new one, write content to file if set
  k = (file) -> # write content to file if there is any and continue
    fs.writeFileSync file, content if content?
    clb file
  req.session.tmp ?= {} # init tmp hash in session
  if file of req.session.tmp # user already has a tmp name for that file (avoid creating a new file for every request)
    k path.resolve(req.session.tmp[file])
  else # use a new tmp file
    tmp.tmpName {template: "./tmp/"+path.basename file+"-XXXXXX"+path.extname file}, (err, tmpPath) ->
      req.session.tmp[file] = tmpPath # update session
      k path.resolve(tmpPath)

# SourceCtrl
compile = (req, res, file, success) ->
  tmpFile req, file, null, (tmpPath) ->
    cmd = "clang "+file+" -o "+tmpPath
    console.log "compiling:", cmd
    exec cmd, (error, stdout, stderr) ->
      if error
        res.send 500, stderr
      else
        success(tmpPath)

app.handleFile "/result", {}, (req, res, file) ->
  analyze = () ->
    cmd = goblintBin+" "+req.body.options.join(" ")+" "+path.relative(srcPath, file)
    console.log cmd
    exec cmd+" 2>&1", {cwd: srcPath}, (error, stdout, stderr) ->
      if error
        res.send 500, stdout
      else
        res.send stdout
  writeSpec = () ->
    if not req.body.spec?.content?
      analyze() # spec is already saved and given as option
    else
      tmpFile req, req.body.spec.file or "tmp.spec", req.body.spec.content, (tmpPath) ->
        req.body.options.push "--sets ana.spec.file "+path.relative(srcPath, tmpPath)
        analyze()
  if req.body.compile
    compile req, res, file, writeSpec
  else
    writeSpec()

app.handleFile "/run", {}, (req, res, file) ->
  compile req, res, file, (bin) ->
    exec "./"+path.basename(bin)+" 2>&1", cwd: path.dirname(bin), (error, stdout, stderr) ->
      res.send stdout

app.post "/shell", (req, res) ->
  exec req.body.cmd, cwd: "./tmp", (error, stdout, stderr) ->
    if error
      res.send 500, stderr
    else
      res.send stdout

app.handleFile "/cfg", {get: true}, (req, res, file) ->
  console.log "generating cfg for file", file
  cmd = goblintBin+" --enable justcfg "+file+" &>/dev/null && cat cfg.dot"
  console.log cmd
  exec cmd, cwd: "./tmp", (error, stdout, stderr) ->
    # escape quotes in labels, otherwise dot fails!
    escaped = stdout # fixed in goblint
    # re = /label ?= ?"(.*?)"] ?;/g
    # while m = re.exec(stdout)
    #   x = m[1]
    #   x = x.replace(/\\/g, '\\\\')
    #   x = x.replace(/"/g, '\\"')
    #   escaped = escaped.replace(m[1], x)
    dot = spawn "dot", ["-Tpng"]
    dot.stdout.pipe res
    dot.stdin.write escaped
    dot.stdin.end()

# SpecCtrl
app.post "/spec/:type", (req, res) ->
  console.log "convert spec to type", req.params.type
  spec = spawn specBin, ["-"]
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
