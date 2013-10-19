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
  return {shared: {ana: null}};
});


app.controller("DirectoryCtrl", function ($scope, $http, $location, $routeParams, glob) {
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
    glob.shared.spec = $routeParams.spec ? decodeURIComponent($routeParams.spec) : null;
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
  $scope.shared = glob.shared;
  // goblint options
  $scope.goblint = {compile: false,
                    ana: "file",
                    file: {optimistic: true},
                    options: "--sets result none"};
  $scope.$watch("goblint", function(){$scope.analyze()}, true); // rerun analyze on change

  var isClean = function(){
    return $scope.ref.editor.isClean() && $scope.ref.file;
  };
  var routeData = function(action){
    var url = '/'+action;
    if($scope.ref.file)
      url += '/'+encodeURIComponent($scope.ref.file);
    var data = isClean() ? {} : {value: $scope.ref.editor.getValue()};
    return {url: url, data: data};
  };
  $scope.run = function(){  // extension to btn-toolbar
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
  $scope.cfg = function(){
    var cfg = routeData('cfg');
    if(isClean()){
      window.open(cfg.url);
    }else{
      postToNewWindow(cfg.url, cfg.data);
    }
  };
  $scope.analyze = _.debounce(function(){
    $scope.ref.clearWarnings();
    var cfg = routeData('result');
    var o = $scope.goblint;
    glob.shared.ana = o.ana;
    cfg.data.compile = o.compile;
    // construct goblint cmdline options
    var x = [];
    x.push("--sets ana.activated[0][+] "+o.ana);
    if(o.ana == "file"){
      x.push("--set ana.file.optimistic "+o.file.optimistic);
    }
    if(o.ana == "spec" && glob.shared.spec){
      x.push("--sets ana.spec.file "+glob.shared.spec);
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
  $scope.handle = function(event, data){
    // console.log("handle", event, "for", $scope.ref.id);
    switch(event){
      case "files":
        $scope.loadFiles();
        break;
      case "change":
        $scope.analyze();
        break;
    }
  };
});


app.controller("SpecCtrl", function ($scope, $http, $location, $routeParams, glob) {
  $scope.shared = glob.shared;
  $scope.updateGraph = _.debounce(function(){
    console.log("update graph!");
    $http.post('/spec/dot', {value: $scope.ref.editor.getValue()})
    .success(function(data){
      $('#graph').html(Viz(data, "svg"));
      $scope.error_line = false;
      $scope.ref.clearWarnings();
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
    postToNewWindow("/spec/png", {value: $scope.ref.editor.getValue()});
  };
  $scope.handle = function(event, data){
    // console.log("handle", event, "for", $scope.ref.id);
    switch(event){
      case "files":
        $scope.loadFiles();
        break;
      case "change":
        $scope.updateGraph();
        break;
    }
  };
});
