'use strict';

function dirname(path){
  return path.replace(/\\/g,'/').replace(/\/[^\/]*$/, '') + '/';
}
function basename(path){
  return path.replace(/\\/g,'/').replace( /.*\//, '' );
}
function extension(path){
  return path.substr(path.lastIndexOf(".")+1);
}

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


app.controller("SourceCtrl", function ($scope, $http, $location, $routeParams) {
  $scope.compile_error = false;

  $scope.run = function(){  // extension to btn-toolbar
    var file = $scope.ref.file;
    if(!$scope.ref.editor.isClean() || !$scope.ref.file){
      $scope.ref.save();
    }
    $http.get('/run/'+encodeURIComponent(file))
    .success(function(data){
      console.log("compile and run", file);
      $scope.output = data;
      $scope.compile_error = false;
    })
    .error(function(data){
      $scope.output = data;
      $scope.compile_error = true;
    });
  };
  $scope.handle = function(event, data){
    // console.log("handle", event, "for", $scope.ref.id);
    switch(event){
      case "files":
        $scope.loadFiles();
        break;
      case "load":
        $http.get('/result/'+encodeURIComponent(data.file))
        .success(function(data){
          $scope.output = data;
          $scope.compile_error = false;
        });
        break;
    }
  };
});


app.controller("SpecCtrl", function ($scope, $http, $location, $routeParams) {
  $scope.updateGraph = _.debounce(function(){
    console.log("update graph!");
    $http.post('/spec/dot', {value: $scope.ref.editor.getValue()})
    .success(function(data){
      $('#graph').html(Viz(data, "svg"));
      $scope.error_line = false;
    })
    .error(function(data){
      console.log(data);
      var lineno = /Line (.*?):/.exec(data);
      if(lineno){
        $scope.error_line = lineno[1];
      }
    });
  }, 200);
  $scope.openImage = function(){
    $("#spec-controls [name=value]").val($scope.ref.editor.getValue());
    $("#spec-controls form").submit();
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
