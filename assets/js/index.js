'use strict';

var app = angular.module('goblint', ['ngRoute', 'ngResource', 'ui']);
app.config(function ($routeProvider, $locationProvider) {
    $routeProvider
      // .when('/', {})
      .when('/files/:files', {})
      .when('/file/:file', {}) // only used if a ng-view exists :(
      .otherwise({
        redirectTo: '/files/' + encodeURIComponent('tests/regression/18-file')
      });
      //- $locationProvider.html5Mode(true); // html5 pushState
  })
  .value('ui.config', {
    jq: {tooltip: {container: 'body'}} // placement: 'right'
  });

console.log("angular-ui ok");

function SourceCtrl($scope, $http, $location, $routeParams){
  // $scope.path  = 'tests/regression/18-file'.split('/');
  $scope.path  = [];
  $scope.files = [];

  $scope.encodePath = function(directory, file){
    var x = directory.join('/');
    if(file) x += '/'+file;
    return encodeURIComponent(x);
  };
  $scope.makeLink = function(path, file){ // need to encode twice in templates since the browser decodes the link
    var type = !file || _.last(file) == "/" ? 'files' : 'file';
    return type + '/' + escape($scope.encodePath(path, file));
  };
  function dirname(path) {
    return path.replace(/\\/g,'/').replace(/\/[^\/]*$/, '');;
  }

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

  $scope.loadSpec = function(specFile){
    $http.get('/file/'+encodeURIComponent(specFile))
    .success(function(data){
      spec.setValue(data);
      spec.markClean();
      $('#spec-error').hide();
    });
  };
  $scope.loadSpec('src/spec/file.spec');

  $scope.updateGraph = function(){
    console.log("update graph!");
    var parseError = function(failed){
      $('#spec-error').toggle(failed);
      $('#spec-controls').toggle(!failed);
    };
    $http.post('/spec/dot', {value: spec.getValue()})
    .success(function(data){
      $('#graph').html(Viz(data, "svg"));
      parseError(false);
    })
    .error(function(data){
      console.log(data);
      var lineno = /Line (.*?):/.exec(data);
      if(lineno){
        $scope.spec_error_line = lineno[1];
      }
      parseError(true);
    });
  }

  $scope.newFile = function(text){
    if(!text) text = "";
    $scope.selectedFile = null;
    source.setValue(text);
    source.clearHistory();
    source.markClean();
    sourceChanged();
    $('#result').hide();
  };
  $scope.loadFile = function(file){
    if(!file) file = $routeParams.file;
    var encFile = encodeURIComponent(file);
    $http.get('/file/'+encFile)
    .success(function(data){
      $scope.newFile(data);
      $scope.selectedFile = _.last(file.split('/'));
      var path = dirname(file).split('/');
      if($scope.path.join('/') != path.join('/')){
        $scope.path = path;
        $scope.loadFiles();
      }
      console.log("loaded file", file);
      $http.get('/result/'+encFile)
      .success(function(data){
        $('#result').show();
        $("#compile-error").hide();
        $('#output').text(data);
      });
    })
    .error(function(){
      console.log('could not load file', file);
      alert("The file "+file+" doesn't exist! Redirecting...");
      if(history.length > 1){
        history.back();
      }else{
        $location.path("/");
      }
    });
  };
  // gets called on every route change :(
  // alternative would be to add a route with a controller and a templateUrl pointing to a dummy file
  $scope.$on('$routeChangeSuccess', function(ev){
    // console.log($location, $routeParams);
    if($routeParams.file){
      $scope.loadFile();
      $scope.$parent.title = $routeParams.file;
    }else if($routeParams.files){
      $scope.newFile();
      $scope.loadFiles($routeParams.files);
      $scope.$parent.title = $routeParams.files;
    }else{
      $scope.newFile();
      $scope.$parent.title = "";
    }
  });
  $scope.$on('$locationChangeStart', function(ev){
    if(!source.isClean() || !spec.isClean()){
      if(!confirm("You have unsaved changes! Discard them?"))
        ev.preventDefault(); // stopPropagation
    }
  });

  $scope.saveFile = function(){
    var file = encodeURIComponent($routeParams.file);
    var isNew = false;
    if(!file){
      file = prompt("New filename:");
      if(!file) return;
      file = $scope.encodePath($scope.path, file);
      isNew = true;
    }
    var url = '/file/'+file;
    $http.post(url, {value: source.getValue()})
    .success(function(){
      source.markClean();
      sourceChanged();
      console.log("saved file", file);
      if(isNew){
        $location.path(url);
      }
      $scope.loadFiles();
    });
  };
  $scope.renameFile = function(){
    if(!source.isClean()){
      alert("File is dirty, safe first!");
      return;
    }
    var name = prompt("New filename:");
    if(!name) return;
    $http.post('/file/'+encodeURIComponent($routeParams.file), {name: name})
    .success(function(){
      console.log("renamed file", $routeParams.file, "to", name);
      $location.path("/file/"+$scope.encodePath(dirname($routeParams.file).split('/'), name));
      $scope.loadFiles();
    });
  };
  $scope.deleteFile = function(){
    if(!confirm("Delete the file?")) return;
    $http.delete('/file/'+encodeURIComponent($routeParams.file))
    .success(function(){
      $location.path("/");
      $scope.loadFiles();
    });
  };
  $scope.revertFile = function(){
    var file = $routeParams.file;
    $http.post('/revert/'+encodeURIComponent(file))
    .success(function(data){
      console.log("reverted", file, ": ", data);
      $scope.loadFile();
      $scope.loadFiles();
    });
  };
  $scope.runFile = function(){
    var file = $routeParams.file;
    if(!source.isClean()){
      $scope.saveFile();
    }
    $http.get('/run/'+encodeURIComponent(file))
    .success(function(data){
      console.log("compile and run", file);
      $('#output').text(data);
      $("#compile-error").hide();
    })
    .error(function(data){
      $('#output').text(data);
      $("#compile-error").show();
    });
  };
}

function selectTheme() {
  var theme = $("#theme").val();
  var file = theme.split(' ')[0]+'.css';
  if(theme!="default" && !$("head link[rel='stylesheet'][href*='"+file+"']").length) // no default.css && file not added yet
    $(document.head).append($("<link/>").attr({rel: "stylesheet", href: "components/codemirror/theme/"+file}));
  source.setOption("theme", theme);
}

function sourceChanged(){
  $('#file-clean').toggle(source.isClean());
  $('#file-dirty').toggle(!source.isClean());
}
function specChanged(){
  $("#spec").scope().updateGraph(); // beter way to get to scope?
}