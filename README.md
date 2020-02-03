# About
Web frontend submodule for [Goblint](https://github.com/vogler/analyzer).

__Server:__
[node.js](http://nodejs.org/),
[express](http://expressjs.com/),
[pug](https://pugjs.org/),
[stylus](http://learnboost.github.com/stylus/),
[connect-assets](https://github.com/adunkman/connect-assets),
[CoffeeScript](http://coffeescript.org/)

__Client:__
[jQuery](http://jquery.com/),
[Twitter Bootstrap](http://getbootstrap.com/),
[AngularJS](http://angularjs.org/),
[AngularUI](http://angular-ui.github.io/),
[CodeMirror](http://codemirror.net/)

# Installation
In order to setup the web frontend (needs [node](http://nodejs.org/)'s npm; uses [bower](http://bower.io/)) do

    sudo npm install -g coffee-script nodemon bower     # optional: install dev-tools globally
    npm install

Then run it using `npm start` or `nodemon server.coffee` for automatic reloading during development.

A JS version can be compiled using:

    coffee -c server.coffee
