# About
Web frontend submodule for [Goblint](https://github.com/vogler/analyzer).

__Server:__
[node.js](http://nodejs.org/),
[express](http://expressjs.com/),
[jade](http://jade-lang.com/),
[stylus](http://learnboost.github.com/stylus/),
[connect-assets](https://github.com/TrevorBurnham/connect-assets),
[CoffeeScript](http://coffeescript.org/)

__Client:__
[jQuery](http://jquery.com/),
[Twitter Bootstrap](http://twitter.github.com/bootstrap/),
[AngularJS](http://angularjs.org/),
[AngularUI](http://angular-ui.github.io/),
[CodeMirror](http://codemirror.net/)

# Installation
In order to setup the web frontend (needs [node](http://nodejs.org/)'s npm; uses [bower](http://twitter.github.com/bower/)) do

    sudo npm install -g bower coffee-script nodemon     # install those globally if not already installed (nodemon is optional)
    npm install && bower install

Then run it using `coffee server.coffee` or `nodemon server.coffee` for automatic reloading during development.

A JS version can be compiled using:

    coffee -c server.coffee
