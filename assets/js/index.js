'use strict';

function dirname(path){
  return path.replace(/\\/g,'/').replace(/\/[^\/]*$/, '') + '/';
}
function basename(path){
  return path.replace(/\\/g,'/').replace( /.*\//, '' );
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
  $scope.path  = [];
  $scope.files = [];

  $scope.encodePath = function(directory, file){
    var x = directory.join('/');
    if(file) x += '/'+file;
    return encodeURIComponent(x);
  };
  $scope.makeLink = function(path, file){ // need to encode twice in templates since the browser decodes the link
    var type = !file || _.last(file) == "/" ? 'files' : 'source';
    var link = type + '/' + escape($scope.encodePath(path, file))
    if($routeParams.spec)
      link += '/spec/' + escape(encodeURIComponent($routeParams.spec));
    return link;
  };

  // gets called on every route change :(
  // alternative would be to add a route with a controller and a templateUrl pointing to a dummy file
  $scope.$on('$routeChangeSuccess', function(ev){
    // console.log($routeParams);
    if($routeParams.source){
      $scope.$parent.title = basename($routeParams.source);
      $scope.loadFiles(dirname($routeParams.source));
    }else if($routeParams.files){
      $scope.loadFiles($routeParams.files);
      $scope.$parent.title = $routeParams.files;
    }else{
      $scope.$parent.title = "";
    }
  });

  $scope.loadFiles = function(path){
    path = path ? path.split('/') : $scope.path;
    $http.get('/files/'+$scope.encodePath(path))
    .success(function(data){
      $scope.path  = data.path;
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
