'use strict';

// path handling
function dirname(path){   return path.replace(/\\/g, '/').replace(/\/[^\/]*$/, '') + '/'; }
function basename(path){  return path.replace(/\\/g, '/').replace(/.*\//, ''); }
function extension(path){ return path.substr(path.lastIndexOf(".")+1); }
// functional stuff
function filterMap(xs, f){ return _.chain(xs).map(f).compact().value(); };
// REST
function postToNewWindow(url, values){
    var form = $("#helperform");
    form.children("input").remove();
    for(var k in values){
      form.append($('<input type="hidden" name="'+k+'"/>').val(values[k]));
    }
    form.attr("action", url).submit();
}


// angular
var app = angular.module('goblint', ['ngRoute', 'ngResource', 'ui']);
app.config(function ($routeProvider, $locationProvider) {
    $routeProvider
      // .when('/', {}) // routes only used if a ng-view exists :(
      .when('/files/:files', {})
      .when('/files/:files/spec/:spec', {})
      .when('/source/:source', {})
      .when('/spec/:spec', {})
      .when('/source/:source/spec/:spec', {}) // no optional routes :(
      .otherwise({
        redirectTo: '/source/' + encodeURIComponent('tests/regression/18-file/01-ok.c') + '/spec/' + encodeURIComponent('src/spec/file.spec')
      });
      //- $locationProvider.html5Mode(true); // html5 pushState
  })
  .value('ui.config', {
    jq: {tooltip: {container: 'body'}} // placement: 'right'
  });

app.factory("glob", function(){
  return {shared:
    {ana: null,
     spec: {file: null, editor: null,
            isSaved: function(){ return this.file && this.editor.isClean(); }
           },
     analyze: function(){}
    }};
});


app.controller("DirectoryCtrl", function ($scope, $http, $location, $routeParams) {
  $scope.cwd   = "";
  $scope.files = [];

  $scope.makeLink = function(filename, isAbs){ // need to encode twice in templates since the browser decodes the link
    var type = _.last(filename) == "/" ? "files" : extension(filename) == "spec" ? "spec" : "source";
    var path = isAbs ? filename : $scope.cwd + filename;
    var link = type + '/' + escape(encodeURIComponent(path));
    if($routeParams.spec && type != "spec")
      link += "/spec/" + escape(encodeURIComponent($routeParams.spec));
    if($routeParams.source && type == "spec")
      link = "source/" + escape(encodeURIComponent($routeParams.source)) + '/' + link;
    return link;
  };
  $scope.breadcrumb = function(i){
    if(i == undefined) return $scope.cwd.split('/');
    return $scope.makeLink(dirname($scope.cwd.split('/').slice(0, i+2).join('/')), true);
  }
  $scope.isLoaded = function(filename){
    var path = $scope.cwd + filename;
    return path == $routeParams.source || path == $routeParams.spec;
  };
  $scope.loadFiles = function(path){
    if(!path) path = $scope.cwd;
    $http.get('/files/'+encodeURIComponent(path))
    .success(function(data){
      $scope.cwd = path;
      $scope.files = data.files;
    })
    .error(function(){
      console.log('could not load directory');
      alert("The directory doesn't exist! Redirecting...");
      if(history.length > 1){
        history.back();
      }else{
        $location.path("/");
      }
    });
  };

  var socket = io.connect('http://localhost');
  socket.on('files', function(files){
    console.log('socket.io: files updated');
    $scope.loadFiles();
  });

  // alternative would be to add a route with a controller and a templateUrl pointing to a dummy file
  $scope.$on('$routeChangeSuccess', function(ev){
    // console.log($routeParams);
    var file = $routeParams.source || $routeParams.spec;
    if(file && !$routeParams.files){
      $scope.$parent.title = basename(file);
      $scope.loadFiles(dirname(file));
    }else if($routeParams.files){
      $scope.loadFiles($routeParams.files);
      $scope.$parent.title = $routeParams.files;
    }else{
      $scope.$parent.title = "";
    }
  });
});


app.controller("SourceCtrl", function ($scope, $http, $location, $routeParams, glob) {
  $scope.compile_error = false;
  $scope.cmd = "cat test.txt";
  // goblint options
  $scope.goblint = {compile: false,
                    ana: localStorage.ana || "file",
                    file: {optimistic: true},
                    options: "--sets result none"};
  glob.shared.ana = $scope.goblint.ana;
  $scope.shared = glob.shared;

  $scope.$watch("goblint", function(curr, prev){
    if(prev==curr) return; // somehow the first time call of watch is wrong
    if(prev.ana != curr.ana){
      glob.shared.ana = localStorage.ana = curr.ana; // update shared var and localStorage
      if(curr.ana == "spec"){
        // CodeMirror has a problem with being hidden (needs refresh before it shows anything)
        // watch fires before ng-show makes editor visible. no events :(
        var refreshEditor = function(){
          if($("#spec").is(":visible")){
            glob.shared.spec.editor.refresh();
          }else{
            _.delay(refreshEditor, 200);
          }
        };
        refreshEditor();
      }
    }
    $scope.analyze();
  }, true); // rerun analyze on change

  var isSaved = function(){ // no unsaved content
    return $scope.ref.file && $scope.ref.editor.isClean();
  };
  var routeData = function(action){
    var url = '/'+action;
    if($scope.ref.file)
      url += '/'+encodeURIComponent($scope.ref.file);
    var data = isSaved() ? {} : {content: $scope.ref.editor.getValue()};
    return {url: url, data: data};
  };
  $scope.run = function(){  // extension to btn-toolbar
    $scope.cmd_error = false;
    var cfg = routeData('run');
    $http.post(cfg.url, cfg.data).success(function(data){
      console.log("compile and run", $scope.ref.file);
      $scope.output = data;
      $scope.compile_error = false;
    })
    .error(function(data){
      $scope.output = data;
      $scope.compile_error = true;
    });
  };
  $scope.shell = function(){
    $http.post("/shell", {cmd: $scope.cmd}).success(function(data){
      $scope.output = data;
      $scope.cmd_error = false;
    })
    .error(function(data){
      $scope.output = data;
      $scope.cmd_error = true;
    });
  };
  $scope.cfg = function(){
    var cfg = routeData('cfg');
    if(isSaved()){
      window.open(cfg.url);
    }else{
      postToNewWindow(cfg.url, cfg.data);
    }
  };
  $scope.analyze = _.debounce(function(){
    console.log("analyze");
    $scope.ref.clearWarnings();
    $scope.cmd_error = false;
    var cfg = routeData('result');
    var o = $scope.goblint;
    cfg.data.compile = o.compile;
    // construct goblint cmdline options
    var x = [];
    x.push("--sets ana.activated[0][+] "+o.ana);
    if(o.ana == "file"){
      x.push("--set ana.file.optimistic "+o.file.optimistic);
    }
    if(o.ana == "spec"){
      if(glob.shared.spec.isSaved()){
        x.push("--sets ana.spec.file "+glob.shared.spec.file);
      }else{
        cfg.data.spec = {file: glob.shared.spec.file, content: glob.shared.spec.editor.getValue()};
      }
    }
    x = x.concat(o.options.trim().split(", "));
    cfg.data.options = x;
    $http.post(cfg.url, cfg.data).success(function(data){
      $scope.output = data;
      $scope.compile_error = false;
      var xs = filterMap(data.split('\n'), function(x){
        // MAYBE writing to unopened file handle fp [30m(/home/ralf/analyzer/tests/regression/18-file/03-if-close.c:9)[0;0;00m
        var m = /(MAYBE )?(.*?) .{5}\(.*?:(.*?)\)/.exec(x);
        if(m) return [parseInt(m[3]), m[2], m[1]=="MAYBE "];
      });
      xs.forEach(function(x){ $scope.ref.warnText.apply(this, x); });
    })
    .error(function(data){
      $scope.output = data;
      $scope.compile_error = true;
    });
  }, 200);
  glob.shared.analyze = _.after(2, $scope.analyze); // ignore first call from spec init (just loaded, no change)
  $scope.handle = function(event, data){
    // console.log("handle", event, "for", $scope.ref.id);
    switch(event){
      case "files":
        $scope.loadFiles();
        break;
      case "change":
        // console.log("change");
        $scope.analyze();
        break;
    }
  };
});


app.controller("SpecCtrl", function ($scope, $http, $location, $routeParams, glob) {
  $scope.shared = glob.shared;

  $scope.updateGraph = _.debounce(function(){
    console.log("update graph!");
    $http.post('/spec/dot', {content: $scope.ref.editor.getValue()})
    .success(function(data){
      $('#graph').html(Viz(data, "svg"));
      $scope.error_line = false;
      $scope.ref.clearWarnings();
      glob.shared.analyze();
    })
    .error(function(data){
      console.log(data);
      var lineno = /Line (.*?):/.exec(data);
      if(lineno){
        $scope.error_line = lineno[1];
        $scope.ref.clearWarnings();
        $scope.ref.warnMarker(lineno[1]);
      }
    });
  }, 200);
  $scope.openImage = function(){
    postToNewWindow("/spec/png", {content: $scope.ref.editor.getValue()});
  };
  $scope.handle = function(event, data){
    // console.log("handle", event, "for", $scope.ref.id);
    switch(event){
      case "files":
        $scope.loadFiles();
        break;
      case "init":
        glob.shared.spec.editor = $scope.ref.editor;
        break;
      case "load":
      case "new": // data.file is null then
        glob.shared.spec.file = data.file;
        break;
      case "change":
        $scope.updateGraph();
        break;
    }
  };
});
