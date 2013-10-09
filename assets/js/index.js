'use strict';

var app = angular.module('goblint', ['ngResource', 'ui']);
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

function SourceCtrl($scope, $location, $routeParams){
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
    $.get('/files/'+$scope.encodeURI($scope.path), {}, function(data){
      $scope.path  = data.path;
      $scope.files = data.files;
      $scope.$apply();
    })
    .fail(function(){
      console.log('could not load directory');
      alert("The directory doesn't exist! Redirecting...");
      if(history.length > 1){
        history.back();
      }else{
        $location.path("/");
        $scope.$apply();
      }
    });
  };

  var socket = io.connect('http://localhost');
  socket.on('files', function(files){
    console.log('socket.io: files updated');
    $scope.loadFiles();
  });

  $scope.loadSpec = function(specFile){
    $.get('/file/'+encodeURIComponent(specFile), {}, function(data){
      spec.setValue(data);
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
    $.post('/spec/dot', {value: spec.getValue()}, function(data){
      $('#graph').html(Viz(data, "svg"));
      parseError(false);
    })
    .fail(function(res){
      console.log(res.responseText);
      var lineno = /Line (.*?):/.exec(res.responseText);
      if(lineno){
        $scope.spec_error_line = lineno[1];
        $scope.$apply();
      }
      parseError(true);
    });
  }

  $scope.newFile = function(text){
    if(!text) text = "";
    editor.setValue(text);
    editor.clearHistory();
    editor.markClean();
    sourceChanged();
    $('#result').hide();
  };
  $scope.loadFile = function(f){
    var ff = decodeURIComponent(f);
    $scope.path = dirname(ff).split('/');
    $.get('/file/'+f, {}, function(data){
      $scope.newFile(data);
      console.log("loaded file", ff);
      // $scope.selectedFile = ff.split('/').last(); // doesn't update bindings
      $.get('/result/'+f, {}, function(data){
        $('#result').show();
        $("#compile-error").hide();
        $('#output').text(data);
      });
    })
    .fail(function(){
      console.log('could not load file', ff);
      alert("The file "+ff+" doesn't exist! Redirecting...");
      if(history.length > 1){
        history.back();
      }else{
        $location.path("/");
        $scope.$apply();
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
      $scope.selectedFile = decodeURIComponent($routeParams.file).split('/').last();
      $scope.loadFiles();
      $scope.$parent.title = decodeURIComponent($routeParams.file);
    }else if($routeParams.files){
      $scope.path = decodeURIComponent($routeParams.files).split('/');
      $scope.newFile();
      $scope.selectedFile = null;
      $scope.loadFiles();
      $scope.$parent.title = decodeURIComponent($routeParams.files);
    }else{
      $scope.newFile();
      $scope.selectedFile = null;
      $scope.$parent.title = "";
    }
  });
  $scope.$on('$locationChangeStart', function(ev){
    if(!editor.isClean()){
      if(!confirm("You have unsaved changes! Discard them?"))
        ev.preventDefault(); // stopPropagation
    }
  });

  $scope.saveFile = function(){
    var file = $routeParams.file;
    var isNew = false;
    if(!file){
      file = prompt("New filename:");
      if(!file) return;
      file = $scope.encodeURI($scope.path, file);
      isNew = true;
    }
    var url = '/file/'+file;
    $.post(url, {value: editor.getValue()}, function(){
      editor.markClean();
      sourceChanged();
      console.log("saved file", file);
      if(isNew){
        $location.path(url);
      }
      $scope.loadFiles();
    });
  };
  $scope.renameFile = function(){
    if(!editor.isClean()){
      alert("File is dirty, safe first!");
      return;
    }
    var name = prompt("New filename:");
    if(!name) return;
    $.post('/file/'+$routeParams.file, {name: name}, function(){
      console.log("renamed file", $routeParams.file, "to", name);
      $location.path("/file/"+$scope.encodeURI(dirname(decodeURIComponent($routeParams.file)).split('/'), name));
      $scope.loadFiles();
    });
  };
  $scope.deleteFile = function(){
    if(!confirm("Delete the file?")) return;
    $.ajax({url: '/file/'+$routeParams.file,
      type: 'DELETE',
      success: function(){
        $location.path("/");
        $scope.loadFiles();
      }
    });
  };
  $scope.revertFile = function(){
    var file = $routeParams.file;
    $.post('/revert/'+file, {}, function(data){
      console.log("reverted", file, ": ", data);
      $scope.reloadFile();
      $scope.loadFiles();
    });
  };
  $scope.runFile = function(){
    var file = $routeParams.file;
    if(!editor.isClean()){
      $scope.saveFile();
    }
    $.get('/run/'+file, {}, function(data){
      console.log("compile and run", file);
      $('#output').text(data);
      $("#compile-error").hide();
    })
    .fail(function(res){
      $('#output').text(res.responseText);
      $("#compile-error").show();
    });
  };
}

function selectTheme() {
  var theme = $("#theme").val();
  var file = theme.split(' ')[0]+'.css';
  if(theme!="default" && !$("head link[rel='stylesheet'][href*='"+file+"']").length) // no default.css && file not added yet
    $(document.head).append($("<link/>").attr({rel: "stylesheet", href: "components/codemirror/theme/"+file}));
  editor.setOption("theme", theme);
}

function sourceChanged(){
  $('#file-clean').toggle(editor.isClean());
  $('#file-dirty').toggle(!editor.isClean());
}
function specChanged(){
  $("#spec").scope().updateGraph(); // beter way to get to scope?
}