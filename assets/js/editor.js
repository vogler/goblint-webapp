function initEditor(id, changeListener){
  var editor = CodeMirror.fromTextArea(document.getElementById(id), {
    mode: 'text/x-csrc', lineNumbers: true, matchBrackets: true, autoCloseBrackets: true, highlightSelectionMatches: true, theme: 'default',
    gutters: ["CodeMirror-linenumbers", "warnings"],
    extraKeys: {
      "F11": function(cm) {
        cm.setOption("fullScreen", !cm.getOption("fullScreen"));
      }
    }
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

  $scope.updateClean = function(){
    $scope.clean = $scope.editor.isClean();
    if(!$rootScope.$$phase) { // only one digest allowed at a time...
      $scope.$apply(); // needed since called from outside of angular
    }
  };
  $scope.onChange = _.throttle(function(){
    $scope.updateClean();
    // console.log("editor onChange", $scope.id, $scope.clean);
    emit("change");
  }, 100);

  $scope.init = function(){
    // console.log("init", $scope.id);
    $scope.editor = initEditor($scope.id+"Text", $scope.onChange);
    var routeChanged = function(){
      // console.log("editor", $scope.id, "$routeChangeSuccess");
      var file = $routeParams[$scope.id];
      if(file && file != $scope.file && basename(file) != "new"){
        $scope.load(file);
      }else{
        // $scope.new();
      }
    };
    $scope.$on('$routeChangeSuccess', routeChanged);
    routeChanged(); // needed since routeChangeSuccess occurs before directives are parsed
    $scope.$on('$locationChangeStart', function(ev){
      if(!$scope.editor.isClean()){
        console.log(ev);
        // if(!confirm("You have unsaved changes! Discard them?"))
        //   ev.preventDefault(); // stopPropagation
      }
    });
    emit("init");
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
      $scope.editor.clearHistory();
      $scope.editor.markClean();
      $scope.updateClean(); // initial change event too fast for angular...
      emit("load", {file: file});
    })
    .error(function(){
      alert("The file "+file+" doesn't exist! Redirecting...");
      // if(history.length > 1){
      //   history.back();
      // }else{
      //   $location.path("/");
      // }
      $location.path("/");
      emit("loadError", {file: file});
    });
  };
  $scope.new = function(text){
    console.log("new", $scope.id);
    if(!text) text = "";
    $scope.editor.setValue(text);
    $scope.editor.clearHistory();
    $scope.editor.markClean();
    $location.path('/'+$scope.id+'/'+encodeURIComponent(dirname($scope.file) + "new"));
    $scope.file = null;
    emit("new", {file: null});
  };
  $scope.save = function(){
    var isNew = false;
    var file = $scope.file;
    if(!file){
      file = prompt("New filename:");
      if(!file) return;
      file = $scope.$parent.cwd + file;
      isNew = true;
    }
    var encFile = encodeURIComponent(file);
    $http.post('/file/'+encFile, {value: $scope.editor.getValue()})
    .success(function(){
      $scope.editor.markClean();
      $scope.updateClean(); // initial change event too fast for angular...
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
      $scope.file = null;
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
  $scope.fullscreen = function(){
    var cm = $scope.editor;
    cm.setOption("fullScreen", !cm.getOption("fullScreen"));
    cm.focus();
  };

  function makeMarker(maybe) {
    var x = document.createElement("i");
    x.className = "glyphicon glyphicon-" + (maybe ? "flash" : "remove");
    x.style.color = maybe ? "#f0ad4e" : "#d9534f";
    // x.innerHTML = "●";
    return x;
  }
  function makeWarning(text, maybe) {
    var x = document.createElement("span");
    x.className = "label label-" + (maybe ? "warning" : "danger");
    x.innerText = text;
    return x;
  }
  $scope.warnMarker = function(line, maybe){
    var markers = $scope.editor.lineInfo(line-1).gutterMarkers;
    // marker with icon "remove" is more important -> don't replace it with icon "flash"
    if(!(markers && "warnings" in markers && /remove/.test(markers.warnings.className))){
      $scope.editor.setGutterMarker(line-1, "warnings", makeMarker(maybe));
    }
  };
  $scope.lineWidgets = [];
  $scope.warnText = function(line, text, maybe){
    $scope.warnMarker(line, maybe);
    $scope.lineWidgets.push($scope.editor.addLineWidget(line-1, makeWarning(text, maybe)));
  };
  $scope.clearWarnings = function(){
    $scope.editor.clearGutter("warnings");
    $scope.lineWidgets.forEach(function(x){ x.clear(); });
    $scope.lineWidgets = [];
  };
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
