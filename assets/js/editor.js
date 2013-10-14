function initEditor(id, changeListener){
  var editor = CodeMirror.fromTextArea(document.getElementById(id), {
    mode: 'text/x-csrc', lineNumbers: true, matchBrackets: true, autoCloseBrackets: true, highlightSelectionMatches: true, theme: 'default'
  });
  editor.on('change', changeListener);
  return editor;
}

app.controller("FileCtrl", function ($scope, $rootScope, $http, $location, $route, $routeParams) {
  // $scope.id = "foo42";
  // $scope.file = "path/to/source.c";
  $scope.theme = "default";
  $scope.ref = $scope; // bi-directional binding to parent scope

  var emit = function(event, data){
    $scope.$parent.handle(event, data);
  };

  $scope.onChange = function(){
    $scope.clean = $scope.editor.isClean();
    if(!$rootScope.$$phase) { // only one digest allowed at a time...
      $scope.$apply();
    }
    console.log("editor onChange", $scope.id, $scope.clean);
    emit("change");
  }

  $scope.init = function(){
    // console.log("init", $scope.id);
    $scope.editor = initEditor($scope.id+"Text", $scope.onChange);
    var routeChanged = function(){
      // console.log("editor", $scope.id, "$routeChangeSuccess");
      var file = $routeParams[$scope.id];
      if(file){
        $scope.load(file);
      }else{
        // $scope.new();
      }
    };
    $scope.$on('$routeChangeSuccess', routeChanged);
    routeChanged(); // needed since routeChangeSuccess occurs before directives are parsed
    $scope.$on('$locationChangeStart', function(ev){
      if(!$scope.editor.isClean()){
        if(!confirm("You have unsaved changes! Discard them?"))
          ev.preventDefault(); // stopPropagation
      }
    });
  };
  $scope.load = function(file){
    if(file){
      $scope.file = file;
    }else if($scope.file){
      file = $scope.file;
    }else{
      return;
    }
    $http.get('/file/'+encodeURIComponent(file))
    .success(function(data){
      console.log("loaded", file);
      $scope.editor.setValue(data);
      $scope.editor.markClean();
      $scope.onChange(); // initial change event too fast for angular...
      emit("load", {file: file});
    })
    .error(function(){
      alert("The file "+file+" doesn't exist! Redirecting...");
      if(history.length > 1){
        history.back();
      }else{
        $location.path("/");
      }
      emit("loadError", {file: file});
    });
  };
  $scope.new = function(text){
    console.log("new", $scope.id);
    if(!text) text = "";
    $scope.file = null;
    $scope.editor.setValue(text);
    $scope.editor.clearHistory();
    $scope.editor.markClean();
    emit("new", {file: null});
  };
  $scope.save = function(){
    var isNew = false;
    var file = $scope.file;
    if(!file){
      file = prompt("New filename:");
      if(!file) return;
      file = $scope.$parent.folder + file;
      isNew = true;
    }
    var encFile = encodeURIComponent(file);
    $http.post('/file/'+encFile, {value: $scope.editor.getValue()})
    .success(function(){
      $scope.editor.markClean();
      $scope.onChange(); // initial change event too fast for angular...
      console.log("saved file", file);
      if(isNew){
        $location.path('/'+$scope.id+'/'+encFile);
      }
      emit("save", {file: file});
      emit("files");
    });
  };
  $scope.rename = function(){
    if(!$scope.editor.isClean()){
      alert("File is dirty, safe first!");
      return;
    }
    var name = prompt("New filename:");
    if(!name) return;
    $http.post('/file/'+encodeURIComponent($scope.file), {name: name})
    .success(function(){
      console.log("renamed file", $scope.file, "to", name);
      $location.path('/'+$scope.id+'/'+encodeURIComponent(dirname($scope.file) + name));
      emit("rename", {file: $scope.file});
      emit("files");
    });
  };
  $scope.delete = function(){
    if(!confirm("Delete the file?")) return;
    $http.delete('/file/'+encodeURIComponent($scope.file))
    .success(function(){
      if(history.length > 1){
        history.back();
      }else{
        $location.path("/");
      }
      emit("delete", {file: $scope.file});
      emit("files");
    });
  };
  $scope.revert = function(){
    $http.post('/revert/'+encodeURIComponent($scope.file))
    .success(function(data){
      console.log("reverted", $scope.file, ": ", data);
      $scope.load(); // reload content
      emit("files");
    });
  };

  $scope.selectTheme = function() {
    var theme = $scope.theme;
    var file = theme.split(' ')[0]+'.css';
    if(theme!="default" && !$("head link[rel='stylesheet'][href*='"+file+"']").length) // no default.css && file not added yet
      $(document.head).append($("<link/>").attr({rel: "stylesheet", href: "components/codemirror/theme/"+file}));
    $scope.editor.setOption("theme", theme);
  }
});

app.directive('editor', function($timeout) {
  return {
    restrict: 'E',
    transclude: true,
    scope: {
      id: '@id',
      ref: '=?'
    },
    controller: 'FileCtrl',
    templateUrl: '/partial/editor',
    link : function(scope, element, attrs) { // called when template is done
        $timeout(scope.init, 0); // timeout needed :(
    },
    replace: true
  };
});
