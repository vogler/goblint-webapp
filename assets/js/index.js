'use strict';

var app = angular.module('goblint', ['ngResource', 'ui']);
app.config(function ($routeProvider, $locationProvider) {
    $routeProvider
      .when('/', {})
      .when('/file/:file', {}) // only used if a ng-view exists :(
      .otherwise({
        redirectTo: '/'
      });
      //- $locationProvider.html5Mode(true); // html5 pushState
  })
  .value('ui.config', {
    jq: {tooltip: {container: 'body'}} // placement: 'right'
  });

console.log("angular-ui ok");

function SourceCtrl($scope, $location, $routeParams){
  $scope.files = [];
  $scope.refresh = function(){
    $.get('/files', {}, function(files){
      $scope.files = files;
      $scope.$apply();
    });
  };
  $scope.refresh();

  var socket = io.connect('http://localhost');
  socket.on('files', function(files){
    console.log('socket.io: files updated');
    $scope.refresh();
  });

  $scope.newFile = function(text){
    if(!text) text = "";
    editor.setValue(text);
    editor.clearHistory();
    editor.markClean();
    valueChanged();
  };
  $scope.loadFile = function(f){
    $.get('/source/'+f, {}, function(data){
      $scope.newFile(data);
      console.log("loaded file", f);
      $.get('/result/'+f, {}, function(data){
        $('#result').text(data);
      });
    })
    .fail(function(){
      console.log('/source/'+f, 'failed');
      alert("The file "+$routeParams.file+" doesn't exist! Redirecting...");
      if(history.length > 1){
        history.back();
      }else{
        $location.path("/");
        $scope.$apply();
      }
    });
  };
  // gets called on every route change :(
  // alternative would be to add a route with a controller and a templateUrl pointing to a dummy file
  $scope.$on('$routeChangeSuccess', function(ev){
    //- console.log($location, $routeParams);
    if($routeParams.file){
      $scope.loadFile($routeParams.file);
      selectFile($routeParams.file);
      $scope.$parent.title = $routeParams.file;
    }else{
      $scope.newFile();
      selectFile(false); // deselect
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
      isNew = true;
    }
    $.post('/source/'+file, {value: editor.getValue()}, function(){
      editor.markClean();
      valueChanged();
      console.log("saved file", file);
      if(isNew){
        $location.path("/file/"+file);
        $scope.refresh();
      }
    });
  };
  $scope.renameFile = function(){
    if(!editor.isClean()){
      alert("File is dirty, safe first!");
      return;
    }
    var name = prompt("New filename:");
    if(!name) return;
    $.post('/source/'+$routeParams.file, {name: name}, function(){
      console.log("renamed file", $routeParams.file, "to", name);
      $location.path("/file/"+name);
      $scope.refresh();
    });
  };
  $scope.deleteFile = function(){
    if(!confirm("Delete the file?")) return;
    $.ajax({url: '/source/'+$routeParams.file,
      type: 'DELETE',
      success: function(){
        $location.path("/");
        $scope.refresh();
      }
    });
  };
}

function selectFile(file){
  $('#files a').removeClass('active');
  if(file) $("#files a:contains('"+file+"')").toggleClass('active');
}

function selectTheme() {
  var theme = $("#theme").val();
  var file = theme.split(' ')[0]+'.css';
  if(theme!="default" && !$("head link[rel='stylesheet'][href*='"+file+"']").length) // no default.css && file not added yet
    $(document.head).append($("<link/>").attr({rel: "stylesheet", href: "components/codemirror/theme/"+file}));
  editor.setOption("theme", theme);
}

function valueChanged(){
  $('#file-clean').toggle(editor.isClean());
  $('#file-dirty').toggle(!editor.isClean());
}