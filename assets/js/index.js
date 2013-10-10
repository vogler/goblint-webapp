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

  $scope.encodeURI = function(path, file){
    var x = path.join('/');
    if(file) x += '/'+file;
    return encodeURIComponent(x);
  };
  $scope.encodeURI2 = function(path, file){ // need to encode twice in templates since the browser decodes the link
    return escape($scope.encodeURI(path, file));
  };
  function dirname(path) {
    return path.replace(/\\/g,'/').replace(/\/[^\/]*$/, '');;
  }

  $scope.loadFiles = function(){
    $http.get('/files/'+$scope.encodeURI($scope.path))
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
    source.setValue(text);
    source.clearHistory();
    source.markClean();
    sourceChanged();
    $('#result').hide();
  };
  $scope.loadFile = function(file){
    var encFile = encodeURIComponent(file);
    $scope.path = dirname(file).split('/');
    $http.get('/file/'+encFile)
    .success(function(data){
      $scope.newFile(data);
      console.log("loaded file", file);
      // $scope.selectedFile = file.split('/').last(); // doesn't update bindings
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
  $scope.reloadFile = function(){
    $scope.loadFile($routeParams.file);
  };
  // gets called on every route change :(
  // alternative would be to add a route with a controller and a templateUrl pointing to a dummy file
  $scope.$on('$routeChangeSuccess', function(ev){
    // console.log($location, $routeParams);
    if($routeParams.file){
      $scope.loadFile($routeParams.file);
      $scope.selectedFile = $routeParams.file.split('/').last();
      $scope.loadFiles();
      $scope.$parent.title = $routeParams.file;
    }else if($routeParams.files){
      $scope.path = $routeParams.files.split('/');
      $scope.newFile();
      $scope.selectedFile = null;
      $scope.loadFiles();
      $scope.$parent.title = $routeParams.files;
    }else{
      $scope.newFile();
      $scope.selectedFile = null;
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
      file = $scope.encodeURI($scope.path, file);
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
      $location.path("/file/"+$scope.encodeURI(dirname($routeParams.file).split('/'), name));
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
      $scope.reloadFile();
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